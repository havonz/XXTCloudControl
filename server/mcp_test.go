package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type bearerTestTransport string

func (b bearerTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	req := r.Clone(r.Context())
	req.Header.Set("Authorization", "Bearer "+string(b))
	return http.DefaultTransport.RoundTrip(req)
}

func TestCloudMCPAuthenticatedSession(t *testing.T) {
	dir := setupFileHandlersTestDataDir(t)
	oldHash := passhash
	passhash = []byte(toPasshash("temporary"))
	t.Cleanup(func() { passhash = oldHash })
	r := gin.New()
	r.Use(corsMiddleware(), apiAuthMiddleware())
	if err := registerMCP(r); err != nil {
		t.Fatal(err)
	}
	r.GET("/api/groups", groupsListHandler)
	request := func(method, path, token, origin string, signed bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if signed {
			ts, nonce := time.Now().Unix(), uuid.NewString()
			req.Header.Set("X-XXT-TS", fmt.Sprint(ts))
			req.Header.Set("X-XXT-Nonce", nonce)
			req.Header.Set("X-XXT-Sign", computeSignatureHex(buildHTTPSignatureString(ts, nonce, method, path, "")))
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	issue := func() string {
		w := request("POST", "/api/mcp/token", "", "", true)
		var v struct{ Token string }
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil || w.Code != 200 || v.Token == "" {
			t.Fatal("signed token issue failed")
		}
		digest := sha256.Sum256([]byte(v.Token))
		file, err := os.ReadFile(filepath.Join(dir, "mcp-token.sha256"))
		if err != nil || strings.TrimSpace(string(file)) != hex.EncodeToString(digest[:]) {
			t.Fatal("invalid persisted digest")
		}
		return v.Token
	}
	if w := request("POST", "/mcp", "", "", true); w.Code != 401 {
		t.Fatal("disabled MCP accepted request")
	}
	token := issue()
	if w := request("GET", "/api/mcp/token", "", "", true); strings.Contains(w.Body.String(), token) {
		t.Fatal("status disclosed token")
	}
	for _, route := range []string{"/api/mcp/token", "/api/groups"} {
		if w := request("GET", route, token, "", false); w.Code != 401 {
			t.Fatal("Bearer authenticated to", route)
		}
	}
	if w := request("OPTIONS", "/mcp", token, "https://untrusted.example", false); w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") == "*" {
		t.Fatal("cross-origin MCP request passed")
	}
	ts := httptest.NewServer(r)
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: ts.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTestTransport(token)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	list, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, v := range list.Tools {
		ids = append(ids, v.Name)
	}
	slices.Sort(ids)
	if !slices.Equal(ids, []string{"skill_list", "skill_read", "tool_call", "tool_info", "tool_list"}) {
		t.Fatal(ids)
	}
	call := func(name string, args fields) *mcp.CallToolResult {
		result, e := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if e != nil {
			t.Fatal(e)
		}
		return result
	}
	for name, args := range map[string]fields{"tool_list": {}, "tool_info": {"tools": []string{"device_get_screenshot", "device_run_script_snippet"}}, "skill_list": {}, "skill_read": {"skill": "xxtcloudcontrol"}} {
		if call(name, args).IsError {
			t.Fatal(name)
		}
	}
	for _, key := range []string{"tool", "tool_name"} {
		if call("tool_info", fields{key: "device_unlock"}).IsError {
			t.Fatalf("could not look up device_unlock with %s", key)
		}
	}
	if call("tool_call", fields{"tool_name": "backend_list_devices"}).IsError {
		t.Fatal("tool_name was rejected by the public tool or dispatcher")
	}
	if !call("tool_call", fields{"tool": "device_lock", "tool_name": "device_unlock"}).IsError {
		t.Fatal("ambiguous device action accepted")
	}
	mockMCPDevice(t, "screen", func(path string, body []byte) []byte {
		if path == "/unlock_screen" || path == "/lock_screen" {
			return []byte(`{"code":0}`)
		}
		if path != "/api/screen/snapshot" {
			t.Errorf("unexpected path %s", path)
		}
		return append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 16)...)
	})
	for _, action := range []string{"device_lock", "device_unlock"} {
		if call("tool_call", fields{"tool": action, "args": fields{"udid": "screen"}}).IsError {
			t.Fatalf("%s failed", action)
		}
	}
	result := call("tool_call", fields{"tool": "device_get_screenshot", "args": fields{"udid": "screen"}})
	if result.IsError || len(result.Content) != 2 {
		t.Fatal(result.Content)
	}
	if img, ok := result.Content[1].(*mcp.ImageContent); !ok || img.MIMEType != "image/png" {
		t.Fatal("missing protocol image")
	}
	outside := t.TempDir()
	if err = os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	createSymlinkOrSkip(t, outside, filepath.Join(dir, "files", "outside"))
	for _, name := range []string{"backend_file_read", "backend_push_file_to_devices"} {
		args := fields{"root": "files", "path": "outside/secret"}
		if name == "backend_push_file_to_devices" {
			args = fields{"root": "files", "sourcePath": "outside/secret", "targetPath": "x", "udid": "screen"}
		}
		if !call("tool_call", fields{"tool": name, "args": args}).IsError {
			t.Fatal("escaped managed root with", name)
		}
	}
	newToken := issue()
	if _, err = session.ListTools(ctx, nil); err == nil {
		t.Fatal("old session accepted rotated token")
	}
	if w := request("DELETE", "/api/mcp/token", "", "", true); w.Code != 200 {
		t.Fatal("revoke failed")
	}
	if w := request("POST", "/mcp", newToken, "", false); w.Code != 401 {
		t.Fatal("revoked token still works")
	}
}

