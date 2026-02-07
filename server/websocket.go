package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// WebSocket upgrader
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow cross-origin
	},
}

const binaryHeaderSize = 24

// Cap concurrent async socket writes to avoid goroutine spikes under fan-out traffic.
var asyncWriteSlots = make(chan struct{}, 512)

func runAsyncWrite(task func()) {
	select {
	case asyncWriteSlots <- struct{}{}:
		go func() {
			defer func() { <-asyncWriteSlots }()
			task()
		}()
	default:
		// Queue is full: fallback to inline write to apply backpressure.
		task()
	}
}

func parseBinaryHeader(data []byte) (string, uint32, uint32, bool) {
	if len(data) < binaryHeaderSize {
		return "", 0, 0, false
	}
	reqID := hex.EncodeToString(data[:16])
	seq := binary.BigEndian.Uint32(data[16:20])
	total := binary.BigEndian.Uint32(data[20:24])
	return reqID, seq, total, true
}

func sendBinaryMessage(conn *SafeConn, payload []byte) error {
	if conn == nil {
		return nil
	}
	return conn.WriteMessage(websocket.BinaryMessage, payload)
}

func writeTextMessage(conn *SafeConn, payload []byte) error {
	if conn == nil {
		return nil
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}

func writeTextMessageAsync(conn *SafeConn, payload []byte) {
	runAsyncWrite(func() {
		_ = writeTextMessage(conn, payload)
	})
}

func sendBinaryMessageAsync(conn *SafeConn, payload []byte) {
	runAsyncWrite(func() {
		_ = sendBinaryMessage(conn, payload)
	})
}

func toInt(value interface{}) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case int64:
		return int(v), true
	case json.Number:
		iv, err := v.Int64()
		if err == nil {
			return int(iv), true
		}
	case string:
		if v == "" {
			return 0, false
		}
		iv, err := strconv.Atoi(v)
		if err == nil {
			return iv, true
		}
	}
	return 0, false
}

func toString(value interface{}) (string, bool) {
	switch v := value.(type) {
	case string:
		return v, true
	case json.Number:
		return v.String(), true
	}
	return "", false
}

func toStringSlice(value interface{}) ([]string, bool) {
	switch v := value.(type) {
	case nil:
		return nil, true
	case []string:
		out := make([]string, len(v))
		copy(out, v)
		return out, true
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, s)
		}
		return out, true
	default:
		return nil, false
	}
}

func toMapStringInterface(value interface{}) (map[string]interface{}, bool) {
	switch v := value.(type) {
	case nil:
		return nil, true
	case map[string]interface{}:
		return v, true
	default:
		return nil, false
	}
}

func toMapStringString(value interface{}) (map[string]string, bool) {
	switch v := value.(type) {
	case nil:
		return nil, true
	case map[string]string:
		out := make(map[string]string, len(v))
		for k, val := range v {
			out[k] = val
		}
		return out, true
	case map[string]interface{}:
		out := make(map[string]string, len(v))
		for k, raw := range v {
			s, ok := raw.(string)
			if !ok {
				return nil, false
			}
			out[k] = s
		}
		return out, true
	default:
		return nil, false
	}
}

func decodeBodyMap(body interface{}) (map[string]interface{}, error) {
	switch v := body.(type) {
	case nil:
		return map[string]interface{}{}, nil
	case map[string]interface{}:
		return v, nil
	case json.RawMessage:
		if len(v) == 0 {
			return map[string]interface{}{}, nil
		}
		var out map[string]interface{}
		if err := json.Unmarshal(v, &out); err != nil {
			return nil, err
		}
		if out == nil {
			out = make(map[string]interface{})
		}
		return out, nil
	case []byte:
		if len(v) == 0 {
			return map[string]interface{}{}, nil
		}
		var out map[string]interface{}
		if err := json.Unmarshal(v, &out); err != nil {
			return nil, err
		}
		if out == nil {
			out = make(map[string]interface{})
		}
		return out, nil
	default:
		return nil, fmt.Errorf("invalid body type %T", body)
	}
}

func parseControlCommandBody(body interface{}) (ControlCommand, error) {
	bodyMap, err := decodeBodyMap(body)
	if err != nil {
		return ControlCommand{}, err
	}

	var out ControlCommand
	if devices, ok := toStringSlice(bodyMap["devices"]); ok {
		out.Devices = devices
	} else if _, exists := bodyMap["devices"]; exists {
		return ControlCommand{}, fmt.Errorf("invalid devices in control/command")
	}
	if typ, ok := toString(bodyMap["type"]); ok {
		out.Type = typ
	} else if _, exists := bodyMap["type"]; exists {
		return ControlCommand{}, fmt.Errorf("invalid type in control/command")
	}
	out.Body = bodyMap["body"]
	if requestID, ok := toString(bodyMap["requestId"]); ok {
		out.RequestID = requestID
	} else if _, exists := bodyMap["requestId"]; exists {
		return ControlCommand{}, fmt.Errorf("invalid requestId in control/command")
	}

	return out, nil
}

