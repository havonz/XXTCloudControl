package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestWebSocketFilePutRespectsActiveTransfers(t *testing.T) {
	for _, mode := range []string{"control/command", "control/commands"} {
		t.Run(mode, func(t *testing.T) {
			resetTransferTokensForTest()
			t.Cleanup(resetTransferTokensForTest)
			deviceWrites := make(chan recordedWebSocketWrite, 4)
			responses := make(chan recordedWebSocketWrite, 4)
			device := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
				deviceWrites <- recordedWebSocketWrite{messageType: typ, data: data}
				return nil
			}}
			controller := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
				responses <- recordedWebSocketWrite{messageType: typ, data: data}
				return nil
			}}
			setupHTTPBinProxyTestState(t, controller, device)
			t.Cleanup(func() { _ = device.Close(); _ = controller.Close() })
			if err := beginDeviceFileTransfer("device-http-bin", "/res/file.txt", "active-pull", "upload", time.Now().Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			fileBody := map[string]interface{}{"path": "res/./file.txt", "data": "c2VjcmV0IHBheWxvYWQ="}
			body := map[string]interface{}{"devices": []string{"device-http-bin"}, "type": "file/put", "body": fileBody, "requestId": "put-request"}
			if mode == "control/commands" {
				body = map[string]interface{}{"devices": []string{"device-http-bin"}, "commands": []interface{}{
					map[string]interface{}{"type": "file/put", "body": fileBody},
				}}
			}
			if err := handleMessage(controller, signTestControlMessage(t, mode, body, "busy-put")); err != nil {
				t.Fatal(err)
			}
			select {
			case <-deviceWrites:
				t.Fatal("file/put bypassed the active transfer guard")
			case reply := <-responses:
				var result struct {
					Type, UDID, RequestID, Error, ErrorCode string
					Body                                    map[string]interface{}
				}
				if err := json.Unmarshal(reply.data, &result); err != nil {
					t.Fatal(err)
				}
				if result.Type != "file/put" || result.UDID != "device-http-bin" || result.ErrorCode != "error.transfer.file_busy" || result.Error == "" {
					t.Fatalf("missing structured rejection: %+v", result)
				}
				if mode == "control/command" && result.RequestID != "put-request" {
					t.Fatal("request ID was lost")
				}
				if _, present := result.Body["data"]; present {
					t.Fatal("file contents were echoed in the error")
				}
			case <-time.After(time.Second):
				t.Fatal("no upload rejection was delivered")
			}
			finishDeviceFileTransfer("active-pull")
			if err := handleMessage(controller, signTestControlMessage(t, mode, body, "retry-put")); err != nil {
				t.Fatal(err)
			}
			var forwarded Message
			if err := json.Unmarshal(receiveWebSocketWrite(t, deviceWrites).data, &forwarded); err != nil {
				t.Fatal(err)
			}
			if forwarded.Type != "file/put" || forwarded.Body.(map[string]interface{})["data"] != fileBody["data"] {
				t.Fatalf("retry changed the file payload: %+v", forwarded)
			}
		})
	}
}

func TestWebSocketFilePutConflictIsIsolatedToItsDeviceAndPath(t *testing.T) {
	resetTransferTokensForTest()
	t.Cleanup(resetTransferTokensForTest)
	writes := make(chan struct {
		device string
		data   []byte
	}, 8)
	responses := make(chan recordedWebSocketWrite, 8)
	controller := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
		responses <- recordedWebSocketWrite{messageType: typ, data: data}
		return nil
	}}
	setupHTTPBinProxyTestState(t, controller, nil)
	devices := make(map[string]*SafeConn)
	for _, id := range []string{"busy", "ready"} {
		id := id
		devices[id] = &SafeConn{writeMessageHook: func(_ int, data []byte) error {
			writes <- struct {
				device string
				data   []byte
			}{id, data}
			return nil
		}}
	}
	mu.Lock()
	deviceLinks = devices
	mu.Unlock()
	t.Cleanup(func() {
		_ = controller.Close()
		for _, device := range devices {
			_ = device.Close()
		}
	})
	if err := beginDeviceFileTransfer("busy", "/res/file.txt", "active-download", "download", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	body := map[string]interface{}{
		"devices": []string{"busy", "ready"},
		"commands": []interface{}{
			map[string]interface{}{"type": "key/down", "body": map[string]interface{}{"code": "SHIFT"}},
			map[string]interface{}{"type": "file/put", "body": map[string]interface{}{"path": "/res/file.txt", "data": "Zmlyc3Q="}},
			map[string]interface{}{"type": "file/put", "body": map[string]interface{}{"path": "/res/another.txt", "data": "c2Vjb25k"}},
			map[string]interface{}{"type": "key/up", "body": map[string]interface{}{"code": "SHIFT"}},
		},
	}
	if err := handleMessage(controller, signTestControlMessage(t, "control/commands", body, "mixed-file-batch")); err != nil {
		t.Fatal(err)
	}
	sequences := map[string][]string{}
	for index := 0; index < 7; index++ {
		select {
		case write := <-writes:
			var message Message
			if err := json.Unmarshal(write.data, &message); err != nil {
				t.Fatal(err)
			}
			name := message.Type
			if name == "file/put" {
				name += ":" + message.Body.(map[string]interface{})["path"].(string)
			}
			sequences[write.device] = append(sequences[write.device], name)
		case <-time.After(time.Second):
			t.Fatal("an unrelated command or device was blocked")
		}
	}
	for id, expected := range map[string][]string{
		"busy":  {"key/down", "file/put:/res/another.txt", "key/up"},
		"ready": {"key/down", "file/put:/res/file.txt", "file/put:/res/another.txt", "key/up"},
	} {
		actual, _ := json.Marshal(sequences[id])
		want, _ := json.Marshal(expected)
		if string(actual) != string(want) {
			t.Fatalf("%s command order: %s", id, actual)
		}
	}
	for {
		var response Message
		if err := json.Unmarshal(receiveWebSocketWrite(t, responses).data, &response); err != nil {
			t.Fatal(err)
		}
		if response.Type == "file/put" {
			if response.UDID != "busy" || response.Error == "" {
				t.Fatalf("wrong rejection target: %+v", response)
			}
			break
		}
	}
}