// Simulate the installed client's metadata + binary frame exchange, including request bodies.
func mockMCPDevice(t *testing.T, id string, reply func(string, []byte) []byte) cloudDevice {
	t.Helper()
	type pending struct {
		path string
		buf  []byte
	}
	requests := map[string]*pending{}
	conn := &SafeConn{}
	finish := func(requestID, path string, body []byte) {
		data := reply(path, body)
		handleInternalHTTPResponseBinMeta(conn, Message{Type: "http/response-bin", Body: fields{"requestId": requestID, "bodySize": len(data), "statusCode": 200}})
		if len(data) > 0 {
			handleInternalHTTPResponseBinChunk(conn, requestID, 0, 1, data)
		}
	}
	conn.writeMessageHook = func(kind int, b []byte) error {
		if kind == websocket.TextMessage {
			var msg Message
			if err := json.Unmarshal(b, &msg); err != nil {
				return err
			}
			m := msg.Body.(map[string]any)
			rid, path := m["requestId"].(string), m["path"].(string)
			if q, ok := m["query"]; ok && q == nil {
				return fmt.Errorf("device expects omitted or object query")
			}
			if m["bodySize"].(float64) == 0 {
				finish(rid, path, nil)
			} else {
				requests[rid] = &pending{path: path}
			}
		} else {
			rid, seq, total, ok := parseBinaryHeader(b)
			if !ok {
				return fmt.Errorf("invalid frame")
			}
			p := requests[rid]
			p.buf = append(p.buf, b[24:]...)
			if seq+1 == total {
				finish(rid, p.path, p.buf)
				delete(requests, rid)
			}
		}
		return nil
	}
	setupSnapshotBatchDeviceState(t, map[string]*SafeConn{id: conn}, map[string]any{}, map[*SafeConn]string{conn: id})
	return cloudDevice{id, conn, "en-US"}
}

func TestCloudSnippetOutcomesAndLegacyUI(t *testing.T) {
	for _, state := range []string{"returned", "runtime_error", "timeout"} {
		t.Run(state, func(t *testing.T) {
			d := mockMCPDevice(t, "dev", func(path string, body []byte) []byte {
				switch path {
				case "/is_running":
					return []byte(`{"code":0}`)
				case "/spawn":
					if !bytes.Contains(body, []byte("xxtcloud.mcp.")) {
						t.Error("missing isolated result key")
					}
					return []byte(`{"code":0}`)
				case "/proc_put":
					if state == "timeout" {
						return nil
					}
					if state == "returned" {
						return []byte(`{"state":"returned","returns":[1,null,false]}`)
					}
					return []byte(`{"state":"runtime_error","error":"boom"}`)
				case "/api/capabilities":
					return []byte(`{"code":0,"data":{"features":{}}}`)
				default:
					t.Errorf("unexpected device call: %s", path)
					return nil
				}
			})
			v, e := runCloudSnippet(context.Background(), d, toolArgs{"code": "return 1,nil,false", "syncTimeoutMs": float64(350)})
			if (e == nil) != (state == "returned") || v.(map[string]any)["state"] != state {
				t.Fatalf("result=%v err=%v", v, e)
			}
			for _, op := range deviceMCPOperations() {
				if op.name == "device_ui_element_action" {
					_, e = op.run(context.Background(), toolArgs{"udid": "dev"})
					if e == nil || !strings.Contains(e.Error(), "does not support") {
						t.Fatal("missing UI capability was ignored")
					}
				}
			}
		})
	}
}

