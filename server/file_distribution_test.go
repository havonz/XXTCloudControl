package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type filePushTestResult struct {
	DeviceSN    string         `json:"deviceSN"`
	Success     bool           `json:"success"`
	Method      string         `json:"method"`
	Token       string         `json:"token"`
	TotalBytes  int64          `json:"totalBytes"`
	MD5         string         `json:"md5"`
	Error       string         `json:"error"`
	ErrorCode   string         `json:"errorCode"`
	ErrorParams map[string]any `json:"errorParams"`
}

func decodeFilePushBatch(t *testing.T, response *httptest.ResponseRecorder) []filePushTestResult {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("batch response: %d %s", response.Code, response.Body)
	}
	var result struct {
		Success bool                 `json:"success"`
		Results []filePushTestResult `json:"results"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatal("batch was not accepted")
	}
	return result.Results
}

func installFilePushTestDevices(t *testing.T, devices map[string]*SafeConn) {
	t.Helper()
	setupHTTPBinProxyTestState(t, nil, nil)
	mu.Lock()
	deviceLinks = devices
	mu.Unlock()
	t.Cleanup(func() {
		for _, conn := range devices {
			_ = conn.Close()
		}
	})
}

func TestBatchFilePushReusesSmallPayloadFor400Devices(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	path := filepath.Join(dataDir, "files", "source.bin")
	contents := bytes.Repeat([]byte{0, 127, 255}, 40000)
	if err := os.WriteFile(path, contents, 0644); err != nil {
		t.Fatal(err)
	}
	deviceIDs := make([]string, 400)
	devices := make(map[string]*SafeConn, 400)
	var writesMu sync.Mutex
	var firstPayload []byte
	writes, samePayload := 0, true
	var removeErr error
	for index := range deviceIDs {
		id := fmt.Sprintf("device-%d", index)
		deviceIDs[index] = id
		devices[id] = &SafeConn{writeMessageHook: func(_ int, payload []byte) error {
			writesMu.Lock()
			defer writesMu.Unlock()
			if firstPayload == nil {
				firstPayload = payload
				// 后续设备仍必须收到准备好的内容，不能再次读取已经消失的源文件。
				removeErr = os.Remove(path)
			} else if &firstPayload[0] != &payload[0] {
				samePayload = false
			}
			writes++
			return nil
		}}
	}
	installFilePushTestDevices(t, devices)
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-devices", map[string]any{
		"deviceSNs": deviceIDs, "category": "files", "path": "source.bin", "targetPath": "/res/资源.bin",
	}, pushFileToDevicesHandler)
	results := decodeFilePushBatch(t, response)
	if writes != 400 || !samePayload || removeErr != nil {
		t.Fatalf("payload reuse: writes=%d same=%v remove=%v", writes, samePayload, removeErr)
	}
	if len(results) != len(deviceIDs) {
		t.Fatalf("result count: %d", len(results))
	}
	for index, result := range results {
		if !result.Success || result.DeviceSN != deviceIDs[index] || result.Method != "file/put" || result.TotalBytes != int64(len(contents)) {
			t.Fatalf("incorrect result %d: %+v", index, result)
		}
	}
	var message struct {
		Type string
		Body struct{ Path, Data string }
	}
	if err := json.Unmarshal(firstPayload, &message); err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.DecodeString(message.Body.Data)
	if err != nil || !bytes.Equal(decoded, contents) || message.Type != "file/put" || message.Body.Path != "/res/资源.bin" {
		t.Fatalf("file content or target changed: %v", err)
	}
}

func TestBatchFilePushBoundsConcurrencyAndPreservesFailureOrder(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	if err := os.WriteFile(filepath.Join(dataDir, "files", "source.txt"), []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{}, 20)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var active, peak atomic.Int32
	ids := make([]string, 20)
	devices := make(map[string]*SafeConn)
	for index := range ids {
		id := fmt.Sprintf("device-%d", index)
		ids[index] = id
		devices[id] = &SafeConn{writeMessageHook: func(_ int, _ []byte) error {
			current := active.Add(1)
			defer active.Add(-1)
			for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
			}
			started <- struct{}{}
			<-release
			return nil
		}}
	}
	ids = append(ids, "offline", "broken")
	devices["broken"] = &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return errors.New("write failed") }}
	installFilePushTestDevices(t, devices)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-devices?locale=en-US", map[string]any{
			"deviceSNs": ids, "category": "files", "path": "source.txt", "targetPath": "/res/source.txt",
		}, pushFileToDevicesHandler)
		close(done)
	}()
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(release) })
		<-done
	})
	for index := 0; index < filePushConcurrency; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("workers did not start")
		}
	}
	select {
	case <-started:
		t.Fatal("more than six sends started while the first six were blocked")
	case <-time.After(30 * time.Millisecond):
	}
	releaseOnce.Do(func() { close(release) })
	results := decodeFilePushBatch(t, <-done)
	if peak.Load() != filePushConcurrency || len(results) != len(ids) {
		t.Fatalf("concurrency=%d results=%d", peak.Load(), len(results))
	}
	for index, result := range results {
		if result.DeviceSN != ids[index] || result.Success != (index < 20) {
			t.Fatalf("result order or status changed at %d: %+v", index, result)
		}
	}
	if results[20].ErrorCode != "error.device.not_connected" || results[21].ErrorCode != "error.transfer.send_device_failed" || results[20].Error == "" {
		t.Fatalf("missing localized failures: %+v", results[20:])
	}
}

func TestBatchFilePushKeepsLargeTempSourceForQueuedDevices(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	path := filepath.Join(dataDir, "files", "_temp", "upload-batch", "source.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	contents := bytes.Repeat([]byte("x"), 128*1024)
	if err := os.WriteFile(path, contents, 0644); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{}, 8)
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var downloaded atomic.Int32
	ids := make([]string, 8)
	devices := make(map[string]*SafeConn)
	tokens := make(chan string, 8)
	for index := range ids {
		id := fmt.Sprintf("device-%d", index)
		ids[index] = id
		devices[id] = &SafeConn{writeMessageHook: func(_ int, payload []byte) error {
			var command struct {
				Type string
				Body struct {
					URL, TargetPath, MD5 string
					Timeout              int
				}
			}
			if err := json.Unmarshal(payload, &command); err != nil {
				return err
			}
			parsed, err := url.Parse(command.Body.URL)
			if err != nil || parsed.Host != "files.example" || command.Type != "transfer/fetch" || command.Body.TargetPath != "/res/source.bin" || command.Body.Timeout != 123 || len(command.Body.MD5) != 32 {
				return errors.New("changed transfer command")
			}
			token := filepath.Base(parsed.Path)
			tokens <- token
			response := httptest.NewRecorder()
			requestTransferDownload(token, response)
			if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), contents) {
				return errors.New("download lost its source")
			}
			downloaded.Add(1)
			started <- struct{}{}
			<-release
			return nil
		}}
	}
	ids = append(ids, "offline")
	installFilePushTestDevices(t, devices)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-devices", map[string]any{
			"deviceSNs": ids, "category": "files", "path": "_temp/upload-batch/source.bin", "targetPath": "/res/source.bin",
			"timeout": 123, "serverBaseUrl": "http://files.example",
		}, pushFileToDevicesHandler)
		close(done)
	}()
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(release) })
		<-done
	})
	for index := 0; index < filePushConcurrency; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("first wave did not download")
		}
	}
	time.Sleep(30 * time.Millisecond)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("completed first wave deleted source before queued devices: %v", err)
	}
	releaseOnce.Do(func() { close(release) })
	results := decodeFilePushBatch(t, <-done)
	if downloaded.Load() != 8 || len(results) != 9 || results[8].Success {
		t.Fatalf("downloads=%d results=%+v", downloaded.Load(), results)
	}
	uniqueTokens := make(map[string]bool)
	sentTokens := make(map[string]bool)
	for index := 0; index < 8; index++ {
		sentTokens[<-tokens] = true
	}
	for index := 0; index < 8; index++ {
		if !results[index].Success || results[index].DeviceSN != ids[index] || results[index].Method != "transfer/fetch" || uniqueTokens[results[index].Token] || !sentTokens[results[index].Token] {
			t.Fatalf("invalid per-device token: %+v", results[index])
		}
		uniqueTokens[results[index].Token] = true
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(filepath.Dir(path))
		return os.IsNotExist(err)
	}) {
		t.Fatal("completed batch left its source directory behind")
	}
}

func TestSingleFilePushKeepsProtocolAtSizeBoundary(t *testing.T) {
	for _, size := range []int{0, 128*1024 - 1, 128 * 1024} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			dataDir := setupTempTransferCleanupTest(t)
			if err := os.WriteFile(filepath.Join(dataDir, "files", "source.bin"), make([]byte, size), 0644); err != nil {
				t.Fatal(err)
			}
			installFilePushTestDevices(t, map[string]*SafeConn{"a": {writeMessageHook: func(_ int, _ []byte) error { return nil }}})
			request := map[string]any{"deviceSN": "a", "deviceSNs": []string{"a", " a ", ""}, "category": "files", "path": "source.bin", "targetPath": "/res/source.bin"}
			single := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", request, pushFileToDeviceHandler)
			if single.Code != http.StatusOK {
				t.Fatalf("legacy endpoint failed: %d %s", single.Code, single.Body)
			}
			var original filePushTestResult
			if err := json.Unmarshal(single.Body.Bytes(), &original); err != nil {
				t.Fatal(err)
			}
			completeDeviceFileTransfer("a", "download", map[string]interface{}{"targetPath": "/res/source.bin", "success": true})
			batch := decodeFilePushBatch(t, performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-devices", request, pushFileToDevicesHandler))
			expectedMethod := "file/put"
			if size >= 128*1024 {
				expectedMethod = "transfer/fetch"
			}
			if !original.Success || original.Method != expectedMethod || len(batch) != 1 || batch[0].Method != original.Method || batch[0].TotalBytes != original.TotalBytes || batch[0].MD5 != original.MD5 {
				t.Fatalf("single/batch protocol mismatch: %+v %+v", original, batch)
			}
		})
	}
}

func TestBatchFilePushCancelledRequestReleasesTempSource(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	path := filepath.Join(dataDir, "files", "_temp", "upload-canceled", "source.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, 128*1024), 0644); err != nil {
		t.Fatal(err)
	}
	var writes atomic.Int32
	installFilePushTestDevices(t, map[string]*SafeConn{"a": {writeMessageHook: func(_ int, _ []byte) error { writes.Add(1); return nil }}})
	body, err := json.Marshal(map[string]any{
		"deviceSNs": []string{"a", "b"}, "category": "files", "path": "_temp/upload-canceled/source.bin", "targetPath": "/res/source.bin",
	})
	if err != nil {
		t.Fatal(err)
	}
	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/transfer/push-to-devices", bytes.NewReader(body)).WithContext(requestContext)
	c.Request.Header.Set("Content-Type", "application/json")
	pushFileToDevicesHandler(c)
	results := decodeFilePushBatch(t, response)
	if writes.Load() != 0 || len(results) != 2 || results[0].Success || results[1].Success {
		t.Fatalf("canceled batch sent commands: writes=%d results=%+v", writes.Load(), results)
	}
	transferTokensMu.RLock()
	tokenCount := len(transferTokens)
	transferTokensMu.RUnlock()
	if tokenCount != 0 {
		t.Fatalf("canceled batch created %d download tokens", tokenCount)
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(filepath.Dir(path))
		return os.IsNotExist(err)
	}) {
		t.Fatal("canceled batch retained its temporary source")
	}
}

func TestBatchFilePushValidationAndAuthentication(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	if err := os.WriteFile(filepath.Join(dataDir, "files", "source.txt"), []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "outside.txt"), []byte("outside category"), 0644); err != nil {
		t.Fatal(err)
	}
	var writes atomic.Int32
	installFilePushTestDevices(t, map[string]*SafeConn{"a": {writeMessageHook: func(_ int, _ []byte) error { writes.Add(1); return nil }}})
	for _, test := range []struct {
		name, path string
		devices    []string
		status     int
	}{
		{"no devices", "source.txt", nil, http.StatusBadRequest},
		{"blank device", "source.txt", []string{" "}, http.StatusBadRequest},
		{"missing source", "missing.txt", []string{"a"}, http.StatusNotFound},
		{"directory source", ".", []string{"a"}, http.StatusBadRequest},
		{"outside category", "../outside.txt", []string{"a"}, http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-devices", map[string]any{
				"deviceSNs": test.devices, "category": "files", "path": test.path, "targetPath": "/res/source.txt",
			}, pushFileToDevicesHandler)
			if response.Code != test.status {
				t.Fatalf("status=%d expected=%d body=%s", response.Code, test.status, response.Body)
			}
		})
	}
	router := gin.New()
	router.Use(apiAuthMiddleware())
	router.POST("/api/transfer/push-to-devices", pushFileToDevicesHandler)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/transfer/push-to-devices", bytes.NewBufferString(`{"deviceSNs":["a"],"category":"files","path":"source.txt","targetPath":"/res/source.txt"}`)))
	if response.Code != http.StatusUnauthorized || writes.Load() != 0 {
		t.Fatalf("invalid request reached a device: status=%d writes=%d", response.Code, writes.Load())
	}
}
