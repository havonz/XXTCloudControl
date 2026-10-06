package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestWebSocketFileMutationsProtectActiveTransfersAndParents(t *testing.T) {
	cases := []struct {
		name, command string
		body          map[string]interface{}
	}{
		{"delete-file", "file/delete", map[string]interface{}{"path": "res/busy/./file.bin"}},
		{"delete-parent", "file/delete", map[string]interface{}{"path": "/res/other/../busy/"}},
		{"delete-root", "file/delete", map[string]interface{}{"path": "/."}},
		{"move-file", "file/move", map[string]interface{}{"from": "/res/busy/file.bin", "to": "/res/new.bin"}},
		{"move-parent", "file/move", map[string]interface{}{"from": "/res/busy", "to": "/res/new"}},
		{"move-over-file", "file/move", map[string]interface{}{"from": "/res/new.bin", "to": "/res/busy/file.bin"}},
		{"move-over-parent", "file/move", map[string]interface{}{"from": "/res/new", "to": "/res/busy"}},
		{"copy-active-file", "file/copy", map[string]interface{}{"from": "/res/busy/file.bin", "to": "/res/new.bin"}},
		{"copy-active-parent", "file/copy", map[string]interface{}{"from": "/res/busy", "to": "/res/new"}},
		{"copy-over-file", "file/copy", map[string]interface{}{"from": "/res/new.bin", "to": "/res/busy/file.bin"}},
		{"copy-over-parent", "file/copy", map[string]interface{}{"from": "/res/new", "to": "/res/busy"}},
		{"put-over-parent", "file/put", map[string]interface{}{"path": "/res/busy", "data": "cHJpdmF0ZQ=="}},
	}
	for _, kind := range []string{"upload", "download"} {
		for _, mode := range []string{"control/command", "control/commands"} {
			for _, tc := range cases {
				t.Run(kind+"/"+mode+"/"+tc.name, func(t *testing.T) {
					resetTransferTokensForTest()
					t.Cleanup(resetTransferTokensForTest)
					writes := make(chan recordedWebSocketWrite, 2)
					responses := make(chan recordedWebSocketWrite, 4)
					device := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
						writes <- recordedWebSocketWrite{messageType: typ, data: data}
						return nil
					}}
					controller := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
						responses <- recordedWebSocketWrite{messageType: typ, data: data}
						return nil
					}}
					setupHTTPBinProxyTestState(t, controller, device)
					t.Cleanup(func() { _ = device.Close(); _ = controller.Close() })
					if err := beginDeviceFileTransfer("device-http-bin", "/res/busy/file.bin", "active", kind, time.Now().Add(time.Minute)); err != nil {
						t.Fatal(err)
					}
					body := map[string]interface{}{"devices": []string{"device-http-bin"}, "type": tc.command, "body": tc.body, "requestId": "mutation-request"}
					if mode == "control/commands" {
						body = map[string]interface{}{"devices": []string{"device-http-bin"}, "commands": []interface{}{
							map[string]interface{}{"type": tc.command, "body": tc.body},
						}}
					}
					if err := handleMessage(controller, signTestControlMessage(t, mode, body, "busy-mutation")); err != nil {
						t.Fatal(err)
					}
					select {
					case <-writes:
						t.Fatal("file mutation bypassed the active transfer guard")
					case response := <-responses:
						var reply struct {
							Type, UDID, RequestID, Error, ErrorCode string
							Body                                    map[string]interface{}
						}
						if err := json.Unmarshal(response.data, &reply); err != nil {
							t.Fatal(err)
						}
						if reply.Type != tc.command || reply.UDID != "device-http-bin" || reply.ErrorCode != "error.transfer.file_busy" || reply.Error == "" {
							t.Fatalf("missing correlated rejection: %+v", reply)
						}
						if mode == "control/command" && reply.RequestID != "mutation-request" {
							t.Fatal("request ID was lost")
						}
						if _, ok := reply.Body["data"]; ok {
							t.Fatal("rejection echoed file contents")
						}
					case <-time.After(time.Second):
						t.Fatal("no rejection was delivered")
					}
					if err := beginDeviceFileTransfer("device-http-bin", "/res/busy/file.bin", "probe", kind, time.Now().Add(time.Minute)); err != errDeviceFileTransferBusy {
						t.Fatalf("rejected mutation released the ongoing transfer: %v", err)
					}
					finishDeviceFileTransfer("active")
					if err := handleMessage(controller, signTestControlMessage(t, mode, body, "retry-mutation")); err != nil {
						t.Fatal(err)
					}
					var forwarded Message
					if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &forwarded); err != nil {
						t.Fatal(err)
					}
					got, _ := json.Marshal(forwarded.Body)
					want, _ := json.Marshal(tc.body)
					if forwarded.Type != tc.command || string(got) != string(want) {
						t.Fatalf("retry changed the command: %s %s", forwarded.Type, got)
					}
				})
			}
		}
	}
}