func TestMCPConcurrentRequestsBoundToConnections(t *testing.T) {
	resetInternalHTTPBinState(t)
	a, b, replacement := &SafeConn{}, &SafeConn{}, &SafeConn{}
	setupSnapshotBatchDeviceState(t, map[string]*SafeConn{"a": a, "b": b}, map[string]any{}, map[*SafeConn]string{a: "a", b: "b"})
	ids := make(chan string, 2)
	for _, conn := range []*SafeConn{a, b} {
		conn.writeMessageHook = func(_ int, p []byte) error {
			var msg Message
			if e := json.Unmarshal(p, &msg); e != nil {
				return e
			}
			ids <- msg.Body.(map[string]any)["requestId"].(string)
			return nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	run := func(conn *SafeConn, id string) <-chan internalHTTPBinResponse {
		ch := make(chan internalHTTPBinResponse, 1)
		go func() {
			r, e := deviceHTTP(ctx, conn, id, "GET", "/test", nil, nil, nil)
			if e != nil {
				r.Error = e.Error()
			}
			ch <- r
		}()
		return ch
	}
	ra := run(a, "a")
	ida := <-ids
	rb := run(b, "b")
	idb := <-ids
	meta := func(conn *SafeConn, id string, status int) bool {
		return handleInternalHTTPResponseBinMeta(conn, Message{Body: fields{"requestId": id, "bodySize": 0, "statusCode": status}})
	}
	if !meta(b, ida, 500) {
		t.Fatal("private response leaked")
	}
	if err := handleMessage(replacement, Message{Type: "app/state", Body: fields{"system": fields{"udid": "a"}}}); err != nil {
		t.Fatal(err)
	}
	if !meta(replacement, ida, 200) || !handleInternalHTTPResponseBinChunk(b, ida, 0, 1, []byte("late")) {
		t.Fatal("late reply leaked to browser")
	}
	meta(b, idb, 204)
	if r := <-ra; r.Error == "" {
		t.Fatal("old request survived reconnection")
	}
	if r := <-rb; r.StatusCode != 204 || r.Error != "" {
		t.Fatal(r)
	}
}

func TestMCPRequestCancellationAfterMetadata(t *testing.T) {
	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t, map[string]*SafeConn{"device": conn}, nil, map[*SafeConn]string{conn: "device"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	meta := make(chan struct{})
	release := make(chan struct{})
	sent := make(chan []byte, 1)
	conn.writeMessageHook = func(kind int, payload []byte) error {
		if kind == websocket.TextMessage {
			close(meta)
			<-release
		} else {
			sent <- payload
		}
		return nil
	}
	result := make(chan error, 1)
	go func() {
		_, err := deviceHTTP(ctx, conn, "device", "POST", "/api/key/press", nil, nil, []byte("test"))
		result <- err
	}()
	<-meta
	cancel()
	err := <-result
	close(release)
	if err != context.Canceled {
		t.Fatalf("cancel error %v", err)
	}
	select {
	case frame := <-sent:
		id, seq, total, ok := parseBinaryHeader(frame)
		if !ok || seq != 0 || total != 1 || string(frame[24:]) != "test" {
			t.Fatal("incomplete request body")
		}
		if !handleInternalHTTPResponseBinMeta(conn, Message{Body: fields{"requestId": id}}) {
			t.Fatal("late canceled response is public")
		}
	case <-time.After(time.Second):
		t.Fatal("device left waiting for body after metadata")
	}
}

func TestMCPScreenshotRecoversFromMissingChunk(t *testing.T) {
	conn, other := &SafeConn{}, &SafeConn{}
	setupSnapshotBatchDeviceState(t, map[string]*SafeConn{"se2": conn, "other": other}, nil, map[*SafeConn]string{conn: "se2", other: "other"})
	pngBytes := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 100)...)
	var binaryID string
	conn.writeMessageHook = func(kind int, raw []byte) error {
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			return err
		}
		body := msg.Body.(map[string]any)
		switch msg.Type {
		case "http/request-bin":
			binaryID = body["requestId"].(string)
			handleInternalHTTPResponseBinMeta(conn, Message{Body: fields{"requestId": binaryID, "statusCode": 200, "bodySize": internalHTTPBinChunkSize + 1}})
			handleInternalHTTPResponseBinChunk(conn, binaryID, 0, 2, make([]byte, internalHTTPBinChunkSize))
		case "screen/snapshot":
			if !strings.HasPrefix(msg.RequestID, mcpSnapshotPrefix) || body["scale"] != float64(50) || body["format"] != "png" {
				return fmt.Errorf("wrong fallback options: %v", body)
			}
			if !handleInternalHTTPResponseBinChunk(conn, binaryID, 1, 2, []byte{1}) {
				return fmt.Errorf("late binary reply leaked")
			}
			if err := handleMessage(other, Message{Type: msg.Type, RequestID: msg.RequestID, Error: "wrong device"}); err != nil {
				return err
			}
			return handleMessage(conn, Message{Type: msg.Type, RequestID: msg.RequestID, Body: base64.StdEncoding.EncodeToString(pngBytes)})
		default:
			return fmt.Errorf("unexpected command %s", msg.Type)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := captureMCPScreenshot(ctx, cloudDevice{udid: "se2", conn: conn}, 50, 75*time.Millisecond)
	if err != nil || !bytes.Equal(got.Data, pngBytes) {
		t.Fatalf("missing fallback PNG: %v", err)
	}
}