func toCommands(value interface{}) ([]Command, bool) {
	switch v := value.(type) {
	case nil:
		return nil, true
	case []Command:
		out := make([]Command, len(v))
		copy(out, v)
		return out, true
	case []interface{}:
		out := make([]Command, 0, len(v))
		for _, raw := range v {
			cmdMap, ok := raw.(map[string]interface{})
			if !ok {
				return nil, false
			}
			var cmd Command
			if typ, ok := toString(cmdMap["type"]); ok {
				cmd.Type = typ
			} else if _, exists := cmdMap["type"]; exists {
				return nil, false
			}
			cmd.Body = cmdMap["body"]
			out = append(out, cmd)
		}
		return out, true
	default:
		return nil, false
	}
}

func parseControlCommandsBody(body interface{}) (ControlCommands, error) {
	bodyMap, err := decodeBodyMap(body)
	if err != nil {
		return ControlCommands{}, err
	}

	var out ControlCommands
	if devices, ok := toStringSlice(bodyMap["devices"]); ok {
		out.Devices = devices
	} else if _, exists := bodyMap["devices"]; exists {
		return ControlCommands{}, fmt.Errorf("invalid devices in control/commands")
	}

	if commands, ok := toCommands(bodyMap["commands"]); ok {
		out.Commands = commands
	} else if _, exists := bodyMap["commands"]; exists {
		return ControlCommands{}, fmt.Errorf("invalid commands in control/commands")
	}

	return out, nil
}

func parseHTTPProxyRequestBody(body interface{}) (HTTPProxyRequest, error) {
	bodyMap, err := decodeBodyMap(body)
	if err != nil {
		return HTTPProxyRequest{}, err
	}

	var out HTTPProxyRequest
	if devices, ok := toStringSlice(bodyMap["devices"]); ok {
		out.Devices = devices
	} else if _, exists := bodyMap["devices"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid devices in control/http")
	}
	if requestID, ok := toString(bodyMap["requestId"]); ok {
		out.RequestID = requestID
	} else if _, exists := bodyMap["requestId"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid requestId in control/http")
	}
	if method, ok := toString(bodyMap["method"]); ok {
		out.Method = method
	} else if _, exists := bodyMap["method"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid method in control/http")
	}
	if path, ok := toString(bodyMap["path"]); ok {
		out.Path = path
	} else if _, exists := bodyMap["path"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid path in control/http")
	}

	if query, ok := toMapStringInterface(bodyMap["query"]); ok {
		out.Query = query
	} else if _, exists := bodyMap["query"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid query in control/http")
	}
	if headers, ok := toMapStringString(bodyMap["headers"]); ok {
		out.Headers = headers
	} else if _, exists := bodyMap["headers"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid headers in control/http")
	}
	if rawBody, ok := toString(bodyMap["body"]); ok {
		out.Body = rawBody
	} else if _, exists := bodyMap["body"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid body in control/http")
	}
	if port, ok := toInt(bodyMap["port"]); ok {
		out.Port = port
	} else if _, exists := bodyMap["port"]; exists {
		return HTTPProxyRequest{}, fmt.Errorf("invalid port in control/http")
	}

	return out, nil
}

func parseHTTPProxyRequestBinBody(body interface{}) (HTTPProxyRequestBin, error) {
	bodyMap, err := decodeBodyMap(body)
	if err != nil {
		return HTTPProxyRequestBin{}, err
	}

	var out HTTPProxyRequestBin
	if devices, ok := toStringSlice(bodyMap["devices"]); ok {
		out.Devices = devices
	} else if _, exists := bodyMap["devices"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid devices in control/http-bin")
	}
	if requestID, ok := toString(bodyMap["requestId"]); ok {
		out.RequestID = requestID
	} else if _, exists := bodyMap["requestId"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid requestId in control/http-bin")
	}
	if method, ok := toString(bodyMap["method"]); ok {
		out.Method = method
	} else if _, exists := bodyMap["method"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid method in control/http-bin")
	}
	if path, ok := toString(bodyMap["path"]); ok {
		out.Path = path
	} else if _, exists := bodyMap["path"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid path in control/http-bin")
	}

	if query, ok := toMapStringInterface(bodyMap["query"]); ok {
		out.Query = query
	} else if _, exists := bodyMap["query"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid query in control/http-bin")
	}
	if headers, ok := toMapStringString(bodyMap["headers"]); ok {
		out.Headers = headers
	} else if _, exists := bodyMap["headers"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid headers in control/http-bin")
	}
	if port, ok := toInt(bodyMap["port"]); ok {
		out.Port = port
	} else if _, exists := bodyMap["port"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid port in control/http-bin")
	}
	if bodySize, ok := toInt(bodyMap["bodySize"]); ok {
		out.BodySize = bodySize
	} else if _, exists := bodyMap["bodySize"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid bodySize in control/http-bin")
	}
	if chunkSize, ok := toInt(bodyMap["chunkSize"]); ok {
		out.ChunkSize = chunkSize
	} else if _, exists := bodyMap["chunkSize"]; exists {
		return HTTPProxyRequestBin{}, fmt.Errorf("invalid chunkSize in control/http-bin")
	}

	return out, nil
}

