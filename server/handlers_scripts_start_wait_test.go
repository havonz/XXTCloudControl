package main

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func resetScriptStartSessionsForTest() {
	scriptStartSessions.Lock()
	scriptStartSessions.seq = 0
	scriptStartSessions.entries = make(map[string]*scriptStartSession)
	scriptStartSessions.Unlock()
}

func scriptStartSessionCountForTest() int {
	scriptStartSessions.Lock()
	defer scriptStartSessions.Unlock()
	return len(scriptStartSessions.entries)
}

func scriptStartStateForTest(deviceID string) (scriptStartState, bool) {
	states := snapshotScriptStartStates([]string{deviceID})
	state, ok := states[deviceID]
	return state, ok
}

func TestPendingScriptStartCompletesAfterAllRequests(t *testing.T) {
	resetScriptStartSessionsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetScriptStartSessionsForTest()
	}()

	payload := []byte(`{"type":"script/run"}`)
	generation, ok := createScriptStartSession(
		"device-1",
		payload,
		true,
		"main.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{
			{requestID: "req-a", targetPath: "a.lua"},
			{requestID: "req-b", targetPath: "b.lua"},
		},
	)
	if !ok {
		t.Fatalf("session create should succeed")
	}

	ready, cancelMsg, handled := completePendingScriptStart("device-1", "req-a", true, "")
	if !handled {
		t.Fatalf("first completion should be handled")
	}
	if cancelMsg != "" {
		t.Fatalf("unexpected cancel message: %s", cancelMsg)
	}
	if ready != nil {
		t.Fatalf("should not be ready before all targets complete")
	}

	ready, cancelMsg, handled = completePendingScriptStart("device-1", "req-b", true, "")
	if !handled {
		t.Fatalf("second completion should be handled")
	}
	if cancelMsg != "" {
		t.Fatalf("unexpected cancel message: %s", cancelMsg)
	}
	if ready == nil {
		t.Fatalf("should be ready after all targets complete")
	}
	if !ready.runPayloadPrepared {
		t.Fatalf("run payload should be marked prepared")
	}
	if ready.runName != "main.lua" {
		t.Fatalf("unexpected run name: %s", ready.runName)
	}
	if ready.generation != generation {
		t.Fatalf("unexpected generation: %d", ready.generation)
	}
	if !bytes.Equal(ready.runPayload, payload) {
		t.Fatalf("unexpected run payload: %s", string(ready.runPayload))
	}
	if count := scriptStartSessionCountForTest(); count != 1 {
		t.Fatalf("session should remain active until launch finishes, got %d", count)
	}
	state, exists := scriptStartStateForTest("device-1")
	if !exists {
		t.Fatalf("state should still exist after all transfers complete")
	}
	if state.Phase != scriptStartPhaseStarting {
		t.Fatalf("expected phase %q, got %q", scriptStartPhaseStarting, state.Phase)
	}
}

func TestPendingScriptStartFailureCancels(t *testing.T) {
	resetScriptStartSessionsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetScriptStartSessionsForTest()
	}()

	if _, ok := createScriptStartSession(
		"device-2",
		[]byte("x"),
		false,
		"fallback.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{
			{requestID: "req-a", targetPath: "a.bin"},
			{requestID: "req-b", targetPath: "b.bin"},
		},
	); !ok {
		t.Fatalf("session create should succeed")
	}

	ready, cancelMsg, handled := completePendingScriptStart("device-2", "req-a", false, "md5 mismatch")
	if !handled {
		t.Fatalf("failure completion should be handled")
	}
	if ready != nil {
		t.Fatalf("failure should not produce ready state")
	}
	if cancelMsg == "" {
		t.Fatalf("failure should return cancel message")
	}
	if !strings.Contains(cancelMsg, "a.bin") {
		t.Fatalf("cancel message should include target path, got %q", cancelMsg)
	}
	if count := scriptStartSessionCountForTest(); count != 0 {
		t.Fatalf("sessions should be cleared after failure, got %d", count)
	}

	ready, cancelMsg, handled = completePendingScriptStart("device-2", "req-b", true, "")
	if handled {
		t.Fatalf("completion after cancel should be ignored")
	}
	if ready != nil || cancelMsg != "" {
		t.Fatalf("completion after cancel should return empty result")
	}
}

func TestPendingScriptStartIgnoresUnknownRequestAndCanBeCleared(t *testing.T) {
	resetScriptStartSessionsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 10 * time.Second
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetScriptStartSessionsForTest()
	}()

	if _, ok := createScriptStartSession(
		"device-3",
		[]byte("x"),
		false,
		"fallback.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{{requestID: "req-only", targetPath: "only.lua"}},
	); !ok {
		t.Fatalf("session create should succeed")
	}

	ready, cancelMsg, handled := completePendingScriptStart("device-3", "req-unknown", true, "")
	if handled {
		t.Fatalf("unknown request should not be handled")
	}
	if ready != nil || cancelMsg != "" {
		t.Fatalf("unknown request should not return result")
	}
	if count := scriptStartSessionCountForTest(); count != 1 {
		t.Fatalf("session should still exist, got %d", count)
	}

	clearPendingScriptStart("device-3")
	if count := scriptStartSessionCountForTest(); count != 0 {
		t.Fatalf("session should be cleared, got %d", count)
	}
}