func TestWebSocketMutationEnqueueCannotBeOvertakenByNewTransfer(t *testing.T) {
	setupTempTransferCleanupTest(t)
	writes := make(chan recordedWebSocketWrite, 2)
	device := &SafeConn{writeMessageHook: func(typ int, data []byte) error {
		writes <- recordedWebSocketWrite{messageType: typ, data: data}
		return nil
	}}
	controller := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, controller, device)
	t.Cleanup(func() { _ = device.Close(); _ = controller.Close() })
	device.mu.Lock()
	var unlockOnce sync.Once
	unlock := func() { unlockOnce.Do(device.mu.Unlock) }
	t.Cleanup(unlock)
	mutation := signTestControlMessage(t, "control/command", map[string]interface{}{
		"devices": []string{"device-http-bin"}, "type": "file/move",
		"body": map[string]interface{}{"from": "/res/old", "to": "/res/current"},
	}, "queued-move")
	mutationDone := make(chan error, 1)
	go func() { mutationDone <- handleMessage(controller, mutation) }()
	// 将命令停在写入队列前，制造“检查已完成、命令尚未入队”的竞态窗口。
	deadline := time.Now().Add(time.Second)
	for deviceFileTransfers.TryLock() {
		deviceFileTransfers.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("mutation did not protect the interval between conflict check and enqueue")
		}
		time.Sleep(time.Millisecond)
	}
	pullDone := make(chan int, 1)
	go func() {
		response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
			"deviceSN": "device-http-bin", "sourcePath": "/res/current/file.bin", "category": "files", "path": "received.bin",
		}, pullFileFromDeviceHandler)
		pullDone <- response.Code
	}()
	unlock()
	select {
	case err := <-mutationDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("mutation did not finish enqueueing")
	}
	select {
	case code := <-pullDone:
		if code != http.StatusOK {
			t.Fatalf("following transfer failed: %d", code)
		}
	case <-time.After(time.Second):
		t.Fatal("following transfer did not finish")
	}
	for _, expected := range []string{"file/move", "transfer/send"} {
		var message Message
		if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type != expected {
			t.Fatalf("transfer overtook the mutation: got %s want %s", message.Type, expected)
		}
	}
}

func TestWebSocketMutationConflictDoesNotBlockOtherDevicesOrSiblingPaths(t *testing.T) {
	resetTransferTokensForTest()
	t.Cleanup(resetTransferTokensForTest)
	writes := make(chan struct{ device, command, path string }, 16)
	controller := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, controller, nil)
	devices := make(map[string]*SafeConn)
	for _, id := range []string{"busy", "ready"} {
		id := id
		devices[id] = &SafeConn{writeMessageHook: func(_ int, data []byte) error {
			var message Message
			if err := json.Unmarshal(data, &message); err != nil {
				return err
			}
			body, _ := decodeBodyMap(message.Body)
			path, _ := body["path"].(string)
			writes <- struct{ device, command, path string }{id, message.Type, path}
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
	if err := beginDeviceFileTransfer("busy", "/res/busy/file.bin", "active", "download", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := beginDeviceFileTransfer("busy", "/res/expired/file.bin", "expired", "download", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	body := map[string]interface{}{"devices": []string{"busy", "ready"}, "commands": []interface{}{
		map[string]interface{}{"type": "key/down", "body": map[string]interface{}{"code": "SHIFT"}},
		map[string]interface{}{"type": "file/delete", "body": map[string]interface{}{"path": "/res/busy"}},
		map[string]interface{}{"type": "file/delete", "body": map[string]interface{}{"path": "/res/busy-sibling"}},
		map[string]interface{}{"type": "file/delete", "body": map[string]interface{}{"path": "/res/expired"}},
		map[string]interface{}{"type": "file/put", "body": map[string]interface{}{"path": "/res/busy", "directory": true}},
		map[string]interface{}{"type": "key/up", "body": map[string]interface{}{"code": "SHIFT"}},
	}}
	if err := handleMessage(controller, signTestControlMessage(t, "control/commands", body, "mixed-mutation")); err != nil {
		t.Fatal(err)
	}
	sequences := map[string][]string{}
	for index := 0; index < 11; index++ {
		select {
		case write := <-writes:
			sequences[write.device] = append(sequences[write.device], write.command+":"+write.path)
		case <-time.After(time.Second):
			t.Fatal("unrelated device, sibling path, expired transfer or keyboard command was blocked")
		}
	}
	for id, expected := range map[string][]string{
		"busy":  {"key/down:", "file/delete:/res/busy-sibling", "file/delete:/res/expired", "file/put:/res/busy", "key/up:"},
		"ready": {"key/down:", "file/delete:/res/busy", "file/delete:/res/busy-sibling", "file/delete:/res/expired", "file/put:/res/busy", "key/up:"},
	} {
		got, _ := json.Marshal(sequences[id])
		want, _ := json.Marshal(expected)
		if string(got) != string(want) {
			t.Fatalf("%s command order changed: %s", id, got)
		}
	}
}