func parseLogSubscribeRequestBody(body interface{}) (LogSubscribeRequest, error) {
	bodyMap, err := decodeBodyMap(body)
	if err != nil {
		return LogSubscribeRequest{}, err
	}

	var out LogSubscribeRequest
	if devices, ok := toStringSlice(bodyMap["devices"]); ok {
		out.Devices = devices
	} else if _, exists := bodyMap["devices"]; exists {
		return LogSubscribeRequest{}, fmt.Errorf("invalid devices in log subscribe request")
	}
	return out, nil
}

// snapshotControllerConnsLocked copies controller sockets.
// Caller must hold mu lock (read or write).
func snapshotControllerConnsLocked() []*SafeConn {
	controllerList := make([]*SafeConn, 0, len(controllers))
	for controllerConn := range controllers {
		controllerList = append(controllerList, controllerConn)
	}
	return controllerList
}

// snapshotDeviceConnsByIDsLocked copies device sockets for the given IDs.
// Caller must hold mu lock (read or write).
func snapshotDeviceConnsByIDsLocked(deviceIDs []string) map[string]*SafeConn {
	deviceConns := make(map[string]*SafeConn, len(deviceIDs))
	for _, udid := range deviceIDs {
		if deviceConn, exists := deviceLinks[udid]; exists {
			deviceConns[udid] = deviceConn
		}
	}
	return deviceConns
}

type deviceTarget struct {
	udid string
	conn *SafeConn
}

func snapshotAllDeviceTargets() []deviceTarget {
	mu.RLock()
	targets := make([]deviceTarget, 0, len(deviceLinks))
	for udid, deviceConn := range deviceLinks {
		targets = append(targets, deviceTarget{
			udid: udid,
			conn: deviceConn,
		})
	}
	mu.RUnlock()
	return targets
}

// ensureController marks a socket as controller once.
// Uses a read-first fast path to avoid repeated write locking on hot control paths.
func ensureController(conn *SafeConn) {
	if conn == nil {
		return
	}

	mu.RLock()
	alreadyController := controllers[conn]
	mu.RUnlock()
	if alreadyController {
		return
	}

	mu.Lock()
	controllers[conn] = true
	mu.Unlock()
}

// addLogSubscriberLocked registers a controller as a log subscriber for a device.
// Caller must hold mu.Lock.
func addLogSubscriberLocked(udid string, conn *SafeConn) bool {
	if udid == "" || conn == nil {
		return false
	}
	subs := logSubscriptions[udid]
	if subs == nil {
		subs = make(map[*SafeConn]bool)
		logSubscriptions[udid] = subs
	}
	if subs[conn] {
		return false
	}
	wasEmpty := len(subs) == 0
	subs[conn] = true
	return wasEmpty
}

// removeLogSubscriberLocked removes a controller from a device's log subscription.
// Caller must hold mu.Lock.
func removeLogSubscriberLocked(udid string, conn *SafeConn) bool {
	if udid == "" || conn == nil {
		return false
	}
	subs, ok := logSubscriptions[udid]
	if !ok {
		return false
	}
	if !subs[conn] {
		return false
	}
	delete(subs, conn)
	if len(subs) == 0 {
		delete(logSubscriptions, udid)
		return true
	}
	return false
}

// removeLogSubscriberFromAllLocked removes a controller from all device log subscriptions.
// Caller must hold mu.Lock.
func removeLogSubscriberFromAllLocked(conn *SafeConn) []string {
	if conn == nil {
		return nil
	}
	emptied := make([]string, 0)
	for udid, subs := range logSubscriptions {
		if subs[conn] {
			delete(subs, conn)
			if len(subs) == 0 {
				delete(logSubscriptions, udid)
				emptied = append(emptied, udid)
			}
		}
	}
	return emptied
}

// getReadableCommandName returns a human-readable name for typical device commands
func getReadableCommandName(cmdType string) string {
	switch cmdType {
	case "script/run":
		return "运行脚本"
	case "script/stop":
		return "停止脚本"
	case "device/reboot":
		return "重启设备"
	case "device/respring":
		return "注销桌面"
	case "device/home":
		return "主屏幕"
	case "device/lock":
		return "锁定屏幕"
	case "device/unlock":
		return "解锁屏幕"
	case "device/volume/up":
		return "增加音量"
	case "device/volume/down":
		return "减少音量"
	case "pasteboard/write":
		return "写入剪贴板"
	case "pasteboard/read":
		return "读取剪贴板"
	case "file/put":
		return "上传文件"
	case "file/delete":
		return "删除文件"
	case "file/get":
		return "下载文件"
	case "transfer/fetch":
		return "拉取大文件"
	case "app/install":
		return "安装应用"
	case "app/uninstall":
		return "卸载应用"
	case "app/open":
		return "打开应用"
	case "app/close":
		return "关闭应用"
	}
	return ""
}

