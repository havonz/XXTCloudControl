package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func newDebugTunnelRequestID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func cloudDeviceDebugTunnelHandler(c *gin.Context) {
	udid := c.Param("udid")

	var deviceConn *SafeConn
	var supportsDebugTunnel bool
	mu.RLock()
	deviceConn = deviceLinks[udid]
	if stateMap, ok := deviceTable[udid].(map[string]interface{}); ok {
		if cloudControl, ok := stateMap["cloudControl"].(map[string]interface{}); ok {
			if features, ok := cloudControl["features"].(map[string]interface{}); ok {
				supportsDebugTunnel, _ = features["debugTunnel"].(bool)
			}
		}
	}
	mu.RUnlock()
	if deviceConn == nil {
		c.String(http.StatusNotFound, "device not found")
		return
	}
	if !supportsDebugTunnel {
		c.String(http.StatusPreconditionFailed, "device cloud control client does not support debug tunnel")
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	controllerConn := &SafeConn{conn: conn}
	defer controllerConn.Close()

	requestID, err := newDebugTunnelRequestID()
	if err != nil {
		_ = controllerConn.WriteMessage(websocket.TextMessage, []byte(`{"type":"debug-tunnel/close","body":{"error":"failed to create request id"}}`))
		return
	}

	mu.Lock()
	binaryRoutes[requestID] = &BinaryRoute{
		Controller: controllerConn,
		Devices:    []string{udid},
	}
	mu.Unlock()
	defer func() {
		mu.Lock()
		delete(binaryRoutes, requestID)
		mu.Unlock()
	}()

	openMsg, err := json.Marshal(Message{
		Type: "debug-tunnel/open",
		Body: map[string]any{
			"requestId": requestID,
		},
	})
	if err != nil {
		return
	}
	if err := writeTextMessage(deviceConn, openMsg); err != nil {
		_ = controllerConn.WriteMessage(websocket.TextMessage, []byte(`{"type":"debug-tunnel/close","body":{"error":"failed to request device tunnel"}}`))
		return
	}

	for {
		messageType, payload, err := controllerConn.ReadMessage()
		if err != nil {
			closeMsg, _ := json.Marshal(Message{
				Type: "debug-tunnel/close",
				Body: map[string]any{
					"requestId": requestID,
				},
			})
			writeTextMessageAsync(deviceConn, closeMsg)
			return
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		frameRequestID, _, _, ok := parseBinaryHeader(payload)
		if !ok || frameRequestID != requestID {
			continue
		}
		sendBinaryMessageAsync(deviceConn, payload)
	}
}
