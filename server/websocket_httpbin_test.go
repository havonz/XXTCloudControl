package main

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type recordedWebSocketWrite struct {
	messageType int
	data        []byte
}

func signTestControlMessage(t *testing.T, typ string, body any, nonce string) Message {
	t.Helper()

	ts := time.Now().Unix()
	signatureBase := buildMessageSignatureString(ts, nonce, typ, hashJSONHex(body))
	return Message{
		Type:  typ,
		Body:  body,
		TS:    ts,
		Nonce: nonce,
		Sign:  computeSignatureHex(signatureBase),
	}
}

func buildTestHTTPBinFrame(t *testing.T, requestID string, seq, total uint32, payload []byte) []byte {
	t.Helper()

	idBytes, err := hex.DecodeString(requestID)
	if err != nil {
		t.Fatalf("decode request id: %v", err)
	}
	if len(idBytes) != 16 {
		t.Fatalf("request id must decode to 16 bytes, got %d", len(idBytes))
	}

	frame := make([]byte, binaryHeaderSize+len(payload))
	copy(frame[:16], idBytes)
	binary.BigEndian.PutUint32(frame[16:20], seq)
	binary.BigEndian.PutUint32(frame[20:24], total)
	copy(frame[binaryHeaderSize:], payload)
	return frame
}

func setupHTTPBinProxyTestState(t *testing.T, controllerConn, deviceConn *SafeConn) {
	t.Helper()

	resetUsedNoncesForTest()

	mu.Lock()
	passhashBackup := passhash
	deviceLinksBackup := deviceLinks
	deviceLinksMapBackup := deviceLinksMap
	controllersBackup := controllers
	binaryRoutesBackup := binaryRoutes
	passhash = []byte("http-bin-test-secret")
	deviceLinks = map[string]*SafeConn{"device-http-bin": deviceConn}
	deviceLinksMap = map[*SafeConn]string{}
	controllers = map[*SafeConn]bool{}
	binaryRoutes = map[string]*BinaryRoute{}
	mu.Unlock()

	t.Cleanup(func() {
		mu.Lock()
		passhash = passhashBackup
		deviceLinks = deviceLinksBackup
		deviceLinksMap = deviceLinksMapBackup
		controllers = controllersBackup
		binaryRoutes = binaryRoutesBackup
		mu.Unlock()
		resetUsedNoncesForTest()
	})

	_ = controllerConn
}

func TestControlHTTPBinWithRequestBodyWritesMetadataBeforeReturning(t *testing.T) {
	requestID := "00112233445566778899aabbccddeeff"
	writeStarted := make(chan struct{}, 1)
	releaseWrite := make(chan struct{})
	writeDone := make(chan struct{}, 4)
	var writesMu sync.Mutex
	writes := make([]recordedWebSocketWrite, 0, 2)

	deviceConn := &SafeConn{
		writeMessageHook: func(messageType int, data []byte) error {
			select {
			case writeStarted <- struct{}{}:
			default:
			}
			<-releaseWrite
			writesMu.Lock()
			writes = append(writes, recordedWebSocketWrite{
				messageType: messageType,
				data:        append([]byte(nil), data...),
			})
			writesMu.Unlock()
			writeDone <- struct{}{}
			return nil
		},
	}
	controllerConn := &SafeConn{}
	setupHTTPBinProxyTestState(t, controllerConn, deviceConn)

	body := map[string]any{
		"devices":   []any{"device-http-bin"},
		"requestId": requestID,
		"method":    "POST",
		"path":      "/api/ui-element/query",
		"query":     map[string]any{},
		"headers":   map[string]any{"Content-Type": "application/json"},
		"bodySize":  17,
		"chunkSize": 65536,
		"timeoutMs": 90000,
	}
	msg := signTestControlMessage(t, "control/http-bin", body, "http-bin-order-1")

	done := make(chan error, 1)
	go func() {
		done <- handleMessage(controllerConn, msg)
	}()

	select {
	case <-writeStarted:
	case <-time.After(time.Second):
		t.Fatalf("metadata write was not started")
	}

	select {
	case err := <-done:
		t.Fatalf("handleMessage returned before metadata write completed: %v", err)
	default:
	}

	close(releaseWrite)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("handleMessage returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for handleMessage")
	}

	handleBinaryMessage(controllerConn, buildTestHTTPBinFrame(t, requestID, 0, 1, []byte(`{"method":"list"}`)))

	for {
		writesMu.Lock()
		writeCount := len(writes)
		writesMu.Unlock()
		if writeCount >= 2 {
			break
		}
		select {
		case <-writeDone:
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for forwarded request body frame")
		}
	}

	writesMu.Lock()
	defer writesMu.Unlock()
	if writes[0].messageType != websocket.TextMessage {
		t.Fatalf("first write should be metadata text frame, got %d", writes[0].messageType)
	}
	var forwarded Message
	if err := json.Unmarshal(writes[0].data, &forwarded); err != nil {
		t.Fatalf("decode forwarded metadata: %v", err)
	}
	if forwarded.Type != "http/request-bin" {
		t.Fatalf("unexpected forwarded metadata type: %s", forwarded.Type)
	}
	if writes[1].messageType != websocket.BinaryMessage {
		t.Fatalf("second write should be request body binary frame, got %d", writes[1].messageType)
	}
}