// isDataValid validates message signature
func isDataValid(data Message) bool {
	return verifyMessageSignature(data)
}

func getDeviceLifeLimit() int {
	if serverConfig.PingTimeout > 0 {
		return serverConfig.PingTimeout
	}
	if DefaultConfig.PingTimeout > 0 {
		return DefaultConfig.PingTimeout
	}
	return DefaultDeviceLife
}

// resetDeviceLife resets a device's life counter to default
func resetDeviceLife(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	if udid, exists := deviceLinksMap[conn]; exists {
		deviceLife[udid] = getDeviceLifeLimit()
	}
}

// checkAndUpdateDeviceLife checks and updates all device life counters
func checkAndUpdateDeviceLife() {
	disconnectTargets := make([]deviceTarget, 0)

	mu.Lock()
	for udid, life := range deviceLife {
		if life <= 0 {
			wsDebugf("Device %s life exhausted, will disconnect", udid)
			if deviceConn, exists := deviceLinks[udid]; exists {
				disconnectTargets = append(disconnectTargets, deviceTarget{
					udid: udid,
					conn: deviceConn,
				})
			}
			continue
		}
		deviceLife[udid] = life - 1
	}
	mu.Unlock()

	for _, target := range disconnectTargets {
		go func(dc *SafeConn, deviceUDID string) {
			wsDebugf("Disconnecting device %s due to life exhaustion", deviceUDID)
			dc.Close()
			handleDisconnection(dc)
		}(target.conn, target.udid)
	}
}

// handleWebSocketConnection handles WebSocket connections
func handleWebSocketConnection(c *gin.Context) {
	w := c.Writer
	r := c.Request
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	safeConn := &SafeConn{conn: conn}
	defer safeConn.Close()

	// Count PONG frames as liveness signals to avoid false disconnects when
	// device has no frequent text/binary traffic.
	safeConn.conn.SetPongHandler(func(string) error {
		resetDeviceLife(safeConn)
		return nil
	})

	wsDebugf("New connection from: %s", safeConn.RemoteAddr())

	for {
		messageType, messageBytes, err := safeConn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		resetDeviceLife(safeConn)

		if messageType == websocket.BinaryMessage {
			handleBinaryMessage(safeConn, messageBytes)
			continue
		}

		if messageType != websocket.TextMessage {
			continue
		}

		var data Message
		if err := json.Unmarshal(messageBytes, &data); err != nil {
			continue
		}

		if err := handleMessage(safeConn, data); err != nil {
			log.Printf("Handle message error: %v", err)
		}
	}

	handleDisconnection(safeConn)
}

