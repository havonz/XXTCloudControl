package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestPullWaitsForDeviceDownloadCompletion(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	contents := bytes.Repeat([]byte("x"), 128*1024)
	if err := os.WriteFile(filepath.Join(dataDir, "files", "source.bin"), contents, 0644); err != nil {
		t.Fatal(err)
	}
	writes := make(chan recordedWebSocketWrite, 8)
	conn := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
		writes <- recordedWebSocketWrite{messageType: typ, data: data}
		return nil
	}}
	setupHTTPBinProxyTestState(t, nil, conn)
	t.Cleanup(func() { _ = conn.Close() })
	mu.Lock()
	deviceLinksMap[conn] = "device-http-bin"
	mu.Unlock()
	push := func() *httptest.ResponseRecorder {
		return performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", map[string]any{
			"deviceSN": "device-http-bin", "category": "files", "path": "source.bin", "targetPath": "/res/source.bin",
		}, pushFileToDeviceHandler)
	}
	pull := func() *httptest.ResponseRecorder {
		return performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device?locale=en-US", map[string]any{
			"deviceSN": "device-http-bin", "sourcePath": "res/./source.bin", "category": "files", "path": "received.bin",
		}, pullFileFromDeviceHandler)
	}
	if response := push(); response.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", response.Code, response.Body)
	}
	var fetch struct {
		Body struct{ URL, RequestID string }
	}
	if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &fetch); err != nil {
		t.Fatal(err)
	}
	if fetch.Body.RequestID == "" {
		t.Fatal("download cannot be correlated with its device completion")
	}
	if response := pull(); response.Code != http.StatusConflict || !bytes.Contains(response.Body.Bytes(), []byte("error.transfer.file_busy")) {
		t.Fatalf("pull raced a queued download: %d %s", response.Code, response.Body)
	}
	u, err := url.Parse(fetch.Body.URL)
	if err != nil {
		t.Fatal(err)
	}
	download := httptest.NewRecorder()
	requestTransferDownload(filepath.Base(u.Path), download)
	if download.Code != http.StatusOK || !bytes.Equal(download.Body.Bytes(), contents) {
		t.Fatal("server download did not complete")
	}
	if response := pull(); response.Code != http.StatusConflict {
		t.Fatalf("server HTTP completion prematurely unlocked the device file: %d", response.Code)
	}
	completeDeviceFileTransfer("another-device", "download", map[string]interface{}{
		"requestId": fetch.Body.RequestID, "success": true,
	})
	if response := pull(); response.Code != http.StatusConflict {
		t.Fatal("another device released the file")
	}
	if err := handleMessage(conn, Message{Type: "transfer/fetch/complete", Body: map[string]interface{}{
		"requestId": fetch.Body.RequestID, "targetPath": "/res/source.bin", "success": true,
	}}); err != nil {
		t.Fatal(err)
	}
	response := pull()
	if response.Code != http.StatusOK {
		t.Fatalf("completed download left the file busy: %d %s", response.Code, response.Body)
	}
	var result struct{ Token string }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response := push(); response.Code != http.StatusConflict {
		t.Fatal("a new download overwrote a file being uploaded")
	}
	upload := requestTransferUpload(result.Token, bytes.NewReader(contents), int64(len(contents)))
	if upload.Code != http.StatusOK {
		t.Fatalf("upload failed: %d %s", upload.Code, upload.Body)
	}
	if response := push(); response.Code != http.StatusOK {
		t.Fatalf("completed upload left the file busy: %d %s", response.Code, response.Body)
	}
}

func TestScriptDistributionTracksDeviceFilesUntilLegacyCompletion(t *testing.T) {
	for _, handler := range []struct {
		name string
		fn   func(*gin.Context)
	}{{"send", scriptsSendHandler}, {"send-and-start", scriptsSendAndStartHandler}} {
		t.Run(handler.name, func(t *testing.T) {
			dataDir := setupTempTransferCleanupTest(t)
			resetScriptPackageCacheForTest()
			resetScriptStartSessionsForTest()
			t.Cleanup(resetScriptPackageCacheForTest)
			t.Cleanup(resetScriptStartSessionsForTest)
			dir := filepath.Join(dataDir, "scripts", "bundle")
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "large.bin"), make([]byte, scriptLargeFileThreshold), 0644); err != nil {
				t.Fatal(err)
			}
			writes := make(chan recordedWebSocketWrite, 8)
			conn := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
				writes <- recordedWebSocketWrite{messageType: typ, data: data}
				return nil
			}}
			setupHTTPBinProxyTestState(t, nil, conn)
			t.Cleanup(func() { _ = conn.Close() })
			mu.Lock()
			deviceLinksMap[conn] = "device-http-bin"
			mu.Unlock()
			response := performJSONHandlerRequest(t, http.MethodPost, "/api/scripts/"+handler.name, map[string]any{
				"devices": []string{"device-http-bin"}, "name": "bundle",
			}, handler.fn)
			if response.Code != http.StatusOK {
				t.Fatalf("script distribution failed: %d %s", response.Code, response.Body)
			}
			_ = receiveWebSocketWrite(t, writes)
			pull := func() *httptest.ResponseRecorder {
				return performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
					"deviceSN": "device-http-bin", "sourcePath": "/lua/scripts/bundle/large.bin", "category": "files", "path": "received.bin",
				}, pullFileFromDeviceHandler)
			}
			if response := pull(); response.Code != http.StatusConflict {
				t.Fatalf("script download did not protect its destination: %d %s", response.Code, response.Body)
			}
			if err := handleMessage(conn, Message{Type: "transfer/fetch/complete", Body: map[string]interface{}{
				"targetPath": "lua/scripts/bundle/large.bin", "success": false, "error": "download interrupted",
			}}); err != nil {
				t.Fatal(err)
			}
			if response := pull(); response.Code != http.StatusOK {
				t.Fatalf("legacy failure did not release the path: %d %s", response.Code, response.Body)
			}
		})
	}
}

