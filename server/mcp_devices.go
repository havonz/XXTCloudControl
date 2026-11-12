package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type deviceHTTPError struct {
	path   string
	status int
	detail string
}

func (e *deviceHTTPError) Error() string {
	return fmt.Sprintf("%s (HTTP %d): %s", e.path, e.status, e.detail)
}

type cloudDevice struct {
	udid     string
	conn     *SafeConn
	language string
}

func (d cloudDevice) request(ctx context.Context, method, path string, query fields, body any) ([]byte, error) {
	var raw []byte
	headers := map[string]string{"Accept-Language": d.language}
	switch v := body.(type) {
	case string:
		raw = []byte(v)
		headers["Content-Type"] = "text/plain; charset=utf-8"
	case nil:
	default:
		var err error
		raw, err = json.Marshal(v)
		if err != nil {
			return nil, err
		}
		headers["Content-Type"] = "application/json"
	}
	resp, err := deviceHTTP(ctx, d.conn, d.udid, method, path, query, headers, raw)
	if err != nil {
		return nil, err
	}
	if resp.Error != "" || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &deviceHTTPError{path, resp.StatusCode, extractSnapshotFailureReason(resp)}
	}
	return resp.Body, nil
}

func (d cloudDevice) json(ctx context.Context, method, path string, body any) (any, error) {
	b, err := d.request(ctx, method, path, nil, body)
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return nil, nil
	}
	var v any
	if err = json.Unmarshal(b, &v); err != nil {
		return nil, fmt.Errorf("%s: invalid device JSON", path)
	}
	if obj, ok := v.(map[string]any); ok {
		if code, ok := obj["code"].(float64); ok && code != 0 {
			return nil, fmt.Errorf("%s: %v (code %v)", path, obj["message"], code)
		}
		if obj["ok"] == false {
			return nil, fmt.Errorf("%s: %v", path, obj["error"])
		}
	}
	return v, nil
}