func TestPendingScriptStartRejectsConcurrentBatchForSameDevice(t *testing.T) {
	resetScriptStartSessionsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetScriptStartSessionsForTest()
	}()

	if _, ok := createScriptStartSession(
		"device-4",
		[]byte("old"),
		true,
		"old.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{{requestID: "req-old", targetPath: "lua/scripts/main.lua"}},
	); !ok {
		t.Fatalf("first create should succeed")
	}
	if _, ok := createScriptStartSession(
		"device-4",
		[]byte("new"),
		true,
		"new.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{{requestID: "req-new", targetPath: "lua/scripts/main.lua"}},
	); ok {
		t.Fatalf("second create should be rejected while previous session is active")
	}

	ready, cancelMsg, handled := completePendingScriptStart("device-4", "req-old", true, "")
	if !handled {
		t.Fatalf("existing batch completion should be handled")
	}
	if cancelMsg != "" {
		t.Fatalf("unexpected cancel message: %s", cancelMsg)
	}
	if ready == nil {
		t.Fatalf("existing batch should be ready after completion")
	}
	if ready.runName != "old.lua" {
		t.Fatalf("expected old run payload, got %s", ready.runName)
	}
}

func TestHandleTransferFetchCompletionForScriptStartLegacyTargetPathFallback(t *testing.T) {
	resetScriptStartSessionsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetScriptStartSessionsForTest()
	}()

	if _, ok := createScriptStartSession(
		"device-5",
		[]byte("x"),
		true,
		"main.lua",
		scriptStartPhaseWaitingTransfer,
		[]pendingScriptFetchRequest{{requestID: "req-1", targetPath: "a.lua"}},
	); !ok {
		t.Fatalf("session create should succeed")
	}

	handleTransferFetchCompletionForScriptStart("device-5", map[string]interface{}{
		"targetPath": "a.lua",
		"success":    true,
	})
	state, exists := scriptStartStateForTest("device-5")
	if !exists {
		t.Fatalf("legacy completion should keep session active until dispatch")
	}
	if state.Phase != scriptStartPhaseStarting {
		t.Fatalf("expected phase %q, got %q", scriptStartPhaseStarting, state.Phase)
	}
}

func TestCancelScriptStartSessionClearsStateAndAllowsRestart(t *testing.T) {
	resetScriptStartSessionsForTest()
	defer resetScriptStartSessionsForTest()

	generation, ok := createScriptStartSession("device-cancel", []byte("x"), true, "main.lua", scriptStartPhasePreparing, nil)
	if !ok {
		t.Fatalf("session create should succeed")
	}

	state, exists := scriptStartStateForTest("device-cancel")
	if !exists {
		t.Fatalf("state should exist before cancel")
	}
	if !state.Active || !state.Cancelable || state.Phase != scriptStartPhasePreparing {
		t.Fatalf("unexpected initial state: %+v", state)
	}

	result := cancelScriptStartSession("device-cancel")
	if !result.Canceled {
		t.Fatalf("cancel should succeed, got %+v", result)
	}
	if _, exists := scriptStartStateForTest("device-cancel"); exists {
		t.Fatalf("state should be cleared after cancel")
	}

	newGeneration, ok := createScriptStartSession("device-cancel", []byte("y"), true, "main.lua", scriptStartPhasePreparing, nil)
	if !ok {
		t.Fatalf("session create should succeed after cancel")
	}
	if newGeneration == generation {
		t.Fatalf("expected new generation after cancel")
	}
}

func TestStartScriptOnDeviceIgnoresCanceledGeneration(t *testing.T) {
	resetScriptStartSessionsForTest()
	defer resetScriptStartSessionsForTest()

	oldGeneration, ok := createScriptStartSession("device-stale-start", nil, false, "", scriptStartPhaseStarting, nil)
	if !ok {
		t.Fatalf("first session create should succeed")
	}
	startScriptOnDevice("device-stale-start", oldGeneration, nil, false, "", 40*time.Millisecond)

	time.Sleep(5 * time.Millisecond)

	result := cancelScriptStartSession("device-stale-start")
	if !result.Canceled {
		t.Fatalf("cancel should succeed")
	}

	newGeneration, ok := createScriptStartSession("device-stale-start", nil, false, "", scriptStartPhaseStarting, nil)
	if !ok {
		t.Fatalf("second session create should succeed")
	}
	if newGeneration == oldGeneration {
		t.Fatalf("expected a new generation")
	}

	time.Sleep(80 * time.Millisecond)

	state, exists := scriptStartStateForTest("device-stale-start")
	if !exists {
		t.Fatalf("newer session should remain active")
	}
	if state.Phase != scriptStartPhaseStarting {
		t.Fatalf("unexpected phase after stale delayed start: %+v", state)
	}
}