func TestWebSocketFilePutKeepsSlowWritesAsynchronousAndOrdered(t *testing.T) {
	setupTempTransferCleanupTest(t)
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	writes := make(chan recordedWebSocketWrite, 2)
	device := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
		var message Message
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		if message.Type == "file/put" {
			close(started)
			<-release
		}
		writes <- recordedWebSocketWrite{messageType: typ, data: data}
		return nil
	}}
	controller := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, controller, device)
	t.Cleanup(func() { _ = device.Close(); _ = controller.Close() })
	command := signTestControlMessage(t, "control/command", map[string]interface{}{
		"devices": []string{"device-http-bin"}, "type": "file/put", "requestId": "ordered-put",
		"body": map[string]interface{}{"path": "/res/file.txt", "data": "cGF5bG9hZA=="},
	}, "slow-put")
	done := make(chan error, 1)
	go func() { done <- handleMessage(controller, command) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("file write did not start")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("slow device blocked the controller handler")
	}
	pullDone := make(chan int, 1)
	go func() {
		response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
			"deviceSN": "device-http-bin", "sourcePath": "/res/file.txt", "category": "files", "path": "received.txt",
		}, pullFileFromDeviceHandler)
		pullDone <- response.Code
	}()
	releaseOnce.Do(func() { close(release) })
	select {
	case code := <-pullDone:
		if code != http.StatusOK {
			t.Fatalf("queued pull failed: %d", code)
		}
	case <-time.After(time.Second):
		t.Fatal("queued pull did not finish")
	}
	for _, expected := range []string{"file/put", "transfer/send"} {
		var message Message
		if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type != expected {
			t.Fatalf("file operation order changed: got %s want %s", message.Type, expected)
		}
	}
}

func TestWebSocketFilePutEnqueueFailureReleasesPath(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	responses := make(chan recordedWebSocketWrite, 2)
	device := &SafeConn{}
	_ = device.Close()
	controller := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
		responses <- recordedWebSocketWrite{messageType: typ, data: data}
		return nil
	}}
	setupHTTPBinProxyTestState(t, controller, device)
	t.Cleanup(func() { _ = controller.Close() })
	command := signTestControlMessage(t, "control/command", map[string]interface{}{
		"devices": []string{"device-http-bin"}, "type": "file/put", "requestId": "failed-put",
		"body": map[string]interface{}{"path": "/res/file.txt", "data": "cGF5bG9hZA=="},
	}, "closed-put")
	if err := handleMessage(controller, command); err != nil {
		t.Fatal(err)
	}
	var response Message
	if err := json.Unmarshal(receiveWebSocketWrite(t, responses).data, &response); err != nil {
		t.Fatal(err)
	}
	if response.Type != "file/put" || response.Error == "" || response.RequestID != "failed-put" {
		t.Fatalf("enqueue failure was not reported: %+v", response)
	}
	deviceFileTransfers.Lock()
	remaining := len(deviceFileTransfers.byID)
	deviceFileTransfers.Unlock()
	if remaining != 0 {
		t.Fatal("failed enqueue retained its path reservation")
	}
	// 重连后的普通 HTTP 上传也必须能继续使用这个路径。
	if err := os.WriteFile(filepath.Join(dataDir, "files", "source.txt"), []byte("retry"), 0644); err != nil {
		t.Fatal(err)
	}
	reconnected := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	mu.Lock()
	deviceLinks["device-http-bin"] = reconnected
	mu.Unlock()
	t.Cleanup(func() { _ = reconnected.Close() })
	retry := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", map[string]any{
		"deviceSN": "device-http-bin", "category": "files", "path": "source.txt", "targetPath": "/res/file.txt",
	}, pushFileToDeviceHandler)
	if retry.Code != http.StatusOK {
		t.Fatalf("retry after enqueue failure: %d %s", retry.Code, retry.Body)
	}
}