func TestDeviceFileTransferExpirationAndStaleCompletion(t *testing.T) {
	resetTransferTokensForTest()
	t.Cleanup(resetTransferTokensForTest)
	if err := beginDeviceFileTransfer("device-a", "/res/file", "old", "download", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := beginDeviceFileTransfer("device-a", "res/file", "new", "download", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	completeDeviceFileTransfer("device-a", "download", map[string]interface{}{
		"requestId": "old", "targetPath": "/res/file", "success": true,
	})
	if err := beginDeviceFileTransfer("device-a", "res/./file", "blocked", "upload", time.Now().Add(time.Minute)); err != errDeviceFileTransferBusy {
		t.Fatal("stale completion released the newer transfer")
	}
	for _, item := range []struct{ device, path, id string }{{"device-b", "res/file", "other-device"}, {"device-a", "res/another", "other-path"}} {
		if err := beginDeviceFileTransfer(item.device, item.path, item.id, "upload", time.Now().Add(-time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	cleanupExpiredTokens()
	deviceFileTransfers.Lock()
	defer deviceFileTransfers.Unlock()
	if len(deviceFileTransfers.byPath) != 1 || len(deviceFileTransfers.byID) != 1 || deviceFileTransfers.byID["new"] == nil {
		t.Fatalf("expiration retained stale entries or removed active work: %v", deviceFileTransfers.byID)
	}
}

func TestFailedUploadCompletionReleasesDeviceFile(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		name := "request_id"
		if legacy {
			name = "legacy_path"
		}
		t.Run(name, func(t *testing.T) {
			setupTempTransferCleanupTest(t)
			writes := make(chan recordedWebSocketWrite, 4)
			conn := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
				writes <- recordedWebSocketWrite{messageType: typ, data: data}
				return nil
			}}
			setupHTTPBinProxyTestState(t, nil, conn)
			t.Cleanup(func() { _ = conn.Close() })
			mu.Lock()
			deviceLinksMap[conn] = "device-http-bin"
			mu.Unlock()
			request := map[string]any{"deviceSN": "device-http-bin", "sourcePath": "/res/file.bin", "category": "files", "path": "received.bin"}
			response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", request, pullFileFromDeviceHandler)
			if response.Code != http.StatusOK {
				t.Fatalf("pull failed: %d %s", response.Code, response.Body)
			}
			var message Message
			if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &message); err != nil {
				t.Fatal(err)
			}
			body := map[string]interface{}{"sourcePath": "res/./file.bin", "success": false, "error": "source is unavailable"}
			if !legacy {
				body["requestId"] = message.Body.(map[string]interface{})["requestId"]
			}
			if err := handleMessage(conn, Message{Type: "transfer/send/complete", Body: body}); err != nil {
				t.Fatal(err)
			}
			response = performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", request, pullFileFromDeviceHandler)
			if response.Code != http.StatusOK {
				t.Fatalf("failed upload left the path busy: %d %s", response.Code, response.Body)
			}
			if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &message); err != nil {
				t.Fatal(err)
			}
			message.Error = "file not found"
			if err := handleMessage(conn, message); err != nil {
				t.Fatal(err)
			}
			deviceFileTransfers.Lock()
			remaining := len(deviceFileTransfers.byID)
			deviceFileTransfers.Unlock()
			if remaining != 0 {
				t.Fatal("an immediate command failure retained a transfer")
			}
		})
	}
}

func TestScriptSendReportsBusySmallAndLargeTargets(t *testing.T) {
	for _, size := range []int{8, scriptLargeFileThreshold} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			dataDir := setupTempTransferCleanupTest(t)
			resetScriptPackageCacheForTest()
			t.Cleanup(resetScriptPackageCacheForTest)
			dir := filepath.Join(dataDir, "scripts", "bundle")
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "file.bin"), make([]byte, size), 0644); err != nil {
				t.Fatal(err)
			}
			writes := make(chan recordedWebSocketWrite, 4)
			conn := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
				writes <- recordedWebSocketWrite{messageType: typ, data: data}
				return nil
			}}
			setupHTTPBinProxyTestState(t, nil, conn)
			t.Cleanup(func() { _ = conn.Close() })
			if err := beginDeviceFileTransfer("device-http-bin", "/lua/scripts/bundle/file.bin", "pull-in-progress", "upload", time.Now().Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			request := map[string]any{"devices": []string{"device-http-bin"}, "name": "bundle"}
			response := performJSONHandlerRequest(t, http.MethodPost, "/api/scripts/send", request, scriptsSendHandler)
			if response.Code != http.StatusConflict || !bytes.Contains(response.Body.Bytes(), []byte("error.transfer.file_busy")) {
				t.Fatalf("script upload falsely reported success: %d %s", response.Code, response.Body)
			}
			select {
			case <-writes:
				t.Fatal("a busy script file was overwritten")
			default:
			}
			finishDeviceFileTransfer("pull-in-progress")
			response = performJSONHandlerRequest(t, http.MethodPost, "/api/scripts/send", request, scriptsSendHandler)
			if response.Code != http.StatusOK {
				t.Fatalf("retry failed after completion: %d %s", response.Code, response.Body)
			}
			_ = receiveWebSocketWrite(t, writes)
		})
	}
}