// handleMessage processes incoming WebSocket messages
func handleMessage(conn *SafeConn, data Message) error {
	switch data.Type {
	case "control/devices":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		ensureController(conn)

		mu.RLock()
		deviceTableSnapshot := make(map[string]interface{}, len(deviceTable))
		for udid, deviceState := range deviceTable {
			deviceTableSnapshot[udid] = deviceState
		}
		mu.RUnlock()

		response := Message{
			Type: "control/devices",
			Body: deviceTableSnapshot,
		}
		responseBytes, err := json.Marshal(response)
		if err != nil {
			return err
		}
		return writeTextMessage(conn, responseBytes)

	case "control/refresh":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		ensureController(conn)

		var deviceConns []*SafeConn
		mu.RLock()
		deviceConns = make([]*SafeConn, 0, len(deviceLinks))
		for _, deviceConn := range deviceLinks {
			deviceConns = append(deviceConns, deviceConn)
		}
		mu.RUnlock()

		refreshMsg := Message{
			Type: "app/state",
			Body: "",
		}
		refreshBytes, err := json.Marshal(refreshMsg)
		if err != nil {
			return err
		}
		for _, deviceConn := range deviceConns {
			writeTextMessageAsync(deviceConn, refreshBytes)
		}

	case "control/command":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		cmdBody, err := parseControlCommandBody(data.Body)
		if err != nil {
			return err
		}

		ensureController(conn)

		var deviceConns map[string]*SafeConn
		mu.RLock()
		deviceConns = snapshotDeviceConnsByIDsLocked(cmdBody.Devices)
		mu.RUnlock()

		cmdMsg := Message{
			Type:      cmdBody.Type,
			Body:      cmdBody.Body,
			RequestID: cmdBody.RequestID,
		}
		cmdBytes, err := json.Marshal(cmdMsg)
		if err != nil {
			return err
		}

		readableName := getReadableCommandName(cmdBody.Type)

		for _, udid := range cmdBody.Devices {
			if deviceConn, exists := deviceConns[udid]; exists {
				if readableName != "" {
					broadcastDeviceMessage(udid, readableName)
				}
				writeTextMessageAsync(deviceConn, cmdBytes)
			}
		}

	case "control/commands":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		cmdsBody, err := parseControlCommandsBody(data.Body)
		if err != nil {
			return err
		}

		ensureController(conn)

		var deviceConns map[string]*SafeConn
		mu.RLock()
		deviceConns = snapshotDeviceConnsByIDsLocked(cmdsBody.Devices)
		mu.RUnlock()

		commandPayloads := make([][]byte, 0, len(cmdsBody.Commands))
		commandNames := make([]string, 0, len(cmdsBody.Commands))
		for _, cmd := range cmdsBody.Commands {
			cmdMsg := Message{
				Type: cmd.Type,
				Body: cmd.Body,
			}
			payload, err := json.Marshal(cmdMsg)
			if err != nil {
				return err
			}
			commandPayloads = append(commandPayloads, payload)
			commandNames = append(commandNames, getReadableCommandName(cmd.Type))
		}

		for _, udid := range cmdsBody.Devices {
			if deviceConn, exists := deviceConns[udid]; exists {
				for i, payload := range commandPayloads {
					readableName := commandNames[i]
					if readableName != "" {
						broadcastDeviceMessage(udid, readableName)
					}
					writeTextMessageAsync(deviceConn, payload)
				}
			}
		}

	case "control/http":
		// HTTP 代理：将 HTTP 请求转发到目标设备（使用 http.request）
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		httpReq, err := parseHTTPProxyRequestBody(data.Body)
		if err != nil {
			log.Printf("[http] Failed to parse request: %v", err)
			return err
		}

		httpDebugf("[http] Received control/http for devices: %v, path: %s", httpReq.Devices, httpReq.Path)

		// 构建发送给设备的消息
		httpBody := map[string]interface{}{
			"requestId": httpReq.RequestID,
			"method":    httpReq.Method,
			"path":      httpReq.Path,
			"query":     httpReq.Query,
			"headers":   httpReq.Headers,
			"body":      httpReq.Body,
			"port":      httpReq.Port,
		}

		// 如果是 WebRTC start 请求，注入 TURN 服务器配置
		if httpReq.Path == "/api/webrtc/start" && httpReq.Method == "POST" {
			turnICEServers := GetTURNICEServers()
			if len(turnICEServers) > 0 {
				// 解析原始请求体
				var originalBody map[string]interface{}
				if httpReq.Body != "" {
					decodedBody, err := base64.StdEncoding.DecodeString(httpReq.Body)
					if err == nil {
						json.Unmarshal(decodedBody, &originalBody)
					}
				}
				if originalBody == nil {
					originalBody = make(map[string]interface{})
				}

				// 合并 TURN 服务器到 iceServers
				existingIceServers, _ := originalBody["iceServers"].([]interface{})
				for _, turnServer := range turnICEServers {
					existingIceServers = append(existingIceServers, turnServer)
				}
				originalBody["iceServers"] = existingIceServers

				// 重新编码请求体
				newBodyBytes, err := json.Marshal(originalBody)
				if err == nil {
					httpBody["body"] = base64.StdEncoding.EncodeToString(newBodyBytes)
					httpDebugf("[http] Injected TURN server config for WebRTC start request")
				}
			}
		}

		httpMsg := Message{
			Type: "http/request",
			Body: httpBody,
		}
		httpBytes, err := json.Marshal(httpMsg)
		if err != nil {
			return err
		}

		ensureController(conn)

		var deviceConns map[string]*SafeConn
		mu.RLock()
		deviceConns = snapshotDeviceConnsByIDsLocked(httpReq.Devices)
		mu.RUnlock()

		for _, udid := range httpReq.Devices {
			if deviceConn, exists := deviceConns[udid]; exists {
				deviceUDID := udid
				dc := deviceConn
				httpDebugf("[http] Sending http/request to device %s", udid)
				runAsyncWrite(func() {
					if err := writeTextMessage(dc, httpBytes); err != nil {
						log.Printf("[http] Failed to send to device %s: %v", deviceUDID, err)
					}
				})
			} else {
				httpDebugf("[http] Device %s not found in deviceLinks", udid)
			}
		}

	case "control/http-bin":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		httpReq, err := parseHTTPProxyRequestBinBody(data.Body)
		if err != nil {
			log.Printf("[http-bin] Failed to parse request: %v", err)
			return err
		}
		if httpReq.RequestID == "" {
			return fmt.Errorf("http-bin missing requestId")
		}

		httpBody := map[string]interface{}{
			"requestId": httpReq.RequestID,
			"method":    httpReq.Method,
			"path":      httpReq.Path,
			"query":     httpReq.Query,
			"headers":   httpReq.Headers,
			"port":      httpReq.Port,
			"bodySize":  httpReq.BodySize,
			"chunkSize": httpReq.ChunkSize,
		}

		httpMsg := Message{
			Type: "http/request-bin",
			Body: httpBody,
		}
		httpBytes, err := json.Marshal(httpMsg)
		if err != nil {
			return err
		}

		ensureController(conn)

		var deviceConns map[string]*SafeConn
		mu.Lock()
		binaryRoutes[httpReq.RequestID] = &BinaryRoute{
			Controller: conn,
			Devices:    httpReq.Devices,
		}
		deviceConns = snapshotDeviceConnsByIDsLocked(httpReq.Devices)
		mu.Unlock()

		for _, udid := range httpReq.Devices {
			if deviceConn, exists := deviceConns[udid]; exists {
				deviceUDID := udid
				dc := deviceConn
				httpDebugf("[http-bin] Sending http/request-bin to device %s", udid)
				runAsyncWrite(func() {
					if err := writeTextMessage(dc, httpBytes); err != nil {
						log.Printf("[http-bin] Failed to send to device %s: %v", deviceUDID, err)
					}
				})
			} else {
				httpDebugf("[http-bin] Device %s not found in deviceLinks", udid)
			}
		}

	case "control/log/subscribe":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		req, err := parseLogSubscribeRequestBody(data.Body)
		if err != nil {
			return err
		}

		subscribeTargets := make([]*SafeConn, 0, len(req.Devices))
		mu.Lock()
		if !controllers[conn] {
			controllers[conn] = true
		}
		for _, udid := range req.Devices {
			first := addLogSubscriberLocked(udid, conn)
			if first {
				if deviceConn, exists := deviceLinks[udid]; exists {
					subscribeTargets = append(subscribeTargets, deviceConn)
				}
			}
		}
		mu.Unlock()

		if len(subscribeTargets) > 0 {
			subscribePayload, err := json.Marshal(Message{Type: "system/log/subscribe"})
			if err != nil {
				return err
			}
			for _, deviceConn := range subscribeTargets {
				writeTextMessageAsync(deviceConn, subscribePayload)
			}
		}

	case "control/log/unsubscribe":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}

		req, err := parseLogSubscribeRequestBody(data.Body)
		if err != nil {
			return err
		}

		unsubscribeTargets := make([]*SafeConn, 0, len(req.Devices))
		mu.Lock()
		if !controllers[conn] {
			controllers[conn] = true
		}
		for _, udid := range req.Devices {
			last := removeLogSubscriberLocked(udid, conn)
			if last {
				if deviceConn, exists := deviceLinks[udid]; exists {
					unsubscribeTargets = append(unsubscribeTargets, deviceConn)
				}
			}
		}
		mu.Unlock()

		if len(unsubscribeTargets) > 0 {
			unsubscribePayload, err := json.Marshal(Message{Type: "system/log/unsubscribe"})
			if err != nil {
				return err
			}
			for _, deviceConn := range unsubscribeTargets {
				writeTextMessageAsync(deviceConn, unsubscribePayload)
			}
		}

	case "http/response-bin":
		requestId := ""
		bodySize := -1
		if bodyMap, ok := data.Body.(map[string]interface{}); ok {
			if rid, ok := bodyMap["requestId"].(string); ok {
				requestId = rid
			}
			if sizeVal, ok := toInt(bodyMap["bodySize"]); ok {
				bodySize = sizeVal
			}
		}

		var (
			controllerCount int
			routeController *SafeConn
			controllerList  []*SafeConn
		)
		mu.RLock()
		controllerCount = len(controllers)
		if requestId != "" {
			if route, exists := binaryRoutes[requestId]; exists && route.Controller != nil {
				routeController = route.Controller
			}
		}
		controllerList = snapshotControllerConnsLocked()
		mu.RUnlock()

		if controllerCount == 0 {
			return nil
		}

		encodedData, err := json.Marshal(data)
		if err != nil {
			return err
		}

		if routeController != nil {
			if err := writeTextMessage(routeController, encodedData); err == nil {
				if requestId != "" && bodySize == 0 {
					mu.Lock()
					delete(binaryRoutes, requestId)
					mu.Unlock()
				}
				return nil
			}
		}

		for _, controllerConn := range controllerList {
			writeTextMessageAsync(controllerConn, encodedData)
		}
		if requestId != "" && bodySize == 0 {
			mu.Lock()
			delete(binaryRoutes, requestId)
			mu.Unlock()
		}
		return nil

	case "app/state":
		bodyMap, ok := data.Body.(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid app/state body")
		}

		systemMap, ok := bodyMap["system"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid system data in app/state")
		}

		udid, ok := systemMap["udid"].(string)
		if !ok {
			return fmt.Errorf("invalid udid in app/state")
		}

		var (
			needsLogSubscribe bool
			controllerList    []*SafeConn
		)
		mu.Lock()
		deviceLinks[udid] = conn
		deviceLinksMap[conn] = udid
		deviceTable[udid] = data.Body
		deviceLife[udid] = getDeviceLifeLimit()
		if subs, ok := logSubscriptions[udid]; ok && len(subs) > 0 {
			needsLogSubscribe = true
		}
		if len(controllers) > 0 {
			controllerList = snapshotControllerConnsLocked()
		}
		mu.Unlock()

		if needsLogSubscribe {
			subscribePayload, err := json.Marshal(Message{Type: "system/log/subscribe"})
			if err != nil {
				return err
			}
			writeTextMessageAsync(conn, subscribePayload)
		}

		if len(controllerList) > 0 {
			data.UDID = udid
			encodedData, err := json.Marshal(data)
			if err != nil {
				return err
			}
			for _, controllerConn := range controllerList {
				writeTextMessageAsync(controllerConn, encodedData)
			}
		}

	case "register":
		// Already handled by initial registration or specialized logic?
		// Typically register is the first message.
		return nil

	case "system/log/push":
		var (
			udid           string
			subscriberList []*SafeConn
		)
		mu.RLock()
		if mappedUDID, exists := deviceLinksMap[conn]; exists {
			udid = mappedUDID
			if subs, ok := logSubscriptions[udid]; ok && len(subs) > 0 {
				subscriberList = make([]*SafeConn, 0, len(subs))
				for controllerConn := range subs {
					subscriberList = append(subscriberList, controllerConn)
				}
			}
		}
		mu.RUnlock()

		if udid != "" && len(subscriberList) > 0 {
			data.UDID = udid
			encodedData, err := json.Marshal(data)
			if err != nil {
				return err
			}
			for _, controllerConn := range subscriberList {
				writeTextMessageAsync(controllerConn, encodedData)
			}
		}
		return nil

	default:
		var (
			udid           string
			controllerList []*SafeConn
		)
		mu.RLock()
		if len(controllers) > 0 {
			if mappedUDID, exists := deviceLinksMap[conn]; exists {
				udid = mappedUDID
				controllerList = snapshotControllerConnsLocked()
			}
		}
		mu.RUnlock()

		if udid != "" && len(controllerList) > 0 {
			// 记录转发的消息类型
			if data.Type == "http/response" || data.Type == "http/request" {
				httpDebugf("[%s] Forwarding %s from device %s to %d controllers", data.Type, data.Type, udid, len(controllerList))
			}
			data.UDID = udid
			encodedData, err := json.Marshal(data)
			if err != nil {
				return err
			}
			for _, controllerConn := range controllerList {
				writeTextMessageAsync(controllerConn, encodedData)
			}
		}
	}

	return nil
}

