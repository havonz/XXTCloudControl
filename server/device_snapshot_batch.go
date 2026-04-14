package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	batchSnapshotConcurrency      = 3
	batchSnapshotRequestTimeout   = 20 * time.Second
	internalHTTPBinChunkSize      = 64 * 1024
	internalHTTPBinIgnoreDuration = 30 * time.Second
	internalHTTPBinMaxBodySize    = 32 * 1024 * 1024
)

type snapshotSaveBatchRequest struct {
	DeviceIDs []string `json:"deviceIds"`
}

type snapshotSaveBatchResult struct {
	UDID  string `json:"udid"`
	OK    bool   `json:"ok"`
	Path  string `json:"path,omitempty"`
	Error string `json:"error,omitempty"`
}

type internalHTTPBinResponse struct {
	StatusCode int
	Body       []byte
	Error      string
}

type internalHTTPBinRequestState struct {
	RequestID      string
	DeviceUDID     string
	Done           chan struct{}
	Result         internalHTTPBinResponse
	MetaReceived   bool
	BodySize       int
	ExpectedChunks uint32
	Chunks         [][]byte
	ReceivedChunks int
	ReceivedBytes  int
	Completed      bool
}

var (
	internalHTTPBinMu       sync.Mutex
	internalHTTPBinRequests = make(map[string]*internalHTTPBinRequestState)
	internalHTTPBinIgnored  = make(map[string]time.Time)

	captureDeviceScreenshot = requestDeviceScreenshotViaHTTPBin
)

func snapshotSaveBatchHandler(c *gin.Context) {
	var req snapshotSaveBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	deviceIDs := uniqueDeviceIDs(req.DeviceIDs)
	if len(deviceIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceIds is required"})
		return
	}

	results := make([]snapshotSaveBatchResult, len(deviceIDs))
	sem := make(chan struct{}, batchSnapshotConcurrency)
	var wg sync.WaitGroup

	for index, udid := range deviceIDs {
		wg.Add(1)
		go func(i int, deviceID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			results[i] = saveSingleDeviceSnapshot(deviceID, time.Now())
		}(index, udid)
	}

	wg.Wait()
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"results": results,
	})
}

func saveSingleDeviceSnapshot(udid string, now time.Time) snapshotSaveBatchResult {
	conn, deviceName, deviceIP, ok := resolveConnectedSnapshotTarget(udid)
	if !ok || conn == nil {
		return snapshotSaveBatchResult{
			UDID:  udid,
			OK:    false,
			Error: "device is offline",
		}
	}

	data, err := captureDeviceScreenshot(udid, batchSnapshotRequestTimeout)
	if err != nil {
		return snapshotSaveBatchResult{
			UDID:  udid,
			OK:    false,
			Error: err.Error(),
		}
	}

	path, err := persistDeviceScreenshot(deviceName, deviceIP, data, now)
	if err != nil {
		return snapshotSaveBatchResult{
			UDID:  udid,
			OK:    false,
			Error: err.Error(),
		}
	}

	return snapshotSaveBatchResult{
		UDID: udid,
		OK:   true,
		Path: path,
	}
}

func resolveConnectedSnapshotTarget(udid string) (*SafeConn, string, string, bool) {
	mu.RLock()
	defer mu.RUnlock()

	conn, exists := deviceLinks[udid]
	if !exists || conn == nil {
		return nil, "", "", false
	}

	deviceName := udid
	deviceIP := "unknown"

	if rawState, ok := deviceTable[udid]; ok {
		if stateMap, ok := rawState.(map[string]interface{}); ok {
			if systemMap, ok := stateMap["system"].(map[string]interface{}); ok {
				if name, ok := systemMap["name"].(string); ok && strings.TrimSpace(name) != "" {
					deviceName = name
				}
				if ip, ok := systemMap["ip"].(string); ok && strings.TrimSpace(ip) != "" {
					deviceIP = ip
				}
			}
		}
	}

	return conn, deviceName, deviceIP, true
}

func persistDeviceScreenshot(deviceName, deviceIP string, data []byte, now time.Time) (string, error) {
	if len(data) == 0 {
		return "", errors.New("empty screenshot payload")
	}

	folderName := fmt.Sprintf("%s-%s",
		sanitizeSnapshotPathSegment(deviceName, "device"),
		sanitizeSnapshotPathSegment(deviceIP, "unknown"),
	)
	baseDir := filepath.Join(serverConfig.DataDir, "files", "snapshots", folderName)
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", err
	}

	fileName := buildSnapshotFilename(now)
	finalPath := filepath.Join(baseDir, fileName)

	// 先写临时文件再 rename，避免文件浏览器读到半写入内容。
	tmpFile, err := os.CreateTemp(baseDir, ".snapshot-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}

	relativePath := filepath.ToSlash(filepath.Join("files", "snapshots", folderName, fileName))
	return relativePath, nil
}

