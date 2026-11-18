package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

var errUploadSizeMismatch = errors.New("uploaded file size does not match expected length")

func replaceUploadedFile(ctx context.Context, targetPath string, source io.Reader, expectedSize int64) (int64, os.FileInfo, error) {
	var existing os.FileInfo
	for links := 0; ; links++ {
		info, err := os.Lstat(targetPath)
		if os.IsNotExist(err) {
			break
		}
		if err != nil {
			return 0, nil, err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			if !info.Mode().IsRegular() {
				return 0, nil, fmt.Errorf("cannot replace non-regular file: %s", targetPath)
			}
			existing = info
			break
		}
		if links >= 255 {
			return 0, nil, fmt.Errorf("too many symbolic links: %s", targetPath)
		}
		linkedPath, err := os.Readlink(targetPath)
		if err != nil {
			return 0, nil, err
		}
		// 上传到文件链接时仍更新其目标，不能用新文件替换链接本身。
		if !filepath.IsAbs(linkedPath) {
			linkedPath = filepath.Join(filepath.Dir(targetPath), linkedPath)
		}
		targetPath = linkedPath
	}
	if existing != nil {
		writable, err := os.OpenFile(targetPath, os.O_WRONLY, 0)
		if err != nil {
			return 0, nil, err
		}
		if err := writable.Close(); err != nil {
			return 0, nil, err
		}
	}

	// 面板可以向只有写入和搜索权限的目录投递文件，无需打开父目录读取其内容。
	temporaryPath := filepath.Join(filepath.Dir(targetPath), ".xxt-upload-"+uuid.NewString())
	file, err := os.OpenFile(temporaryPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0666)
	if err != nil {
		return 0, nil, err
	}
	defer func() {
		_ = file.Close()
		_ = os.Remove(temporaryPath)
	}()
	if existing != nil {
		if err := file.Chmod(existing.Mode().Perm()); err != nil {
			return 0, nil, err
		}
	}
	written, err := receiveUploadContents(ctx, file, source, expectedSize)
	if err != nil {
		return written, nil, err
	}
	info, err := os.Stat(temporaryPath)
	if err != nil {
		return written, nil, err
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return written, nil, err
	}
	return written, info, nil
}

func receiveUploadContents(ctx context.Context, file *os.File, source io.Reader, expectedSize int64) (int64, error) {
	written, err := io.Copy(file, source)
	if err != nil {
		return written, err
	}
	if expectedSize >= 0 && written != expectedSize {
		return written, errUploadSizeMismatch
	}
	// Windows 可在关闭最后一个写句柄时更新修改时间，调用方随后再取发布版本。
	if err := file.Close(); err != nil {
		return written, err
	}
	return written, ctx.Err()
}