func deviceMCPOperations() []mcpOperation {
	ops := []mcpOperation{{name: "backend_list_devices", category: "devices", description: "List connected cloud devices and their latest reported state.", schema: object(nil), readOnly: true, run: func(context.Context, toolArgs) (any, error) {
		mu.RLock()
		defer mu.RUnlock()
		ids := make([]string, 0, len(deviceLinks))
		for id := range deviceLinks {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		devices := make([]fields, 0, len(ids))
		for _, id := range ids {
			state, _ := deviceTable[id].(map[string]any)
			devices = append(devices, fields{"udid": id, "system": state["system"], "script": state["script"], "app": state["app"]})
		}
		return fields{"devices": devices, "total": len(devices)}, nil
	}}}
	add := func(name, desc string, ro bool, props fields, required []string, run func(context.Context, cloudDevice, toolArgs) (any, error)) {
		if props == nil {
			props = fields{}
		}
		props["udid"] = word
		ops = append(ops, mcpOperation{name: name, category: "devices", description: desc, readOnly: ro, schema: object(props, append(required, "udid")...), run: func(ctx context.Context, a toolArgs) (any, error) {
			id := a.str("udid")
			conn, _, _, ok := resolveConnectedSnapshotTarget(id)
			if !ok {
				return nil, errors.New("device is offline")
			}
			info, _ := ctx.Value(mcpContextKey{}).(mcpRequestInfo)
			ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()
			return run(ctx, cloudDevice{id, conn, info.language}, a)
		}})
	}
	for _, v := range []struct {
		name, desc, method, path string
		ro                       bool
	}{
		{"device_get_status", "Read the current system and script state.", "GET", "/api/app/state", true},
		{"device_lock", "Request a screen lock. Check system.is_locked with device_get_status.", "POST", "/lock_screen", false},
		{"device_unlock", "Request screen unlock without supplying a passcode or starting Lua. Check system.is_locked with device_get_status.", "POST", "/unlock_screen", false},
		{"device_list_scripts", "List scripts installed on the device.", "GET", "/api/script", true},
		{"device_launch_script", "Start the selected device script. Use device_send_script_and_run to distribute a cloud script.", "POST", "/launch_script_file", false},
		{"device_stop_script", "Stop the active script.", "POST", "/recycle", false},
		{"device_pause_script", "Pause the active script.", "POST", "/pause_script", false},
		{"device_resume_script", "Resume the paused script.", "POST", "/resume_script", false},
	} {
		add(v.name, v.desc, v.ro, nil, nil, func(ctx context.Context, d cloudDevice, _ toolArgs) (any, error) {
			return d.json(ctx, v.method, v.path, nil)
		})
	}
	add("device_get_selected_script", "Read the device-selected script path.", true, nil, nil, func(ctx context.Context, d cloudDevice, _ toolArgs) (any, error) {
		b, e := d.request(ctx, "GET", "/api/script/selected", nil, nil)
		return string(b), e
	})
	add("device_select_script", "Select an existing device script by filename.", false, fields{"filename": word}, []string{"filename"}, func(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
		_, e := d.request(ctx, "PUT", "/api/script/selected", nil, a.str("filename"))
		return nil, e
	})
	add("device_get_screenshot", "Return a live PNG image. scale is a percentage.", true, fields{"scale": integer(1, 100)}, nil, func(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
		image, err := captureMCPScreenshot(ctx, d, a.number("scale", 100), 12*time.Second)
		if err != nil {
			return nil, err
		}
		return image, nil
	})
	add("device_get_logs", "Read recent lines of the device system log.", true, fields{"limit": integer(1, 500)}, nil, func(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
		b, e := d.request(ctx, "GET", "/api/system/log", fields{"last": a.number("limit", 50)}, nil)
		return string(b), e
	})
	add("device_collect_realtime_logs", "Collect new device logs for durationMs (default 2000), up to 256 KiB.", true, fields{"durationMs": integer(100, 30000)}, nil, collectMCPLogs)
	add("device_run_script_snippet", "Run Lua 5.3. Sync returns values or runtime error; async only reports started. Does not stop an active script.", false, fields{"code": word, "async": boolean, "syncTimeoutMs": integer(100, 60000)}, []string{"code"}, runCloudSnippet)
	point := integer(0, 65535)
	step := func(kind string, props fields, required ...string) fields {
		props["type"] = fields{"const": kind}
		return object(props, append(required, "type")...)
	}
	steps := fields{"type": "array", "minItems": 1, "maxItems": 64, "items": fields{"oneOf": []any{
		step("tap", fields{"x": point, "y": point}, "x", "y"), step("swipe_linear", fields{"x0": point, "y0": point, "x1": point, "y1": point, "durationMs": integer(1, 5000)}, "x0", "y0", "x1", "y1"),
		step("key_press", fields{"code": word}, "code"), step("text", fields{"text": word}, "text"),
	}}}
	add("device_input_sequence", "Apply ordered tap, swipe_linear, key_press or text steps in physical pixels. Text uses a short Lua snippet and needs an idle script runtime.", false, fields{"steps": steps}, []string{"steps"}, func(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
		for i, v := range a["steps"].([]any) {
			input := toolArgs(v.(map[string]any))
			var err error
			switch input.str("type") {
			case "tap":
				_, err = d.request(ctx, "POST", "/api/touch/tap", nil, fields{"x": input["x"], "y": input["y"]})
			case "swipe_linear":
				_, err = d.request(ctx, "POST", "/api/touch/drag-linear", nil, fields{"x0": input["x0"], "x1": input["x1"], "y0": input["y0"], "y1": input["y1"], "duration": input.number("durationMs", 250)})
			case "key_press":
				_, err = d.request(ctx, "POST", "/api/key/press", nil, fields{"code": input["code"]})
			case "text":
				encoded := base64.StdEncoding.EncodeToString([]byte(input.str("text")))
				_, err = runCloudSnippet(ctx, d, toolArgs{"code": fmt.Sprintf("local s=(%q):base64_decode(); if key.input_text then assert(key.input_text(s)) else sys.input_text(s) end", encoded)})
			}
			if err != nil {
				return fields{"completedSteps": i}, fmt.Errorf("step %d: %w", i+1, err)
			}
		}
		return fields{"completedSteps": len(a["steps"].([]any))}, nil
	})
	for _, kind := range []string{"snapshot", "query", "action"} {
		props := fields{"options": dict}
		var required []string
		switch kind {
		case "snapshot":
			props["maxLevel"] = integer(1, 100)
			props["maxElements"] = integer(1, 3000)
			props["includeHandle"] = boolean
		case "query":
			props["method"] = word
			props["selector"] = dict
			props["x"] = point
			props["y"] = point
			required = []string{"method"}
		case "action":
			props["action"] = word
			props["target"] = dict
			props["direction"] = word
			props["text"] = freeText
			props["checked"] = boolean
			props["value"] = fields{}
			required = []string{"action", "target"}
		}
		add("device_ui_element_"+kind, "Use the installed XXTouch UI element "+kind+" API. Requires device support.", kind != "action", props, required, func(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
			cap, err := d.json(ctx, "GET", "/api/capabilities", nil)
			if err != nil {
				var remote *deviceHTTPError
				if errors.As(err, &remote) && (remote.status == 404 || remote.status == 405 || remote.status == 501) {
					return nil, errors.New("device does not support the UI element capability API")
				}
				return nil, fmt.Errorf("UI capability check failed: %w", err)
			}
			envelope, _ := cap.(map[string]any)
			data, _ := envelope["data"].(map[string]any)
			features, _ := data["features"].(map[string]any)
			flag := "uiElementOpenAPI"
			if kind == "snapshot" {
				flag = "uiElementInspector"
			}
			if features[flag] != true {
				return nil, fmt.Errorf("device does not support %s", flag)
			}
			delete(a, "udid")
			endpoint := kind
			if kind == "snapshot" {
				opts, _ := a["options"].(map[string]any)
				if opts == nil {
					opts = fields{}
				}
				for k, key := range map[string]string{"maxLevel": "max_level", "maxElements": "max_elements", "includeHandle": "include_handle"} {
					if v, ok := a[k]; ok {
						opts[key] = v
					}
				}
				if opts["max_elements"] == nil {
					opts["max_elements"] = 300
				}
				a = toolArgs{"method": "get_ui_snapshot_once", "options": opts}
				endpoint = "query"
			}
			return d.json(ctx, "POST", "/api/ui-element/"+endpoint, a)
		})
	}
	return ops
}

const mcpSnapshotPrefix = "mcp-snapshot-"

func captureMCPScreenshot(ctx context.Context, d cloudDevice, scale int, binaryTimeout time.Duration) (*mcp.ImageContent, error) {
	options := fields{"format": "png", "scale": scale}
	binaryCtx, cancel := context.WithTimeout(ctx, binaryTimeout)
	data, firstErr := d.request(binaryCtx, "GET", "/api/screen/snapshot", options, nil)
	cancel()
	if firstErr == nil {
		if http.DetectContentType(data) == "image/png" {
			return &mcp.ImageContent{MIMEType: "image/png", Data: data}, nil
		}
		firstErr = errors.New("device returned an invalid PNG")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	// 分片没有收齐时，通过面板已有的单消息截图指令重取，给客户端留下接收结果的时间。
	id, err := generateInternalHTTPBinRequestID()
	if err != nil {
		return nil, err
	}
	id = mcpSnapshotPrefix + id
	payload, err := json.Marshal(Message{Type: "screen/snapshot", RequestID: id, Body: options})
	if err != nil {
		return nil, err
	}
	nativeCtx, stop := context.WithTimeout(ctx, 15*time.Second)
	defer stop()
	reply, err := awaitDeviceReply(nativeCtx, d.conn, d.udid, id, websocketWrite{
		messageType: websocket.TextMessage, payloads: [][]byte{payload},
	})
	if err == nil && reply.Error != "" {
		err = errors.New(reply.Error)
	}
	if err != nil {
		return nil, fmt.Errorf("screenshot for %s failed (HTTP: %v; screen/snapshot: %w)", d.udid, firstErr, err)
	}
	return &mcp.ImageContent{MIMEType: "image/png", Data: reply.Body}, nil
}

func handleMCPSnapshotReply(conn *SafeConn, msg Message) {
	internalHTTPBinMu.Lock()
	req := internalHTTPBinRequests[msg.RequestID]
	internalHTTPBinMu.Unlock()
	if req == nil || req.Conn != conn {
		return
	}
	result := internalHTTPBinResponse{Error: msg.Error}
	if result.Error == "" {
		encoded, ok := msg.Body.(string)
		if !ok || len(encoded) > base64.StdEncoding.EncodedLen(internalHTTPBinMaxBodySize) {
			result.Error = "invalid screenshot payload or size"
		} else {
			data, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil || len(data) > internalHTTPBinMaxBodySize || http.DetectContentType(data) != "image/png" {
				result.Error = "device returned an invalid PNG"
			} else {
				result.Body = data
			}
		}
	}
	internalHTTPBinMu.Lock()
	defer internalHTTPBinMu.Unlock()
	finalizeInternalHTTPBinRequestLocked(req, result)
}

const snippetWrapper = `local keyname, expiry = %q, sys.mtime()+%d
local code=(%q):base64_decode()
local func, compileError=load(code, "@mcp_snippet.lua","t")
local function execute()
 if not func then error(compileError,0) end
 local values=table.pack(func())
 local ret=setmetatable({},json.array_mt)
 for i=1,values.n do ret[i]=values[i]; if ret[i]==nil then ret[i]=json.null end end
 local encoded,err=json.encode({state="returned",returns=ret})
 assert(encoded,err or "result cannot be encoded")
 assert(#encoded<=1048576,"result exceeds 1 MiB")
 return encoded
end
local ok,value=xpcall(execute,debug.traceback)
if not ok then value=json.encode({state="runtime_error",error=tostring(value):sub(1,8192)}) end
if sys.mtime()<expiry then
 proc_put(keyname,value)
 -- 断线时调用方无法取走结果，由本次片段自行清理临时键。
 while proc_get(keyname)~="" and sys.mtime()<expiry do sys.msleep(10) end
 proc_put(keyname,"")
end`

func (d cloudDevice) scriptBusy(ctx context.Context) (bool, error) {
	b, err := d.request(ctx, "GET", "/is_running", nil, nil)
	if err != nil {
		return false, err
	}
	var status struct {
		Code *int `json:"code"`
	}
	if err = json.Unmarshal(b, &status); err != nil || status.Code == nil {
		return false, errors.New("invalid device runtime status")
	}
	return *status.Code != 0, nil
}

func runCloudSnippet(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
	// /spawn 会先改写启动参数，再判断脚本槽是否被占用。
	busy, err := d.scriptBusy(ctx)
	if err != nil {
		return nil, err
	}
	if busy {
		return fields{"state": "busy"}, errors.New("device script runtime is busy")
	}
	code := a.str("code")
	if a["async"] == true {
		_, err := d.json(ctx, "POST", "/spawn", code)
		if err != nil {
			return nil, err
		}
		return fields{"state": "started"}, nil
	}
	id, err := generateInternalHTTPBinRequestID()
	if err != nil {
		return nil, err
	}
	key := "xxtcloud.mcp." + id
	timeout := a.number("syncTimeoutMs", 15000)
	wrapped := fmt.Sprintf(snippetWrapper, key, timeout, base64.StdEncoding.EncodeToString([]byte(code)))
	if _, err = d.json(ctx, "POST", "/spawn", wrapped); err != nil {
		return nil, err
	}
	wait, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-wait.Done():
			if errors.Is(wait.Err(), context.Canceled) {
				return fields{"state": "canceled"}, wait.Err()
			}
			return fields{"state": "timeout"}, wait.Err()
		case <-ticker.C:
		}
		// proc_put 原子取出旧值并清空，避免先读后删丢失结果。
		raw, err := d.request(wait, "POST", "/proc_put", nil, fields{"key": key, "value": "", "only_value": true})
		if err != nil {
			if wait.Err() != nil {
				if errors.Is(wait.Err(), context.Canceled) {
					return fields{"state": "canceled"}, wait.Err()
				}
				return fields{"state": "timeout"}, wait.Err()
			}
			return nil, err
		}
		if len(bytes.TrimSpace(raw)) == 0 {
			continue
		}
		var result fields
		if err = json.Unmarshal(raw, &result); err != nil {
			return nil, fmt.Errorf("invalid snippet result: %w", err)
		}
		// 已取到返回值时，设备可能还在退出包装脚本。给连续的同步调用留出释放脚本槽的时间。
		settling, stop := context.WithTimeout(ctx, 3*time.Second)
		for settling.Err() == nil {
			busy, err := d.scriptBusy(settling)
			if err != nil || !busy {
				break
			}
			select {
			case <-settling.Done():
			case <-time.After(100 * time.Millisecond):
			}
		}
		stop()
		if result["state"] == "runtime_error" {
			return result, fmt.Errorf("%v", result["error"])
		}
		if result["state"] != "returned" {
			return nil, errors.New("device did not return the snippet result")
		}
		return result, nil
	}
}

