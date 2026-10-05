package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const filePushConcurrency = 6

type filePushRequest struct {
	DeviceSN          string   `json:"deviceSN"`
	DeviceSNs         []string `json:"deviceSNs"`
	Category          string   `json:"category"`
	Path              string   `json:"path"`
	TargetPath        string   `json:"targetPath"`
	Timeout           int      `json:"timeout"`
	ServerBaseURL     string   `json:"serverBaseUrl"`
	SharedSourceID    string   `json:"sharedSourceId"`
	SharedSourceTotal int      `json:"sharedSourceTotal"`
}

type filePushSource struct {
	path         string
	size         int64
	smallPayload []byte
	md5          string
}

func prepareFilePushSource(c *gin.Context, req filePushRequest) *filePushSource {
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return nil
	}
	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		jsonError(c, http.StatusNotFound, "file not found")
		return nil
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to read file")
		return nil
	}
	if info.IsDir() {
		jsonError(c, http.StatusBadRequest, "cannot push a directory")
		return nil
	}

	source := &filePushSource{path: filePath, size: info.Size()}
	if info.Size() < 128*1024 {
		content, err := os.ReadFile(filePath)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to read file")
			return nil
		}
		// 内容和目标路径在整批设备间相同，编码后的消息可以只读复用。
		source.smallPayload, err = json.Marshal(Message{Type: "file/put", Body: gin.H{
			"path": req.TargetPath,
			"data": base64.StdEncoding.EncodeToString(content),
		}})
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to send file to device")
			return nil
		}
	} else {
		source.md5, err = md5Cache.get(filePath, info)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to read file")
			return nil
		}
	}
	return source
}

func pushPreparedFileToDevice(source *filePushSource, req filePushRequest, deviceSN, baseURL string) (gin.H, int, error) {
	if source.smallPayload != nil {
		mu.RLock()
		conn := deviceLinks[deviceSN]
		mu.RUnlock()
		if conn == nil {
			return nil, http.StatusBadRequest, errors.New("device not connected")
		}
		if err := conn.WriteMessage(1, source.smallPayload); err != nil {
			return nil, http.StatusInternalServerError, errors.New("failed to send file to device")
		}
		broadcastDeviceMessage(deviceSN, "device.transfer.send_file", map[string]any{"name": filepath.Base(req.Path)})
		debugLogf("📤 Push file (small): %s → device %s:%s (%d bytes)", req.Path, deviceSN, req.TargetPath, source.size)
		return gin.H{"success": true, "method": "file/put", "totalBytes": source.size}, http.StatusOK, nil
	}

	token := uuid.New().String()
	timeout := normalizeTransferTimeoutSeconds(req.Timeout)
	transferTokensMu.Lock()
	sharedSourceID := retainDownloadTempSource(source.path, req.SharedSourceID, req.SharedSourceTotal)
	transferTokens[token] = &TransferToken{
		Type:           "download",
		FilePath:       source.path,
		TargetPath:     req.TargetPath,
		DeviceSN:       deviceSN,
		ExpiresAt:      time.Now().Add(transferTokenTTLForTimeout(timeout)),
		OneTime:        true,
		TotalBytes:     source.size,
		MD5:            source.md5,
		Category:       req.Category,
		SharedSourceID: sharedSourceID,
	}
	transferTokensMu.Unlock()

	downloadURL := baseURL + "/api/transfer/download/" + token
	broadcastDeviceMessage(deviceSN, "device.transfer.download_file", map[string]any{"name": filepath.Base(req.Path)})
	if err := sendFileDownloadCommand(deviceSN, downloadURL, req.TargetPath, source.md5, source.size, timeout); err != nil {
		transferTokensMu.Lock()
		info := transferTokens[token]
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		if info != nil && info.SharedSourceID != "" {
			releaseSharedTempRef(info.SharedSourceID)
		}
		return nil, http.StatusBadRequest, err
	}
	debugLogf("📤 Push file (large): %s → device %s:%s (%d bytes)", req.Path, deviceSN, req.TargetPath, source.size)
	return gin.H{
		"success": true, "method": "transfer/fetch", "token": token,
		"totalBytes": source.size, "md5": source.md5,
	}, http.StatusOK, nil
}

func pushFileToDeviceHandler(c *gin.Context) {
	var req filePushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}
	if req.DeviceSN == "" || req.Category == "" || req.Path == "" || req.TargetPath == "" {
		jsonError(c, http.StatusBadRequest, "deviceSN, category, path, and targetPath are required")
		return
	}
	source := prepareFilePushSource(c, req)
	if source == nil {
		return
	}
	result, status, err := pushPreparedFileToDevice(source, req, req.DeviceSN, resolveTransferBaseURL(c, req.ServerBaseURL))
	if err != nil {
		jsonError(c, status, err.Error())
		return
	}
	c.JSON(http.StatusOK, result)
}

func pushFileToDevicesHandler(c *gin.Context) {
	var req filePushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}
	deviceIDs := uniqueDeviceIDs(req.DeviceSNs)
	if len(deviceIDs) == 0 || req.Category == "" || req.Path == "" || req.TargetPath == "" {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}
	clearTransferRequestDeadlines(c)
	source := prepareFilePushSource(c, req)
	if source == nil {
		return
	}
	baseURL := resolveTransferBaseURL(c, req.ServerBaseURL)
	ctx := c.Request.Context()
	req.SharedSourceID, req.SharedSourceTotal = "", 0
	if source.smallPayload == nil && isTempFilePath(source.path) {
		// 批次本身持有一份引用，排队设备或浏览器取消都不需要靠预估注册数量来保护源文件。
		req.SharedSourceID = retainDownloadTempSource(source.path, "", 0)
		defer releaseSharedTempRef(req.SharedSourceID)
	}

	results := make([]gin.H, len(deviceIDs))
	failures := make([]messageSpec, len(deviceIDs))
	jobs := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < filePushConcurrency && worker < len(deviceIDs); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				if err := ctx.Err(); err != nil {
					failures[index] = resolveHTTPMessageSpec(http.StatusRequestTimeout, err.Error(), nil, "")
					continue
				}
				result, status, err := pushPreparedFileToDevice(source, req, deviceIDs[index], baseURL)
				if err != nil {
					failures[index] = resolveHTTPMessageSpec(status, err.Error(), nil, "")
				} else {
					results[index] = result
				}
			}
		}()
	}
	for index := range deviceIDs {
		jobs <- index
	}
	close(jobs)
	workers.Wait()

	// Gin 的响应头和翻译在请求协程中统一处理，设备工作协程只写各自的结果槽位。
	for index, deviceSN := range deviceIDs {
		if failures[index].Code != "" {
			results[index] = localizedErrorPayload(c, failures[index])
			results[index]["success"] = false
		}
		results[index]["deviceSN"] = deviceSN
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": results})
}
