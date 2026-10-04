package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func waitForWebSocketCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for !condition() {
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatal("timed out waiting for WebSocket state")
		}
	}
}

func receiveWebSocketWrite(t *testing.T, writes <-chan recordedWebSocketWrite) recordedWebSocketWrite {
	t.Helper()
	select {
	case write := <-writes:
		return write
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for WebSocket write")
		return recordedWebSocketWrite{}
	}
}

func waitForWebSocketSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for WebSocket operation")
	}
}

func TestSlowWebSocketDoesNotBlockControlOrHeartbeat(t *testing.T) {
	started := make(chan struct{})
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	slow := &SafeConn{writeMessageHook: func(_ int, _ []byte) error {
		close(started)
		<-blocked
		return nil
	}}
	writes := make(chan recordedWebSocketWrite, 3)
	healthy := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
		writes <- recordedWebSocketWrite{messageType: typ, data: payload}
		return nil
	}}
	controller := &SafeConn{}
	setupHTTPBinProxyTestState(t, controller, healthy)
	mu.Lock()
	deviceLinks["slow-device"] = slow
	previousLife := deviceLife
	deviceLife = map[string]int{"slow-device": 10, "device-http-bin": 10}
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		deviceLife = previousLife
		mu.Unlock()
	})

	writeTextMessageAsync(slow, []byte("blocked"))
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("slow write did not start")
	}
	for i := 0; i < websocketWriteQueueCapacity; i++ {
		writeTextMessageAsync(slow, []byte("pending"))
	}

	command := signTestControlMessage(t, "control/command", map[string]interface{}{
		"devices": []string{"slow-device", "device-http-bin"},
		"type":    "touch/down",
		"body":    map[string]interface{}{"x": 10, "y": 20},
	}, "slow-connection-fanout")
	done := make(chan error, 1)
	go func() {
		err := handleMessage(controller, command)
		sendPingToAllDevices()
		sendStateRequestToAllDevices()
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("control handler: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("slow connection blocked control or heartbeat dispatch")
	}

	for _, expected := range []string{"touch/down", "ping", "app/state"} {
		write := receiveWebSocketWrite(t, writes)
		if expected == "ping" {
			if write.messageType != websocket.PingMessage {
				t.Fatalf("expected heartbeat, got frame type %d", write.messageType)
			}
			continue
		}
		var message Message
		if err := json.Unmarshal(write.data, &message); err != nil || message.Type != expected {
			t.Fatalf("expected %s, got %s (err=%v)", expected, write.data, err)
		}
	}
	if err := slow.WriteMessage(websocket.TextMessage, nil); !errors.Is(err, errWebSocketWriteQueueFull) {
		t.Fatalf("overloaded connection should reject further writes, got %v", err)
	}
}

func TestSlowControllerDoesNotBlockKeyboardResponsesToOtherControllers(t *testing.T) {
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	slow := &SafeConn{writeMessageHook: func(_ int, _ []byte) error {
		<-blocked
		return nil
	}}
	writes := make(chan recordedWebSocketWrite, 2)
	healthy := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
		writes <- recordedWebSocketWrite{messageType: typ, data: payload}
		return nil
	}}
	device := &SafeConn{}
	setupHTTPBinProxyTestState(t, healthy, device)
	mu.Lock()
	controllers = map[*SafeConn]bool{slow: true, healthy: true}
	deviceLinksMap[device] = "device-http-bin"
	mu.Unlock()

	done := make(chan error, 1)
	go func() {
		for _, action := range []string{"connect", "disconnect"} {
			if err := forwardDeviceMessageToControllers(device, Message{
				Type: "key/global-keyboard",
				Body: map[string]interface{}{"action": action, "owner": "owner-1"},
			}); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("slow controller blocked keyboard response forwarding")
	}
	for _, expected := range []string{"connect", "disconnect"} {
		write := receiveWebSocketWrite(t, writes)
		var message Message
		if err := json.Unmarshal(write.data, &message); err != nil {
			t.Fatal(err)
		}
		body := message.Body.(map[string]interface{})
		if message.UDID != "device-http-bin" || body["action"] != expected {
			t.Fatalf("unexpected forwarded response: %+v", message)
		}
	}
}