type mcpLogCapture struct {
	buffer    strings.Builder
	truncated bool
}

var mcpLogCaptures = map[*SafeConn]map[*mcpLogCapture]bool{} // guarded by mu
func collectMCPLogs(ctx context.Context, d cloudDevice, a toolArgs) (any, error) {
	capture := &mcpLogCapture{}
	mu.Lock()
	if deviceLinks[d.udid] != d.conn {
		mu.Unlock()
		return nil, errors.New("device disconnected")
	}
	if len(mcpLogCaptures[d.conn]) == 0 {
		mcpLogCaptures[d.conn] = map[*mcpLogCapture]bool{}
		if len(logSubscriptions[d.udid]) == 0 {
			sendMessageAsync(d.conn, Message{Type: "system/log/subscribe"})
		}
	}
	mcpLogCaptures[d.conn][capture] = true
	mu.Unlock()
	timer := time.NewTimer(time.Duration(a.number("durationMs", 2000)) * time.Millisecond)
	defer timer.Stop()
	d.conn.mu.Lock()
	if d.conn.writeClosed == nil {
		d.conn.writeClosed = make(chan struct{})
	}
	closed := d.conn.writeClosed
	d.conn.mu.Unlock()
	var err error
	select {
	case <-ctx.Done():
		err = ctx.Err()
	case <-closed:
		err = errors.New("device disconnected")
	case <-timer.C:
	}
	mu.Lock()
	defer mu.Unlock()
	delete(mcpLogCaptures[d.conn], capture)
	if len(mcpLogCaptures[d.conn]) == 0 {
		delete(mcpLogCaptures, d.conn)
		if deviceLinks[d.udid] == d.conn && len(logSubscriptions[d.udid]) == 0 {
			sendMessageAsync(d.conn, Message{Type: "system/log/unsubscribe"})
		}
	}
	return fields{"log": capture.buffer.String(), "truncated": capture.truncated}, err
}
