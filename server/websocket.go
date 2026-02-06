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

// resetDeviceLife resets a device's life counter to default
func resetDeviceLife(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	if udid, exists := deviceLinksMap[conn]; exists {
		deviceLife[udid] = DefaultDeviceLife
	}
}

// checkAndUpdateDeviceLife checks and updates all device life counters
func checkAndUpdateDeviceLife() {
	mu.Lock()
	defer mu.Unlock()

	disconnectDevices := make([]string, 0)

	for udid, life := range deviceLife {
		if life <= 0 {
			disconnectDevices = append(disconnectDevices, udid)
			fmt.Printf("Device %s life exhausted, will disconnect\n", udid)
		} else {
			deviceLife[udid] = life - 1
		}
	}

	for _, udid := range disconnectDevices {
		if deviceConn, exists := deviceLinks[udid]; exists {
			go func(dc *SafeConn, deviceUDID string) {
				fmt.Printf("Disconnecting device %s due to life exhaustion\n", deviceUDID)
				dc.Close()
				handleDisconnection(dc)
			}(deviceConn, udid)
		}
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

	fmt.Printf("New connection from: %s\n", safeConn.RemoteAddr())

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
	mu.Lock()
	defer mu.Unlock()

	switch data.Type {
	case "control/devices":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true
		response := Message{
			Type: "control/devices",
			Body: deviceTable,
		}
		return sendMessage(conn, response)

	case "control/refresh":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true
		refreshMsg := Message{
			Type: "app/state",
			Body: "",
		}
		for _, deviceConn := range deviceLinks {
			go func(dc *SafeConn) {
				sendMessage(dc, refreshMsg)
			}(deviceConn)
		}

	case "control/command":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var cmdBody ControlCommand
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &cmdBody); err != nil {
			return err
		}

		cmdMsg := Message{
			Type:      cmdBody.Type,
			Body:      cmdBody.Body,
			RequestID: cmdBody.RequestID,
		}

		readableName := getReadableCommandName(cmdBody.Type)

		for _, udid := range cmdBody.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				if readableName != "" {
					go broadcastDeviceMessage(udid, readableName)
				}
				go func(dc *SafeConn) {
					sendMessage(dc, cmdMsg)
				}(deviceConn)
			}
		}

	case "control/commands":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var cmdsBody ControlCommands
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &cmdsBody); err != nil {
			return err
		}

		for _, udid := range cmdsBody.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				for _, cmd := range cmdsBody.Commands {
					cmdMsg := Message{
						Type: cmd.Type,
						Body: cmd.Body,
					}
					readableName := getReadableCommandName(cmd.Type)
					if readableName != "" {
						go broadcastDeviceMessage(udid, readableName)
					}
					go func(dc *SafeConn, msg Message) {
						sendMessage(dc, msg)
					}(deviceConn, cmdMsg)
				}
			}
		}

	case "control/http":
		// HTTP 代理：将 HTTP 请求转发到目标设备（使用 http.request）
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var httpReq HTTPProxyRequest
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &httpReq); err != nil {
			log.Printf("[http] Failed to parse request: %v", err)
			return err
		}

		log.Printf("[http] Received control/http for devices: %v, path: %s", httpReq.Devices, httpReq.Path)

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
					log.Printf("[http] Injected TURN server config for WebRTC start request")
				}
			}
		}

		httpMsg := Message{
			Type: "http/request",
			Body: httpBody,
		}

		for _, udid := range httpReq.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				log.Printf("[http] Sending http/request to device %s", udid)
				go func(dc *SafeConn, u string) {
					if err := sendMessage(dc, httpMsg); err != nil {
						log.Printf("[http] Failed to send to device %s: %v", u, err)
					}
				}(deviceConn, udid)
			} else {
				log.Printf("[http] Device %s not found in deviceLinks", udid)
			}
		}

	case "control/http-bin":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var httpReq HTTPProxyRequestBin
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &httpReq); err != nil {
			log.Printf("[http-bin] Failed to parse request: %v", err)
			return err
		}
		if httpReq.RequestID == "" {
			return fmt.Errorf("http-bin missing requestId")
		}

		binaryRoutes[httpReq.RequestID] = &BinaryRoute{
			Controller: conn,
			Devices:    httpReq.Devices,
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

		for _, udid := range httpReq.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				log.Printf("[http-bin] Sending http/request-bin to device %s", udid)
				go func(dc *SafeConn, u string) {
					if err := sendMessage(dc, httpMsg); err != nil {
						log.Printf("[http-bin] Failed to send to device %s: %v", u, err)
					}
				}(deviceConn, udid)
			} else {
				log.Printf("[http-bin] Device %s not found in deviceLinks", udid)
			}
		}

	case "control/log/subscribe":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var req LogSubscribeRequest
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			return err
		}

		for _, udid := range req.Devices {
			first := addLogSubscriberLocked(udid, conn)
			if first {
				if deviceConn, exists := deviceLinks[udid]; exists {
					go func(dc *SafeConn) {
						sendMessage(dc, Message{Type: "system/log/subscribe"})
					}(deviceConn)
				}
			}
		}

	case "control/log/unsubscribe":
		if !isDataValid(data) {
			conn.Close()
			return nil
		}
		controllers[conn] = true

		var req LogSubscribeRequest
		bodyBytes, _ := json.Marshal(data.Body)
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			return err
		}

		for _, udid := range req.Devices {
			last := removeLogSubscriberLocked(udid, conn)
			if last {
				if deviceConn, exists := deviceLinks[udid]; exists {
					go func(dc *SafeConn) {
						sendMessage(dc, Message{Type: "system/log/unsubscribe"})
					}(deviceConn)
				}
			}
		}

	case "http/response-bin":
		if len(controllers) == 0 {
			return nil
		}
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

		if requestId != "" {
			if route, exists := binaryRoutes[requestId]; exists && route.Controller != nil {
				if err := sendMessage(route.Controller, data); err == nil {
					if bodySize == 0 {
						delete(binaryRoutes, requestId)
					}
					return nil
				}
			}
		}

		for controllerConn := range controllers {
			go func(cc *SafeConn, msg Message) {
				sendMessage(cc, msg)
			}(controllerConn, data)
		}
		if requestId != "" && bodySize == 0 {
			delete(binaryRoutes, requestId)
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

		deviceLinks[udid] = conn
		deviceLinksMap[conn] = udid
		deviceTable[udid] = data.Body
		deviceLife[udid] = DefaultDeviceLife
		if subs, ok := logSubscriptions[udid]; ok && len(subs) > 0 {
			go func(dc *SafeConn) {
				sendMessage(dc, Message{Type: "system/log/subscribe"})
			}(conn)
		}

		if len(controllers) > 0 {
			data.UDID = udid
			for controllerConn := range controllers {
				go func(cc *SafeConn, msg Message) {
					sendMessage(cc, msg)
				}(controllerConn, data)
			}
		}

	case "register":
		// Already handled by initial registration or specialized logic?
		// Typically register is the first message.
		return nil

	case "system/log/push":
		if udid, exists := deviceLinksMap[conn]; exists {
			if subs, ok := logSubscriptions[udid]; ok && len(subs) > 0 {
				data.UDID = udid
				for controllerConn := range subs {
					go func(cc *SafeConn, msg Message) {
						sendMessage(cc, msg)
					}(controllerConn, data)
				}
			}
		}
		return nil

	default:
		if len(controllers) > 0 {
			if udid, exists := deviceLinksMap[conn]; exists {
				// 记录转发的消息类型
				if data.Type == "http/response" || data.Type == "http/request" {
					log.Printf("[%s] Forwarding %s from device %s to %d controllers", data.Type, data.Type, udid, len(controllers))
				}
				data.UDID = udid
				for controllerConn := range controllers {
					go func(cc *SafeConn, msg Message) {
						sendMessage(cc, msg)
					}(controllerConn, data)
				}
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

	mu.Lock()
	defer mu.Unlock()

	if controllers[conn] {
		route := binaryRoutes[reqID]
		if route == nil {
			return
		}
		for _, udid := range route.Devices {
			if deviceConn, exists := deviceLinks[udid]; exists {
				go func(dc *SafeConn) {
					sendBinaryMessage(dc, payload)
				}(deviceConn)
			}
		}
		return
	}

	if _, exists := deviceLinksMap[conn]; exists {
		if route, ok := binaryRoutes[reqID]; ok && route.Controller != nil {
			go func(cc *SafeConn) {
				sendBinaryMessage(cc, payload)
			}(route.Controller)
		} else {
			for controllerConn := range controllers {
				go func(cc *SafeConn) {
					sendBinaryMessage(cc, payload)
				}(controllerConn)
			}
		}
		if total > 0 && seq+1 >= total {
			delete(binaryRoutes, reqID)
		}
	}
}

// sendMessage sends a message to a WebSocket connection
func sendMessage(conn *SafeConn, msg Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, data)
}

// handleDisconnection handles WebSocket disconnection
func handleDisconnection(conn *SafeConn) {
	mu.Lock()
	defer mu.Unlock()

	fmt.Printf("Connection closed: %s\n", conn.RemoteAddr())

	if _, isController := controllers[conn]; isController {
		fmt.Printf("Controller %s disconnected\n", conn.RemoteAddr())
		emptied := removeLogSubscriberFromAllLocked(conn)
		for _, udid := range emptied {
			if deviceConn, exists := deviceLinks[udid]; exists {
				go func(dc *SafeConn) {
					sendMessage(dc, Message{Type: "system/log/unsubscribe"})
				}(deviceConn)
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
		fmt.Printf("Device %s disconnected\n", udid)

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

			for controllerConn := range controllers {
				go func(cc *SafeConn, msg Message) {
					sendMessage(cc, msg)
				}(controllerConn, disconnectMsg)
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
	mu.RLock()
	deviceConns := make(map[string]*SafeConn, len(deviceLinks))
	for udid, deviceConn := range deviceLinks {
		deviceConns[udid] = deviceConn
	}
	mu.RUnlock()

	deviceCount := len(deviceConns)
	if deviceCount == 0 {
		return
	}

	stateMsg := Message{
		Type: "app/state",
		Body: "",
	}

	for udid, deviceConn := range deviceConns {
		go func(dc *SafeConn, deviceUDID string) {
			if err := sendMessage(dc, stateMsg); err != nil {
				log.Printf("Failed to send state request to device %s: %v", deviceUDID, err)
			}
		}(deviceConn, udid)
	}
}

// sendPingToAllDevices sends WebSocket PING to all connected devices
func sendPingToAllDevices() {
	checkAndUpdateDeviceLife()

	mu.RLock()
	deviceConns := make(map[string]*SafeConn, len(deviceLinks))
	for udid, deviceConn := range deviceLinks {
		deviceConns[udid] = deviceConn
	}
	mu.RUnlock()

	deviceCount := len(deviceConns)
	if deviceCount == 0 {
		return
	}

	for udid, deviceConn := range deviceConns {
		go func(dc *SafeConn, deviceUDID string) {
			if err := dc.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				log.Printf("Failed to send ping to device %s: %v", deviceUDID, err)
			}
		}(deviceConn, udid)
	}
}