// handleBinaryMessage forwards binary body chunks between controller and device.
func handleBinaryMessage(conn *SafeConn, payload []byte) {
	reqID, seq, total, ok := parseBinaryHeader(payload)
	if !ok {
		return
	}

	var (
		deviceTargets   []*SafeConn
		controllerList  []*SafeConn
		routeController *SafeConn
		shouldDelete    bool
	)

	mu.RLock()
	if controllers[conn] {
		route := binaryRoutes[reqID]
		if route != nil {
			for _, udid := range route.Devices {
				if deviceConn, exists := deviceLinks[udid]; exists {
					deviceTargets = append(deviceTargets, deviceConn)
				}
			}
		}
		mu.RUnlock()

		for _, deviceConn := range deviceTargets {
			sendBinaryMessageAsync(deviceConn, payload)
		}
		return
	}

	if _, exists := deviceLinksMap[conn]; exists {
		if route, exists := binaryRoutes[reqID]; exists && route.Controller != nil {
			routeController = route.Controller
		} else {
			controllerList = snapshotControllerConnsLocked()
		}
		if total > 0 && seq+1 >= total {
			shouldDelete = true
		}
	}
	mu.RUnlock()

	if routeController != nil {
		sendBinaryMessageAsync(routeController, payload)
	} else {
		for _, controllerConn := range controllerList {
			sendBinaryMessageAsync(controllerConn, payload)
		}
	}

	if shouldDelete {
		mu.Lock()
		delete(binaryRoutes, reqID)
		mu.Unlock()
	}
}