func sanitizeSnapshotPathSegment(value string, fallback string) string {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		return fallback
	}
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	cleaned = replacer.Replace(cleaned)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return fallback
	}
	return cleaned
}

func buildSnapshotFilename(now time.Time) string {
	return fmt.Sprintf("%s.png", now.Format("2006-01-02_15-04-05.000"))
}

func uniqueDeviceIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func requestDeviceScreenshotViaHTTPBin(udid string, timeout time.Duration) ([]byte, error) {
	response, err := requestDeviceHTTPBin(udid, "GET", "/api/screen/snapshot", map[string]interface{}{
		"format": "png",
	}, timeout)
	if err != nil {
		return nil, err
	}
	if response.Error != "" {
		return nil, errors.New(strings.TrimSpace(response.Error))
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New(extractSnapshotFailureReason(response))
	}
	if len(response.Body) == 0 {
		return nil, errors.New("empty screenshot payload")
	}
	return response.Body, nil
}

func requestDeviceHTTPBin(udid, method, path string, query map[string]interface{}, timeout time.Duration) (internalHTTPBinResponse, error) {
	conn, _, _, ok := resolveConnectedSnapshotTarget(udid)
	if !ok || conn == nil {
		return internalHTTPBinResponse{}, errors.New("device is offline")
	}

	requestID, err := generateInternalHTTPBinRequestID()
	if err != nil {
		return internalHTTPBinResponse{}, err
	}

	req := registerInternalHTTPBinRequest(requestID, udid)

	payload, err := json.Marshal(Message{
		Type: "http/request-bin",
		Body: map[string]interface{}{
			"requestId": requestID,
			"method":    method,
			"path":      path,
			"query":     query,
			"headers":   map[string]string{},
			"bodySize":  0,
			"chunkSize": internalHTTPBinChunkSize,
		},
	})
	if err != nil {
		cancelInternalHTTPBinRequest(requestID, err.Error())
		return internalHTTPBinResponse{}, err
	}

	if err := writeTextMessage(conn, payload); err != nil {
		cancelInternalHTTPBinRequest(requestID, err.Error())
		return internalHTTPBinResponse{}, err
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-req.Done:
		return req.Result, nil
	case <-timer.C:
		cancelInternalHTTPBinRequest(requestID, "request timeout")
		return internalHTTPBinResponse{}, errors.New("request timeout")
	}
}

func generateInternalHTTPBinRequestID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

func registerInternalHTTPBinRequest(requestID, deviceUDID string) *internalHTTPBinRequestState {
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	pruneExpiredInternalHTTPBinIgnoredLocked(time.Now())

	state := &internalHTTPBinRequestState{
		RequestID:  requestID,
		DeviceUDID: deviceUDID,
		Done:       make(chan struct{}),
	}
	internalHTTPBinRequests[requestID] = state
	return state
}

func cancelInternalHTTPBinRequest(requestID, reason string) {
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	state, exists := internalHTTPBinRequests[requestID]
	if !exists || state.Completed {
		return
	}
	finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
		Error: strings.TrimSpace(reason),
	})
}

func abortInternalHTTPBinRequestsForDevice(deviceUDID, reason string) {
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	for _, state := range internalHTTPBinRequests {
		if state.DeviceUDID != deviceUDID || state.Completed {
			continue
		}
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			Error: strings.TrimSpace(reason),
		})
	}
}

func handleInternalHTTPResponseBinMeta(conn *SafeConn, data Message) bool {
	deviceUDID, ok := getDeviceUDIDByConn(conn)
	if !ok {
		return false
	}

	bodyMap, err := decodeBodyMap(data.Body)
	if err != nil {
		return false
	}
	requestID, ok := toString(bodyMap["requestId"])
	if !ok || strings.TrimSpace(requestID) == "" {
		return false
	}

	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	now := time.Now()
	pruneExpiredInternalHTTPBinIgnoredLocked(now)
	if shouldIgnoreInternalHTTPBinRequestLocked(requestID, now) {
		return true
	}

	state, exists := internalHTTPBinRequests[requestID]
	if !exists || state.DeviceUDID != deviceUDID || state.Completed {
		return false
	}

	if statusCode, ok := toInt(bodyMap["statusCode"]); ok {
		state.Result.StatusCode = statusCode
	}
	if errText, ok := toString(bodyMap["error"]); ok {
		state.Result.Error = strings.TrimSpace(errText)
	}
	if bodySize, ok := toInt(bodyMap["bodySize"]); ok {
		state.BodySize = bodySize
	}
	state.MetaReceived = true

	if state.BodySize < 0 {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "invalid response body size",
		})
		return true
	}
	if state.BodySize > internalHTTPBinMaxBodySize {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "response body too large",
		})
		return true
	}
	if state.BodySize <= 0 {
		finalizeInternalHTTPBinRequestLocked(state, state.Result)
		return true
	}
	if state.ExpectedChunks > maxInternalHTTPBinChunksForBody(state.BodySize) {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "response chunk count invalid",
		})
		return true
	}

	if state.ExpectedChunks > 0 && state.ReceivedChunks == int(state.ExpectedChunks) {
		state.Result.Body = assembleInternalHTTPBinBody(state)
		finalizeInternalHTTPBinRequestLocked(state, state.Result)
	}
	return true
}

