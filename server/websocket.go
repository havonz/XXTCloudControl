package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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

// isSignatureValid validates a timestamp-based signature
func isSignatureValid(timestamp int64, sign string) bool {
	if timestamp == 0 || sign == "" {
		return false
	}

	currentTime := time.Now().Unix()
	if timestamp < currentTime-10 || timestamp > currentTime+10 {
		return false
	}

	h := hmac.New(sha256.New, passhash)
	h.Write([]byte(strconv.FormatInt(timestamp, 10)))
	expectedSign := hex.EncodeToString(h.Sum(nil))

	return hmac.Equal([]byte(expectedSign), []byte(sign))
}

// isDataValid validates message signature
func isDataValid(data Message) bool {
	return isSignatureValid(data.TS, data.Sign)
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
		_, messageBytes, err := safeConn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		resetDeviceLife(safeConn)

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
			Type: cmdBody.Type,
			Body: cmdBody.Body,
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

// startStatusRequestTimer starts the periodic status request timer
func startStatusRequestTimer() {
	pingIntervalDuration := time.Duration(serverConfig.PingInterval) * time.Second
	statusTicker = time.NewTicker(pingIntervalDuration)

	go func() {
		for {
			select {
			case <-statusTicker.C:
				sendStatusRequestToAllDevices()
			case <-stopTicker:
				statusTicker.Stop()
				return
			}
		}
	}()

	fmt.Printf("Ping timer started (interval: %v)\n", pingIntervalDuration)
}

// stopStatusRequestTimer stops the periodic status request timer
func stopStatusRequestTimer() {
	if statusTicker != nil {
		select {
		case stopTicker <- true:
		default:
		}
	}
	fmt.Println("Ping timer stopped")
}

// sendStatusRequestToAllDevices sends status requests to all connected devices
func sendStatusRequestToAllDevices() {
	checkAndUpdateDeviceLife()

	mu.RLock()
	deviceCount := len(deviceLinks)
	mu.RUnlock()

	if deviceCount == 0 {
		return
	}

	statusMsg := Message{
		Type: "app/state",
		Body: "",
	}

	mu.RLock()
	for udid, deviceConn := range deviceLinks {
		go func(dc *SafeConn, deviceUDID string) {
			if err := sendMessage(dc, statusMsg); err != nil {
				log.Printf("Failed to send status request to device %s: %v", deviceUDID, err)
			}
		}(deviceConn, udid)
	}
	mu.RUnlock()
}