// sendMessage sends a message to a WebSocket connection
func sendMessage(conn *SafeConn, msg Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return writeTextMessage(conn, data)
}

func sendMessageAsync(conn *SafeConn, msg Message) {
	runAsyncWrite(func() {
		_ = sendMessage(conn, msg)
	})
}

// handleDisconnection handles WebSocket disconnection
func handleDisconnection(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	wsDebugf("Connection closed: %s", conn.RemoteAddr())

	if _, isController := controllers[conn]; isController {
		wsDebugf("Controller %s disconnected", conn.RemoteAddr())
		emptied := removeLogSubscriberFromAllLocked(conn)
		if len(emptied) > 0 {
			unsubscribePayload, err := json.Marshal(Message{Type: "system/log/unsubscribe"})
			if err != nil {
				log.Printf("Failed to marshal unsubscribe message: %v", err)
			} else {
				for _, udid := range emptied {
					if deviceConn, exists := deviceLinks[udid]; exists {
						writeTextMessageAsync(deviceConn, unsubscribePayload)
					}
				}
			}
		}
		for id, route := range binaryRoutes {
			if route != nil && route.Controller == conn {
				delete(binaryRoutes, id)
			}
		}
		delete(controllers, conn)
		return
	}

	if udid, exists := deviceLinksMap[conn]; exists {
		wsDebugf("Device %s disconnected", udid)

		delete(deviceLinksMap, conn)

		if currentConn, ok := deviceLinks[udid]; ok && currentConn != conn {
			return
		}

		delete(deviceTable, udid)
		delete(deviceLinks, udid)
		delete(deviceLife, udid)
		delete(logSubscriptions, udid)
		for id, route := range binaryRoutes {
			if route != nil {
				for _, deviceID := range route.Devices {
					if deviceID == udid {
						delete(binaryRoutes, id)
						break
					}
				}
			}
		}

		if len(controllers) > 0 {
			disconnectMsg := Message{
				Type: "device/disconnect",
				Body: udid,
			}
			disconnectPayload, err := json.Marshal(disconnectMsg)
			if err != nil {
				log.Printf("Failed to marshal disconnect message for %s: %v", udid, err)
				return
			}

			for controllerConn := range controllers {
				writeTextMessageAsync(controllerConn, disconnectPayload)
			}
		}
	}
}

