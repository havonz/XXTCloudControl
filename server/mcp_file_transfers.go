package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func prepareMCPFileTransfer(info mcpRequestInfo, kind, category, rawName string) (*TransferToken, error) {
	if info.clientBaseURL == "" || info.fileLinks == nil || info.fileLinks.Err() != nil {
		return nil, errors.New("an active MCP connection is required")
	}
	name, err := managedName(rawName, false)
	if err != nil {
		return nil, err
	}
	root, err := managedRoot(category)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	version, err := root.Stat(name)
	if err != nil && !(kind == "upload" && errors.Is(err, os.ErrNotExist)) {
		return nil, err
	}
	if version != nil && !version.Mode().IsRegular() {
		return nil, errors.New("expected a regular file")
	}
	file := &TransferToken{
		Type: kind, FilePath: name, Category: category, OneTime: true,
		ExpiresAt: time.Now().Add(defaultTransferTokenTTL), mcpLinks: info.fileLinks,
	}
	if kind == "download" {
		file.sourceVersion = version
		file.TotalBytes = version.Size()
	}
	return file, nil
}

func (file *TransferToken) mcpLink(baseURL, token string) fields {
	method := http.MethodGet
	if file.Type == "upload" {
		method = http.MethodPut
	}
	return fields{"method": method, "url": baseURL + "/api/transfer/" + file.Type + "/" + token,
		"expiresAt": file.ExpiresAt.UTC(), "root": file.Category, "path": filepath.ToSlash(file.FilePath)}
}

func (token *TransferToken) openDownload() (*os.File, error) {
	if token.mcpLinks == nil {
		return os.Open(token.FilePath)
	}
	// 领用短链时重新通过托管根打开，签发后的目录或符号链接变化不能扩大访问范围。
	root, err := managedRoot(token.Category)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.Open(token.FilePath)
}

func (token *TransferToken) receiveUpload(ctx context.Context, source io.Reader, size int64) (int64, os.FileInfo, error) {
	if token.mcpLinks == nil {
		return replaceUploadedFile(ctx, token.FilePath, source, size)
	}
	root, err := managedRoot(token.Category)
	if err != nil {
		return 0, nil, err
	}
	defer root.Close()
	if err = root.MkdirAll(filepath.Dir(token.FilePath), 0755); err != nil {
		return 0, nil, err
	}
	return writeManagedFile(ctx, root, token.FilePath, source, size)
}