func TestWebSocketSyncWriteWaitsForQueuedTextAndBinary(t *testing.T) {
	started := make(chan struct{})
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	writes := make(chan recordedWebSocketWrite, 4)
	conn := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
		if string(payload) == "metadata" {
			close(started)
			<-blocked
		}
		writes <- recordedWebSocketWrite{messageType: typ, data: payload}
		return nil
	}}
	writeTextMessageAsync(conn, []byte("metadata"))
	waitForWebSocketSignal(t, started)
	if err := conn.WriteMessagesAsync(websocket.BinaryMessage, [][]byte{[]byte("chunk-0"), []byte("chunk-1")}); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- conn.WriteMessage(websocket.TextMessage, []byte("run")) }()
	waitForWebSocketCondition(t, func() bool {
		conn.mu.Lock()
		defer conn.mu.Unlock()
		return len(conn.writeQueue) == 2
	})
	select {
	case err := <-done:
		t.Fatalf("synchronous write returned before transmission: %v", err)
	default:
	}
	release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("synchronous write did not complete")
	}
	for i, expected := range []string{"metadata", "chunk-0", "chunk-1", "run"} {
		write := receiveWebSocketWrite(t, writes)
		binary := i == 1 || i == 2
		if string(write.data) != expected || (write.messageType == websocket.BinaryMessage) != binary {
			t.Fatalf("frame %d changed or was reordered: %+v", i, write)
		}
	}
}

func TestWebSocketCloseReleasesPendingSynchronousWrites(t *testing.T) {
	for _, overflow := range []bool{false, true} {
		t.Run(fmt.Sprintf("overflow=%t", overflow), func(t *testing.T) {
			started := make(chan struct{})
			blocked := make(chan struct{})
			release := sync.OnceFunc(func() { close(blocked) })
			t.Cleanup(release)
			conn := &SafeConn{writeMessageHook: func(_ int, _ []byte) error {
				close(started)
				<-blocked
				return nil
			}}
			active := make(chan error, 1)
			go func() { active <- conn.WriteMessage(websocket.TextMessage, []byte("active")) }()
			waitForWebSocketSignal(t, started)
			pending := make(chan error, 1)
			go func() { pending <- conn.WriteMessage(websocket.TextMessage, []byte("pending")) }()
			waitForWebSocketCondition(t, func() bool {
				conn.mu.Lock()
				defer conn.mu.Unlock()
				return len(conn.writeQueue) == 1
			})

			wantError := net.ErrClosed
			if overflow {
				wantError = errWebSocketWriteQueueFull
				for i := 1; i < websocketWriteQueueCapacity; i++ {
					writeTextMessageAsync(conn, []byte("pending"))
				}
				if err := conn.WriteMessagesAsync(websocket.TextMessage, [][]byte{nil}); !errors.Is(err, wantError) {
					t.Fatalf("overflow: %v", err)
				}
			} else if err := conn.Close(); err != nil {
				t.Fatal(err)
			}
			for _, done := range []<-chan error{active, pending} {
				select {
				case err := <-done:
					if !errors.Is(err, wantError) {
						t.Fatalf("expected %v, got %v", wantError, err)
					}
				case <-time.After(time.Second):
					t.Fatal("closed connection left a writer waiting")
				}
			}
			conn.mu.Lock()
			retained := len(conn.writeQueue)
			conn.mu.Unlock()
			if retained != 0 {
				t.Fatalf("closed connection retained %d writes", retained)
			}
		})
	}
}