// startPingTimer starts the periodic WebSocket PING timer
func startPingTimer() {
	pingIntervalDuration := time.Duration(serverConfig.PingInterval) * time.Second
	pingTicker = time.NewTicker(pingIntervalDuration)

	go func() {
		for {
			select {
			case <-pingTicker.C:
				sendPingToAllDevices()
			case <-stopPing:
				pingTicker.Stop()
				return
			}
		}
	}()

	fmt.Printf("Ping timer started (interval: %v)\n", pingIntervalDuration)
}

// stopPingTimer stops the periodic WebSocket PING timer
func stopPingTimer() {
	if pingTicker != nil {
		select {
		case stopPing <- true:
		default:
		}
	}
	fmt.Println("Ping timer stopped")
}

// startStateRefreshTimer starts the periodic app/state request timer
func startStateRefreshTimer() {
	stateIntervalDuration := time.Duration(serverConfig.StateInterval) * time.Second
	stateRefreshTicker = time.NewTicker(stateIntervalDuration)

	go func() {
		for {
			select {
			case <-stateRefreshTicker.C:
				sendStateRequestToAllDevices()
			case <-stopStateRefresh:
				stateRefreshTicker.Stop()
				return
			}
		}
	}()

	fmt.Printf("State refresh timer started (interval: %v)\n", stateIntervalDuration)
}

// stopStateRefreshTimer stops the periodic app/state request timer
func stopStateRefreshTimer() {
	if stateRefreshTicker != nil {
		select {
		case stopStateRefresh <- true:
		default:
		}
	}
	fmt.Println("State refresh timer stopped")
}

// sendStateRequestToAllDevices sends app/state requests to all connected devices
func sendStateRequestToAllDevices() {
	deviceTargets := snapshotAllDeviceTargets()
	deviceCount := len(deviceTargets)
	if deviceCount == 0 {
		return
	}

	stateMsg := Message{
		Type: "app/state",
		Body: "",
	}
	statePayload, err := json.Marshal(stateMsg)
	if err != nil {
		log.Printf("Failed to marshal state request: %v", err)
		return
	}

	for _, target := range deviceTargets {
		deviceUDID := target.udid
		dc := target.conn
		runAsyncWrite(func() {
			if err := writeTextMessage(dc, statePayload); err != nil {
				log.Printf("Failed to send state request to device %s: %v", deviceUDID, err)
			}
		})
	}
}

// sendPingToAllDevices sends WebSocket PING to all connected devices
func sendPingToAllDevices() {
	checkAndUpdateDeviceLife()

	deviceTargets := snapshotAllDeviceTargets()
	deviceCount := len(deviceTargets)
	if deviceCount == 0 {
		return
	}

	for _, target := range deviceTargets {
		deviceUDID := target.udid
		dc := target.conn
		runAsyncWrite(func() {
			if err := dc.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				log.Printf("Failed to send ping to device %s: %v", deviceUDID, err)
			}
		})
	}
}
