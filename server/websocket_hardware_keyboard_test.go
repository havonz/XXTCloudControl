package main

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHardwareKeyboardOwnerIsKeptUntilDeviceConfirmsDisconnect(t *testing.T) {
	controller := &SafeConn{}
	device := &SafeConn{}
	previous := hardwareKeyboardOwners
	hardwareKeyboardOwners = make(map[*SafeConn]map[string]map[string]bool)
	t.Cleanup(func() {
		hardwareKeyboardOwners = previous
	})

	updateHardwareKeyboardOwnersLocked(
		controller,
		"owner-1",
		"connect",
		[]string{"device-1"},
		map[string]*SafeConn{"device-1": device},
	)
	if !hardwareKeyboardOwners[controller]["owner-1"]["device-1"] {
		t.Fatal("connect should register the controller owner lease")
	}

	updateHardwareKeyboardOwnersLocked(
		controller,
		"owner-1",
		"disconnect",
		[]string{"device-1"},
		map[string]*SafeConn{"device-1": device},
	)
	if !hardwareKeyboardOwners[controller]["owner-1"]["device-1"] {
		t.Fatal("sending disconnect must keep the lease until the device confirms it")
	}

	completeHardwareKeyboardDisconnectLocked("owner-1", "device-1")
	if _, exists := hardwareKeyboardOwners[controller]; exists {
		t.Fatal("confirmed disconnect should remove the lease")
	}
}

func TestParseGlobalHardwareKeyboardBody(t *testing.T) {
	action, owner, err := parseGlobalHardwareKeyboardBody(map[string]interface{}{
		"action": "connect",
		"owner":  "owner-1",
	})
	if err != nil || action != "connect" || owner != "owner-1" {
		t.Fatalf("unexpected parse result: action=%q owner=%q err=%v", action, owner, err)
	}

	if _, _, err := parseGlobalHardwareKeyboardBody(map[string]interface{}{
		"action": "connect",
	}); err == nil {
		t.Fatal("missing owner should be rejected")
	}
}

func TestHardwareKeyboardResponsesAreForwardedInOrder(t *testing.T) {
	device := &SafeConn{}
	controller := &SafeConn{}
	firstWriteStarted := make(chan struct{})
	releaseFirstWrite := make(chan struct{})
	var actionsMu sync.Mutex
	var actions []string
	controller.writeMessageHook = func(messageType int, payload []byte) error {
		if messageType != websocket.TextMessage {
			t.Fatalf("unexpected message type: %d", messageType)
		}
		var message Message
		if err := json.Unmarshal(payload, &message); err != nil {
			return err
		}
		body, _ := message.Body.(map[string]interface{})
		action, _ := body["action"].(string)
		if action == "connect" {
			close(firstWriteStarted)
			<-releaseFirstWrite
		}
		actionsMu.Lock()
		actions = append(actions, action)
		actionsMu.Unlock()
		return nil
	}

	mu.Lock()
	previousControllers := controllers
	previousDeviceLinksMap := deviceLinksMap
	controllers = map[*SafeConn]bool{controller: true}
	deviceLinksMap = map[*SafeConn]string{device: "device-1"}
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		controllers = previousControllers
		deviceLinksMap = previousDeviceLinksMap
		mu.Unlock()
	})

	firstDone := make(chan struct{})
	go func() {
		_ = forwardDeviceMessageToControllers(device, Message{
			Type: "key/global-keyboard",
			Body: map[string]interface{}{
				"action": "connect",
				"owner":  "owner-1",
			},
		})
		close(firstDone)
	}()

	select {
	case <-firstWriteStarted:
	case <-time.After(time.Second):
		t.Fatal("first hardware keyboard response was not written")
	}
	select {
	case <-firstDone:
		t.Fatal("hardware keyboard forwarding returned before the ordered write completed")
	default:
	}
	close(releaseFirstWrite)
	select {
	case <-firstDone:
	case <-time.After(time.Second):
		t.Fatal("first hardware keyboard response did not finish")
	}

	if err := forwardDeviceMessageToControllers(device, Message{
		Type: "key/global-keyboard",
		Body: map[string]interface{}{
			"action": "disconnect",
			"owner":  "owner-1",
		},
	}); err != nil {
		t.Fatalf("forward disconnect: %v", err)
	}

	actionsMu.Lock()
	defer actionsMu.Unlock()
	if len(actions) != 2 || actions[0] != "connect" || actions[1] != "disconnect" {
		t.Fatalf("unexpected response order: %v", actions)
	}
}

func TestHardwareKeyboardControlCommandsAreWrittenInOrder(t *testing.T) {
	resetUsedNoncesForTest()
	device := &SafeConn{}
	controller := &SafeConn{}
	firstWriteStarted := make(chan struct{})
	releaseFirstWrite := make(chan struct{})
	var actionsMu sync.Mutex
	var actions []string
	device.writeMessageHook = func(messageType int, payload []byte) error {
		var message Message
		if err := json.Unmarshal(payload, &message); err != nil {
			return err
		}
		body, _ := message.Body.(map[string]interface{})
		action, _ := body["action"].(string)
		if action == "connect" {
			close(firstWriteStarted)
			<-releaseFirstWrite
		}
		actionsMu.Lock()
		actions = append(actions, action)
		actionsMu.Unlock()
		return nil
	}

	mu.Lock()
	previousPasshash := passhash
	previousDeviceLinks := deviceLinks
	previousControllers := controllers
	previousOwners := hardwareKeyboardOwners
	passhash = []byte("hardware-keyboard-order-test")
	deviceLinks = map[string]*SafeConn{"device-1": device}
	controllers = map[*SafeConn]bool{}
	hardwareKeyboardOwners = make(map[*SafeConn]map[string]map[string]bool)
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		passhash = previousPasshash
		deviceLinks = previousDeviceLinks
		controllers = previousControllers
		hardwareKeyboardOwners = previousOwners
		mu.Unlock()
		resetUsedNoncesForTest()
	})

	command := func(action, nonce string) Message {
		return signTestControlMessage(t, "control/command", map[string]interface{}{
			"devices": []string{"device-1"},
			"type":    "key/global-keyboard",
			"body": map[string]interface{}{
				"action": action,
				"owner":  "owner-1",
			},
		}, nonce)
	}

	firstDone := make(chan error, 1)
	go func() {
		firstDone <- handleMessage(controller, command("connect", "keyboard-connect"))
	}()
	select {
	case <-firstWriteStarted:
	case <-time.After(time.Second):
		t.Fatal("connect command was not written")
	}
	select {
	case err := <-firstDone:
		t.Fatalf("connect handler returned before ordered write completed: %v", err)
	default:
	}
	close(releaseFirstWrite)
	select {
	case err := <-firstDone:
		if err != nil {
			t.Fatalf("connect command: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("connect command did not finish")
	}

	if err := handleMessage(controller, command("disconnect", "keyboard-disconnect")); err != nil {
		t.Fatalf("disconnect command: %v", err)
	}

	actionsMu.Lock()
	defer actionsMu.Unlock()
	if len(actions) != 2 || actions[0] != "connect" || actions[1] != "disconnect" {
		t.Fatalf("unexpected command order: %v", actions)
	}
}
