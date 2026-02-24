package main

import (
	"bytes"
	"testing"
	"time"
)

func resetPendingScriptStartsForTest() {
	pendingScriptStarts.Lock()
	pendingScriptStarts.seq = 0
	pendingScriptStarts.entries = make(map[string]*pendingScriptStart)
	pendingScriptStarts.Unlock()
}

func pendingScriptStartCountForTest() int {
	pendingScriptStarts.Lock()
	defer pendingScriptStarts.Unlock()
	return len(pendingScriptStarts.entries)
}

func TestPendingScriptStartCompletesAfterAllTargets(t *testing.T) {
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	payload := []byte(`{"type":"script/run"}`)
	registerPendingScriptStart("device-1", payload, true, "main.lua", []string{"a.lua", "b.lua", "a.lua"})

	ready, cancelMsg, handled := completePendingScriptStart("device-1", "a.lua", true, "")
	if !handled {
		t.Fatalf("first completion should be handled")
	}
	if cancelMsg != "" {
		t.Fatalf("unexpected cancel message: %s", cancelMsg)
	}
	if ready != nil {
		t.Fatalf("should not be ready before all targets complete")
	}

	ready, cancelMsg, handled = completePendingScriptStart("device-1", "b.lua", true, "")
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
	if !bytes.Equal(ready.runPayload, payload) {
		t.Fatalf("unexpected run payload: %s", string(ready.runPayload))
	}
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("pending entries should be cleared, got %d", count)
	}
}

func TestPendingScriptStartFailureCancels(t *testing.T) {
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	registerPendingScriptStart("device-2", []byte("x"), false, "fallback.lua", []string{"a.bin", "b.bin"})

	ready, cancelMsg, handled := completePendingScriptStart("device-2", "a.bin", false, "md5 mismatch")
	if !handled {
		t.Fatalf("failure completion should be handled")
	}
	if ready != nil {
		t.Fatalf("failure should not produce ready state")
	}
	if cancelMsg == "" {
		t.Fatalf("failure should return cancel message")
	}
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("pending entries should be cleared after failure, got %d", count)
	}

	ready, cancelMsg, handled = completePendingScriptStart("device-2", "b.bin", true, "")
	if handled {
		t.Fatalf("completion after cancel should be ignored")
	}
	if ready != nil || cancelMsg != "" {
		t.Fatalf("completion after cancel should return empty result")
	}
}

func TestPendingScriptStartIgnoresUnknownTargetAndCanBeCleared(t *testing.T) {
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 10 * time.Second
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	registerPendingScriptStart("device-3", []byte("x"), false, "fallback.lua", []string{"only.lua"})

	ready, cancelMsg, handled := completePendingScriptStart("device-3", "unknown.lua", true, "")
	if handled {
		t.Fatalf("unknown target should not be handled")
	}
	if ready != nil || cancelMsg != "" {
		t.Fatalf("unknown target should not return result")
	}
	if count := pendingScriptStartCountForTest(); count != 1 {
		t.Fatalf("pending entry should still exist, got %d", count)
	}

	clearPendingScriptStart("device-3")
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("pending entry should be cleared, got %d", count)
	}
}
