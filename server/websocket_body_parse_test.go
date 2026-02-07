package main

import (
	"encoding/json"
	"testing"
)

func TestParseControlCommandBody(t *testing.T) {
	body := map[string]interface{}{
		"devices":   []interface{}{"d1", "d2"},
		"type":      "file/put",
		"body":      map[string]interface{}{"path": "/lua/scripts/a.lua"},
		"requestId": "req-1",
	}

	got, err := parseControlCommandBody(body)
	if err != nil {
		t.Fatalf("parseControlCommandBody error: %v", err)
	}
	if len(got.Devices) != 2 || got.Devices[0] != "d1" || got.Devices[1] != "d2" {
		t.Fatalf("unexpected devices: %+v", got.Devices)
	}
	if got.Type != "file/put" {
		t.Fatalf("unexpected type: %s", got.Type)
	}
	if got.RequestID != "req-1" {
		t.Fatalf("unexpected requestId: %s", got.RequestID)
	}
	if got.Body == nil {
		t.Fatalf("expected body to be preserved")
	}
}

func TestParseControlCommandBodyInvalidDevices(t *testing.T) {
	body := map[string]interface{}{
		"devices": 123,
	}
	if _, err := parseControlCommandBody(body); err == nil {
		t.Fatalf("expected error for invalid devices")
	}
}

func TestParseControlCommandsBody(t *testing.T) {
	body := map[string]interface{}{
		"devices": []interface{}{"d1"},
		"commands": []interface{}{
			map[string]interface{}{"type": "script/run", "body": map[string]interface{}{"name": "a.lua"}},
			map[string]interface{}{"type": "script/stop"},
		},
	}

	got, err := parseControlCommandsBody(body)
	if err != nil {
		t.Fatalf("parseControlCommandsBody error: %v", err)
	}
	if len(got.Devices) != 1 || got.Devices[0] != "d1" {
		t.Fatalf("unexpected devices: %+v", got.Devices)
	}
	if len(got.Commands) != 2 {
		t.Fatalf("unexpected commands length: %d", len(got.Commands))
	}
	if got.Commands[0].Type != "script/run" || got.Commands[1].Type != "script/stop" {
		t.Fatalf("unexpected commands: %+v", got.Commands)
	}
}

func TestParseHTTPProxyRequestBody(t *testing.T) {
	body := map[string]interface{}{
		"devices":   []interface{}{"d1", "d2"},
		"requestId": "rid-1",
		"method":    "POST",
		"path":      "/api/webrtc/start",
		"query":     map[string]interface{}{"force": true},
		"headers":   map[string]interface{}{"Content-Type": "application/json"},
		"body":      "eyJmb28iOiJiYXIifQ==",
		"port":      float64(46952),
	}

	got, err := parseHTTPProxyRequestBody(body)
	if err != nil {
		t.Fatalf("parseHTTPProxyRequestBody error: %v", err)
	}
	if got.RequestID != "rid-1" || got.Method != "POST" || got.Path != "/api/webrtc/start" {
		t.Fatalf("unexpected request fields: %+v", got)
	}
	if got.Port != 46952 {
		t.Fatalf("unexpected port: %d", got.Port)
	}
	if got.Headers["Content-Type"] != "application/json" {
		t.Fatalf("unexpected headers: %+v", got.Headers)
	}
}

func TestParseHTTPProxyRequestBinBody(t *testing.T) {
	raw := json.RawMessage(`{
		"devices":["d1"],
		"requestId":"abc123",
		"method":"POST",
		"path":"/api/a",
		"headers":{"X-Test":"1"},
		"port":46952,
		"bodySize":1024,
		"chunkSize":256
	}`)

	got, err := parseHTTPProxyRequestBinBody(raw)
	if err != nil {
		t.Fatalf("parseHTTPProxyRequestBinBody error: %v", err)
	}
	if got.RequestID != "abc123" || got.Method != "POST" || got.Path != "/api/a" {
		t.Fatalf("unexpected request fields: %+v", got)
	}
	if got.Port != 46952 || got.BodySize != 1024 || got.ChunkSize != 256 {
		t.Fatalf("unexpected numeric fields: %+v", got)
	}
}

func TestParseLogSubscribeRequestBody(t *testing.T) {
	body := map[string]interface{}{
		"devices": []interface{}{"d1", "d2"},
	}

	got, err := parseLogSubscribeRequestBody(body)
	if err != nil {
		t.Fatalf("parseLogSubscribeRequestBody error: %v", err)
	}
	if len(got.Devices) != 2 {
		t.Fatalf("unexpected devices: %+v", got.Devices)
	}
}
