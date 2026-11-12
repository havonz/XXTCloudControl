package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
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
	batchSnapshotConcurrency    = 3
	batchSnapshotRequestTimeout = 20 * time.Second
	internalHTTPBinChunkSize    = 64 * 1024

	internalHTTPBinMaxBodySize = 32 * 1024 * 1024
)

type snapshotSaveBatchRequest struct {
	DeviceIDs []string `json:"deviceIds"`
}

type snapshotSaveBatchResult struct {
	UDID        string         `json:"udid"`
	OK          bool           `json:"ok"`
	Path        string         `json:"path,omitempty"`
	Error       string         `json:"error,omitempty"`
	ErrorCode   string         `json:"errorCode,omitempty"`
	ErrorParams map[string]any `json:"errorParams,omitempty"`
	Detail      string         `json:"detail,omitempty"`
	errorSpec   messageSpec
}

type internalHTTPBinResponse struct {
	StatusCode int
	Body       []byte
	Error      string
}

type internalHTTPBinRequestState struct {
	RequestID      string
	DeviceUDID     string
	Conn           *SafeConn
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

	captureDeviceScreenshot = requestDeviceScreenshotViaHTTPBin
)

func snapshotSaveBatchHandler(c *gin.Context) {
	var req snapshotSaveBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	deviceIDs := uniqueDeviceIDs(req.DeviceIDs)
	if len(deviceIDs) == 0 {
		jsonError(c, http.StatusBadRequest, "deviceIds is required")
		return
	}
	translator := requestTranslator(c)
	requestLanguage := strings.TrimSpace(c.GetHeader("Accept-Language"))
	if locale := NormalizeLocale(c.Query("locale")); locale != "" {
		requestLanguage = locale
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

			results[i] = saveSingleDeviceSnapshot(deviceID, time.Now(), requestLanguage)
		}(index, udid)
	}

	wg.Wait()
	for index := range results {
		if results[index].OK || results[index].errorSpec.Code == "" {
			continue
		}
		results[index].Error = translator.translateSpec(results[index].errorSpec)
		results[index].ErrorCode = results[index].errorSpec.Code
		results[index].ErrorParams = results[index].errorSpec.Params
		results[index].Detail = results[index].errorSpec.Detail
	}
	c.Header("Content-Language", translator.Locale())
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"results": results,
	})
}

func saveSingleDeviceSnapshot(udid string, now time.Time, requestLanguage string) snapshotSaveBatchResult {
	conn, deviceName, deviceIP, ok := resolveConnectedSnapshotTarget(udid)
	if !ok || conn == nil {
		return snapshotSaveBatchResult{
			UDID:      udid,
			OK:        false,
			errorSpec: messageSpec{Code: "error.device.offline"},
		}
	}

	data, err := captureDeviceScreenshot(udid, requestLanguage, batchSnapshotRequestTimeout)
	if err != nil {
		return snapshotSaveBatchResult{
			UDID:      udid,
			OK:        false,
			errorSpec: snapshotErrorSpec(err),
		}
	}

	path, err := persistDeviceScreenshot(deviceName, deviceIP, data, now)
	if err != nil {
		return snapshotSaveBatchResult{
			UDID:      udid,
			OK:        false,
			errorSpec: snapshotErrorSpec(err),
		}
	}

	return snapshotSaveBatchResult{
		UDID: udid,
		OK:   true,
		Path: path,
	}
}

