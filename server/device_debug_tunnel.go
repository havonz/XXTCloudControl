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
		jsonError(c, http.StatusNotFound, "error.debug.device_not_found")
		return
	}
	if !supportsDebugTunnel {
		jsonError(c, http.StatusPreconditionFailed, "error.debug.unsupported")
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
		sendDebugTunnelError(controllerConn, requestTranslator(c), "error.debug.request_id_failed", err.Error())
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
		sendDebugTunnelError(controllerConn, requestTranslator(c), "error.debug.request_failed", err.Error())
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

func sendDebugTunnelError(conn *SafeConn, translator Translator, code string, detail string) {
	body := map[string]any{
		"error":     translator.TR(code),
		"errorCode": code,
	}
	if detail != "" {
		body["detail"] = detail
	}
	payload, err := json.Marshal(Message{Type: "debug-tunnel/close", Body: body})
	if err == nil {
		_ = conn.WriteMessage(websocket.TextMessage, payload)
	}
}