func TestScriptFileBurstPreservesEveryFileBeforeRun(t *testing.T) {
	const fileCount = websocketWriteQueueCapacity + 100
	files := make([]scriptFileData, fileCount)
	for i := range files {
		files[i] = scriptFileData{
			Path: fmt.Sprintf("lua/scripts/%d.lua", i),
			Data: base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("print(%d)", i))),
		}
	}
	started := make(chan struct{})
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	first := sync.Once{}
	writes := make(chan recordedWebSocketWrite, fileCount+1)
	conn := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
		first.Do(func() {
			close(started)
			<-blocked
		})
		writes <- recordedWebSocketWrite{messageType: typ, data: payload}
		return nil
	}}
	sender := newScriptFileSender(files, nil)
	sender.sendSmallFilesToConn(conn, "device-burst")
	waitForWebSocketSignal(t, started)
	done := make(chan error, 1)
	go func() { done <- sendMessage(conn, Message{Type: "script/run"}) }()
	release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("file burst did not finish")
	}
	for i := 0; i < fileCount; i++ {
		write := receiveWebSocketWrite(t, writes)
		var message Message
		if err := json.Unmarshal(write.data, &message); err != nil {
			t.Fatal(err)
		}
		body := message.Body.(map[string]interface{})
		if message.Type != "file/put" || body["path"] != files[i].Path || body["data"] != files[i].Data {
			t.Fatalf("file %d changed or was reordered: %+v", i, message)
		}
	}
	var run Message
	if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &run); err != nil || run.Type != "script/run" {
		t.Fatalf("run command was not last: %+v, %v", run, err)
	}
}

func TestCanceledScriptStartIsSkippedAfterQueuedFiles(t *testing.T) {
	started := make(chan struct{})
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	writes := make(chan recordedWebSocketWrite, 3)
	conn := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
		if string(payload) == "file" {
			close(started)
			<-blocked
		}
		writes <- recordedWebSocketWrite{messageType: typ, data: payload}
		return nil
	}}
	setupHTTPBinProxyTestState(t, nil, conn)
	const udid = "canceled-queued-start"
	mu.Lock()
	deviceLinks[udid] = conn
	mu.Unlock()
	t.Cleanup(func() { clearScriptStartSession(udid) })
	writeTextMessageAsync(conn, []byte("file"))
	waitForWebSocketSignal(t, started)
	generation, ok := createScriptStartSession(udid, nil, false, "main.lua", scriptStartPhaseStarting, nil)
	if !ok {
		t.Fatal("could not create script start session")
	}
	startScriptOnDevice(udid, generation, nil, false, "main.lua", 0)
	waitForWebSocketCondition(t, func() bool {
		conn.mu.Lock()
		defer conn.mu.Unlock()
		return len(conn.writeQueue) == 1
	})
	if result := cancelScriptStartSession(udid); !result.Canceled {
		t.Fatalf("queued script start was not cancelable: %+v", result)
	}
	release()
	if err := conn.WriteMessage(websocket.TextMessage, []byte("after-cancel")); err != nil {
		t.Fatalf("canceling one command closed the connection: %v", err)
	}
	for _, expected := range []string{"file", "after-cancel"} {
		if write := receiveWebSocketWrite(t, writes); string(write.data) != expected {
			t.Fatalf("canceled script was sent: %s", write.data)
		}
	}
}

type stalledWebSocketNetConn struct {
	net.Conn
	mu       sync.Mutex
	stalled  bool
	deadline time.Time
	closed   chan struct{}
	once     sync.Once
}

func (conn *stalledWebSocketNetConn) SetWriteDeadline(deadline time.Time) error {
	conn.mu.Lock()
	conn.deadline = deadline
	conn.mu.Unlock()
	return conn.Conn.SetWriteDeadline(deadline)
}

func (conn *stalledWebSocketNetConn) Write(data []byte) (int, error) {
	conn.mu.Lock()
	stalled, deadline := conn.stalled, conn.deadline
	conn.mu.Unlock()
	if !stalled {
		return conn.Conn.Write(data)
	}
	if deadline.IsZero() {
		<-conn.closed
		return 0, net.ErrClosed
	}
	return 0, os.ErrDeadlineExceeded
}

func (conn *stalledWebSocketNetConn) Close() error {
	conn.once.Do(func() { close(conn.closed) })
	return conn.Conn.Close()
}