func snapshotErrorSpec(err error) messageSpec {
	raw := strings.TrimSpace(err.Error())
	spec := resolveMessageSpec(raw)
	if _, known := translationCatalog[spec.Code]; known {
		return spec
	}
	return messageSpec{Code: "error.snapshot.failed", Detail: raw}
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

func requestDeviceScreenshotViaHTTPBin(udid, requestLanguage string, timeout time.Duration) ([]byte, error) {
	headers := map[string]string{}
	if requestLanguage = strings.TrimSpace(requestLanguage); requestLanguage != "" {
		headers["Accept-Language"] = requestLanguage
	}
	response, err := requestDeviceHTTPBin(udid, "GET", "/api/screen/snapshot", map[string]interface{}{
		"format": "png",
	}, headers, timeout)
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

func requestDeviceHTTPBin(udid, method, path string, query map[string]interface{}, headers map[string]string, timeout time.Duration) (internalHTTPBinResponse, error) {
	conn, _, _, ok := resolveConnectedSnapshotTarget(udid)
	if !ok || conn == nil {
		return internalHTTPBinResponse{}, errors.New("device is offline")
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return deviceHTTP(ctx, conn, udid, method, path, query, headers, nil)
}

// Internal IDs keep late replies private even after their request has been reclaimed.
const internalIDPrefix = "cc4d4350"

func deviceHTTP(ctx context.Context, conn *SafeConn, udid, method, path string, query map[string]any, headers map[string]string, body []byte) (internalHTTPBinResponse, error) {
	id, err := generateInternalHTTPBinRequestID()
	if err != nil {
		return internalHTTPBinResponse{}, err
	}
	id = internalIDPrefix + id[len(internalIDPrefix):]
	meta := map[string]any{"requestId": id, "method": method, "path": path, "bodySize": len(body), "chunkSize": internalHTTPBinChunkSize}
	if query != nil {
		meta["query"] = query
	}
	if headers != nil {
		meta["headers"] = headers
	}
	if deadline, ok := ctx.Deadline(); ok {
		meta["timeoutMs"] = max(int64(1), time.Until(deadline).Milliseconds())
	}
	payload, err := json.Marshal(Message{Type: "http/request-bin", Body: meta})
	if err != nil {
		return internalHTTPBinResponse{}, err
	}
	// 元数据和请求体一起排队。一旦发出元数据，应发完同一请求的分片，以免设备永久等待剩余部分。
	frames := [][]byte{payload}
	if len(body) > 0 {
		rawID, _ := hex.DecodeString(id)
		total := (len(body) + internalHTTPBinChunkSize - 1) / internalHTTPBinChunkSize

		for i := 0; i < total; i++ {
			chunk := body[i*internalHTTPBinChunkSize : min((i+1)*internalHTTPBinChunkSize, len(body))]
			frame := make([]byte, binaryHeaderSize+len(chunk))
			copy(frame, rawID)
			binary.BigEndian.PutUint32(frame[16:20], uint32(i))
			binary.BigEndian.PutUint32(frame[20:24], uint32(total))
			copy(frame[24:], chunk)
			frames = append(frames, frame)
		}
	}
	return awaitDeviceReply(ctx, conn, udid, id, websocketWrite{messageType: websocket.BinaryMessage, firstIsText: true, payloads: frames})
}

func awaitDeviceReply(ctx context.Context, conn *SafeConn, udid, id string, write websocketWrite) (internalHTTPBinResponse, error) {
	mu.RLock()
	if conn == nil || deviceLinks[udid] != conn {
		mu.RUnlock()
		return internalHTTPBinResponse{}, errors.New("device disconnected")
	}
	req := registerInternalHTTPBinRequest(id, udid, conn)
	mu.RUnlock()
	defer cancelInternalHTTPBinRequest(id, "request canceled")
	write.result = make(chan error, 1)
	write.beforeWrite = func() error {
		if e := ctx.Err(); e != nil {
			return e
		}
		mu.RLock()
		defer mu.RUnlock()
		if deviceLinks[udid] != conn {
			return errors.New("device disconnected")
		}
		return nil
	}
	if err := conn.enqueueWrite(write); err != nil {
		return internalHTTPBinResponse{}, err
	}
	select {
	case err := <-write.result:
		if err != nil {
			return internalHTTPBinResponse{}, err
		}
	case <-conn.writeClosed:
		return internalHTTPBinResponse{}, errors.New("device disconnected")
	case <-ctx.Done():
		return internalHTTPBinResponse{}, ctx.Err()
	}
	select {
	case <-req.Done:
		return req.Result, nil
	case <-ctx.Done():
		return internalHTTPBinResponse{}, ctx.Err()
	}
}

func generateInternalHTTPBinRequestID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

func registerInternalHTTPBinRequest(requestID, deviceUDID string, conn *SafeConn) *internalHTTPBinRequestState {
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	state := &internalHTTPBinRequestState{
		RequestID:  requestID,
		DeviceUDID: deviceUDID, Conn: conn,
		Done: make(chan struct{}),
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

func abortInternalHTTPBinRequestsForDevice(conn *SafeConn, reason string) {
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	for _, state := range internalHTTPBinRequests {
		if state.Conn != conn || state.Completed {
			continue
		}
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{
			Error: strings.TrimSpace(reason),
		})
	}
}

func handleInternalHTTPResponseBinMeta(conn *SafeConn, data Message) bool {
	bodyMap, err := decodeBodyMap(data.Body)
	if err != nil {
		return false
	}
	requestID, ok := toString(bodyMap["requestId"])
	if !ok || strings.TrimSpace(requestID) == "" {
		return false
	}
	if strings.HasPrefix(requestID, mcpSnapshotPrefix) {
		return true
	}

	deviceUDID, known := getDeviceUDIDByConn(conn)
	if !known {
		return strings.HasPrefix(requestID, internalIDPrefix)
	}

	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	state, exists := internalHTTPBinRequests[requestID]
	if !exists {
		return strings.HasPrefix(requestID, internalIDPrefix)
	}
	if state.Conn != conn || state.DeviceUDID != deviceUDID || state.Completed {
		return true
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
		completeInternalHTTPBinBodyLocked(state)
	}
	return true
}

func handleInternalHTTPResponseBinChunk(conn *SafeConn, requestID string, seq, total uint32, chunk []byte) bool {
	deviceUDID, ok := getDeviceUDIDByConn(conn)
	if !ok {
		return strings.HasPrefix(requestID, internalIDPrefix)
	}

	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()

	state, exists := internalHTTPBinRequests[requestID]
	if !exists {
		return strings.HasPrefix(requestID, internalIDPrefix)
	}
	if state.Conn != conn || state.DeviceUDID != deviceUDID || state.Completed {
		return true
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
		completeInternalHTTPBinBodyLocked(state)
	}
	return true
}

func completeInternalHTTPBinBodyLocked(state *internalHTTPBinRequestState) {
	if state.ReceivedBytes != state.BodySize {
		finalizeInternalHTTPBinRequestLocked(state, internalHTTPBinResponse{Error: "response body size mismatch"})
		return
	}
	body := make([]byte, 0, state.BodySize)
	for _, chunk := range state.Chunks {
		body = append(body, chunk...)
	}
	state.Result.Body = body
	finalizeInternalHTTPBinRequestLocked(state, state.Result)
}

func finalizeInternalHTTPBinRequestLocked(state *internalHTTPBinRequestState, result internalHTTPBinResponse) {
	if state.Completed {
		return
	}
	state.Completed = true
	state.Result = result
	delete(internalHTTPBinRequests, state.RequestID)

	close(state.Done)
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
