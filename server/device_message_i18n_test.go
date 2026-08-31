package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBroadcastDeviceMessageIncludesSemanticPayloadAndLegacyChinese(t *testing.T) {
	messages := make(chan []byte, 1)
	controller := &SafeConn{writeMessageHook: func(_ int, data []byte) error {
		messages <- append([]byte(nil), data...)
		return nil
	}}

	mu.Lock()
	previousControllers := controllers
	controllers = map[*SafeConn]bool{controller: true}
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		controllers = previousControllers
		mu.Unlock()
	})

	broadcastDeviceMessage("device-1", "device.script.upload_summary", map[string]any{"small": 2, "large": 1})

	select {
	case data := <-messages:
		var message Message
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode message: %v", err)
		}
		body, ok := message.Body.(map[string]any)
		if !ok {
			t.Fatalf("unexpected body: %#v", message.Body)
		}
		if body["message"] != "上传脚本（2 个小文件，1 个大文件）" {
			t.Fatalf("unexpected legacy message: %#v", body["message"])
		}
		if body["messageCode"] != "device.script.upload_summary" {
			t.Fatalf("unexpected message code: %#v", body["messageCode"])
		}
		params, ok := body["messageParams"].(map[string]any)
		if !ok || params["small"] != float64(2) || params["large"] != float64(1) {
			t.Fatalf("unexpected message params: %#v", body["messageParams"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for device message")
	}
}

func TestBroadcastDeviceMessageKeepsRawFailureInDetail(t *testing.T) {
	messages := make(chan []byte, 1)
	controller := &SafeConn{writeMessageHook: func(_ int, data []byte) error {
		messages <- append([]byte(nil), data...)
		return nil
	}}

	mu.Lock()
	previousControllers := controllers
	controllers = map[*SafeConn]bool{controller: true}
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		controllers = previousControllers
		mu.Unlock()
	})

	broadcastDeviceMessageWithDetail("device-1", "device.script.start_transfer_failed", nil, "connection reset")

	select {
	case data := <-messages:
		var message Message
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode message: %v", err)
		}
		body := message.Body.(map[string]any)
		if body["message"] != "脚本启动已取消：大文件传输失败" || body["detail"] != "connection reset" {
			t.Fatalf("unexpected error payload: %#v", body)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for device message")
	}
}