func TestWebSocketWriteTimeoutClosesTransport(t *testing.T) {
	accepted := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			accepted <- conn
		}
	}))
	t.Cleanup(server.Close)
	var transport *stalledWebSocketNetConn
	dialer := websocket.Dialer{NetDial: func(network, address string) (net.Conn, error) {
		conn, err := net.Dial(network, address)
		if err != nil {
			return nil, err
		}
		transport = &stalledWebSocketNetConn{Conn: conn, closed: make(chan struct{})}
		return transport, nil
	}}
	client, _, err := dialer.Dial("ws"+server.URL[len("http"):], nil)
	if err != nil {
		t.Fatal(err)
	}
	conn := &SafeConn{conn: client}
	t.Cleanup(func() { _ = conn.Close() })
	peer := <-accepted
	t.Cleanup(func() { _ = peer.Close() })
	transport.mu.Lock()
	transport.stalled = true
	transport.mu.Unlock()
	started := time.Now()
	done := make(chan error, 1)
	go func() { done <- conn.WriteMessage(websocket.TextMessage, []byte("blocked")) }()
	select {
	case err := <-done:
		var timeout net.Error
		if !errors.As(err, &timeout) || !timeout.Timeout() {
			t.Fatalf("expected write timeout, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("write without a deadline remained blocked")
	}
	transport.mu.Lock()
	deadline := transport.deadline
	transport.mu.Unlock()
	if deadline.Before(started) || deadline.After(started.Add(websocketWriteTimeout+time.Second)) {
		t.Fatalf("unexpected write deadline: %v", deadline)
	}
	_ = peer.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := peer.ReadMessage(); err == nil {
		t.Fatal("timed-out connection remained open")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatal("peer was not disconnected after the write failed")
	}
	var timeout net.Error
	if err := conn.WriteMessage(websocket.TextMessage, nil); !errors.As(err, &timeout) || !timeout.Timeout() {
		t.Fatalf("failed connection accepted another write: %v", err)
	}
}

func TestWebSocketQueueOverflowCleansUpRegisteredDevice(t *testing.T) {
	setupHTTPBinProxyTestState(t, nil, nil)
	mu.Lock()
	previousTable, previousLife := deviceTable, deviceLife
	deviceTable = make(map[string]interface{})
	deviceLife = make(map[string]int)
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		deviceTable, deviceLife = previousTable, previousLife
		mu.Unlock()
	})
	handlerDone := make(chan struct{})
	router := gin.New()
	router.GET("/ws", func(c *gin.Context) {
		defer close(handlerDone)
		handleWebSocketConnection(c)
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+server.URL[len("http"):]+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = client.Close()
		select {
		case <-handlerDone:
		case <-time.After(time.Second):
			t.Error("WebSocket reader did not finish cleanup")
		}
	})
	const udid = "write-overflow-device"
	if err := client.WriteJSON(Message{Type: "app/state", Body: map[string]interface{}{
		"system": map[string]interface{}{"udid": udid},
	}}); err != nil {
		t.Fatal(err)
	}
	var conn *SafeConn
	waitForWebSocketCondition(t, func() bool {
		mu.RLock()
		conn = deviceLinks[udid]
		mu.RUnlock()
		return conn != nil
	})
	started := make(chan struct{})
	blocked := make(chan struct{})
	release := sync.OnceFunc(func() { close(blocked) })
	t.Cleanup(release)
	conn.writeMessageHook = func(_ int, _ []byte) error {
		close(started)
		<-blocked
		return nil
	}
	writeTextMessageAsync(conn, []byte("blocked"))
	waitForWebSocketSignal(t, started)
	for i := 0; i <= websocketWriteQueueCapacity; i++ {
		writeTextMessageAsync(conn, []byte("pending"))
	}
	select {
	case <-handlerDone:
	case <-time.After(time.Second):
		t.Fatal("queue overflow did not unblock the device reader")
	}
	mu.RLock()
	_, hasLink := deviceLinks[udid]
	_, hasReverseLink := deviceLinksMap[conn]
	_, hasState := deviceTable[udid]
	_, hasLife := deviceLife[udid]
	mu.RUnlock()
	if hasLink || hasReverseLink || hasState || hasLife {
		t.Fatalf("device state was retained: link=%t reverse=%t state=%t life=%t", hasLink, hasReverseLink, hasState, hasLife)
	}
}