func handleInternalHTTPResponseBinChunk(conn *SafeConn, requestID string, seq, total uint32, chunk []byte) bool {
	deviceUDID, ok := getDeviceUDIDByConn(conn)
	if !ok {
		return false
	}

	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	now := time.Now()
	pruneExpiredInternalHTTPBinIgnoredLocked(now)
	if shouldIgnoreInternalHTTPBinRequestLocked(requestID, now) {
		return true
	}

	state, exists := internalHTTPBinRequests[requestID]
	if !exists || state.DeviceUDID != deviceUDID || state.Completed {
		return false
	}

	if total == 0 {
		return true
	}
	if len(chunk) > internalHTTPBinChunkSize {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "response chunk too large",
		})
		return true
	}
	if total > maxInternalHTTPBinChunksForBody(internalHTTPBinMaxBodySize) {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "response chunk count invalid",
		})
		return true
	}
	if state.MetaReceived && state.BodySize > 0 && total > maxInternalHTTPBinChunksForBody(state.BodySize) {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			StatusCode: state.Result.StatusCode,
			Error:      "response chunk count invalid",
		})
		return true
	}

	if state.ExpectedChunks < total {
		nextChunks := make([][]byte, total)
		copy(nextChunks, state.Chunks)
		state.Chunks = nextChunks
		state.ExpectedChunks = total
	}
	if seq >= uint32(len(state.Chunks)) {
		return true
	}
	if state.Chunks[seq] == nil {
		state.Chunks[seq] = append([]byte(nil), chunk...)
		state.ReceivedChunks++
		state.ReceivedBytes += len(chunk)
		if state.ReceivedBytes > internalHTTPBinMaxBodySize {
			finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
				StatusCode: state.Result.StatusCode,
				Error:      "response body too large",
			})
			return true
		}
	}

	if state.MetaReceived && state.ExpectedChunks > 0 && state.ReceivedChunks == int(state.ExpectedChunks) {
		state.Result.Body = assembleInternalHTTPBinBody(state)
		finalizeInternalHTTPBinRequestLocked(state, state.Result)
	}
	return true
}

func assembleInternalHTTPBinBody(state *internalHTTPBinRequestState) []byte {
	totalBytes := 0
	for _, chunk := range state.Chunks {
		totalBytes += len(chunk)
	}

	body := make([]byte, 0, totalBytes)
	for _, chunk := range state.Chunks {
		body = append(body, chunk...)
	}
	if state.BodySize > 0 && len(body) > state.BodySize {
		body = body[:state.BodySize]
	}
	return body
}

func finalizeInternalHTTPBinRequestLocked(state *internalHTTPBinRequestState, result internalHTTPBinResponse) {
	if state.Completed {
		return
	}
	state.Completed = true
	state.Result = result
	delete(internalHTTPBinRequests, state.RequestID)
	internalHTTPBinIgnored[state.RequestID] = time.Now().Add(internalHTTPBinIgnoreDuration)
	close(state.Done)
}

func shouldIgnoreInternalHTTPBinRequestLocked(requestID string, now time.Time) bool {
	expiresAt, exists := internalHTTPBinIgnored[requestID]
	if !exists {
		return false
	}
	if now.After(expiresAt) {
		delete(internalHTTPBinIgnored, requestID)
		return false
	}
	return true
}

func pruneExpiredInternalHTTPBinIgnoredLocked(now time.Time) {
	for requestID, expiresAt := range internalHTTPBinIgnored {
		if now.After(expiresAt) {
			delete(internalHTTPBinIgnored, requestID)
		}
	}
}

func maxInternalHTTPBinChunksForBody(bodySize int) uint32 {
	if bodySize <= 0 {
		return 0
	}
	chunks := (bodySize + internalHTTPBinChunkSize - 1) / internalHTTPBinChunkSize
	if chunks < 1 {
		chunks = 1
	}
	return uint32(chunks)
}

func extractSnapshotFailureReason(response internalHTTPBinResponse) string {
	if trimmed := strings.TrimSpace(response.Error); trimmed != "" {
		return trimmed
	}

	body := bytes.TrimSpace(response.Body)
	if len(body) > 0 {
		var payload map[string]interface{}
		if err := json.Unmarshal(body, &payload); err == nil {
			if value, ok := payload["error"].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
			if value, ok := payload["message"].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
		if utf8.Valid(body) {
			if text := strings.TrimSpace(string(body)); text != "" {
				return text
			}
		}
	}

	if response.StatusCode > 0 {
		return fmt.Sprintf("HTTP %d", response.StatusCode)
	}
	return "request failed"
}
