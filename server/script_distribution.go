package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type scriptDistribution struct {
	files        []scriptFileData
	largeFiles   []scriptFileData
	largeFileMD5 map[string]md5Result
	runName      string
	sender       *scriptFileSender
}

func prepareScriptDistribution(c *gin.Context, req scriptSendRequest) *scriptDistribution {
	resolved, err := resolveScriptPath(req.Name)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return nil
	}
	scriptPath, scriptName := resolved.absPath, resolved.normalizedName
	fileInfo, err := os.Stat(scriptPath)
	if err != nil {
		jsonError(c, http.StatusNotFound, "script not found")
		return nil
	}
	isDir, isPiled := fileInfo.IsDir(), false
	if isDir {
		if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts")); err == nil {
			isPiled = true
		}
	}
	configIndex := buildDeviceScriptConfigIndex(scriptName, req.SelectedGroups)
	if isDir {
		if err := validateScriptRequestConfig(scriptPath, req.Devices, configIndex); err != nil {
			jsonError(c, http.StatusBadRequest, err.Error())
			return nil
		}
	}
	files, err := collectScriptFilesCached(scriptPath, scriptName, isDir, isPiled)
	if err != nil {
		message := "failed to read script file"
		if isDir {
			message = "failed to read script directory"
		}
		jsonError(c, http.StatusInternalServerError, message)
		return nil
	}
	largeFiles := make([]scriptFileData, 0)
	for _, file := range files {
		if file.Data == "" {
			largeFiles = append(largeFiles, file)
		}
	}
	runName := scriptName
	if isPiled {
		runName = "main.xxt"
		if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts", "main.lua")); err == nil {
			runName = "main.lua"
		}
	}
	return &scriptDistribution{
		files:        files,
		largeFiles:   largeFiles,
		largeFileMD5: calculateLargeFileMD5(largeFiles),
		runName:      runName,
		sender:       newScriptFileSender(files, configIndex),
	}
}

func prepareScriptFileFetch(udid, baseURL string, file scriptFileData, md5Hash, requestID string) ([]byte, string, error) {
	if requestID == "" {
		requestID = uuid.NewString()
	}
	token := uuid.New().String()
	body := gin.H{
		"url":        fmt.Sprintf("%s/api/transfer/download/%s", baseURL, token),
		"targetPath": file.Path,
		"md5":        md5Hash,
		"totalBytes": file.Size,
		"timeout":    defaultTransferTimeoutSec,
	}
	body["requestId"] = requestID
	payload, err := json.Marshal(Message{Type: "transfer/fetch", Body: body})
	if err != nil {
		return nil, "", err
	}
	expiresAt := time.Now().Add(transferTokenTTLForTimeout(defaultTransferTimeoutSec))
	if err := beginDeviceFileTransfer(udid, file.Path, requestID, "download", expiresAt); err != nil {
		return nil, "", err
	}
	transferTokensMu.Lock()
	transferTokens[token] = &TransferToken{
		Type:       "download",
		FilePath:   file.SourcePath,
		TargetPath: file.Path,
		DeviceSN:   udid,
		ExpiresAt:  expiresAt,
		OneTime:    true,
		TotalBytes: file.Size,
		MD5:        md5Hash,
	}
	transferTokensMu.Unlock()
	return payload, token, nil
}
