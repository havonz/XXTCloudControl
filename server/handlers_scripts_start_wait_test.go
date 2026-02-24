package main

import (
	"bytes"
	"strings"
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

func TestPendingScriptStartCompletesAfterAllRequests(t *testing.T) {
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	payload := []byte(`{"type":"script/run"}`)
	if !registerPendingScriptStart("device-1", payload, true, "main.lua", []pendingScriptFetchRequest{
		{requestID: "req-a", targetPath: "a.lua"},
		{requestID: "req-b", targetPath: "b.lua"},
	}) {
		t.Fatalf("register should succeed")
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

	if !registerPendingScriptStart("device-2", []byte("x"), false, "fallback.lua", []pendingScriptFetchRequest{
		{requestID: "req-a", targetPath: "a.bin"},
		{requestID: "req-b", targetPath: "b.bin"},
	}) {
		t.Fatalf("register should succeed")
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
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("pending entries should be cleared after failure, got %d", count)
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
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 10 * time.Second
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	if !registerPendingScriptStart("device-3", []byte("x"), false, "fallback.lua", []pendingScriptFetchRequest{
		{requestID: "req-only", targetPath: "only.lua"},
	}) {
		t.Fatalf("register should succeed")
	}

	ready, cancelMsg, handled := completePendingScriptStart("device-3", "req-unknown", true, "")
	if handled {
		t.Fatalf("unknown request should not be handled")
	}
	if ready != nil || cancelMsg != "" {
		t.Fatalf("unknown request should not return result")
	}
	if count := pendingScriptStartCountForTest(); count != 1 {
		t.Fatalf("pending entry should still exist, got %d", count)
	}

	clearPendingScriptStart("device-3")
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("pending entry should be cleared, got %d", count)
	}
}

func TestPendingScriptStartRejectsConcurrentBatchForSameDevice(t *testing.T) {
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	if !registerPendingScriptStart("device-4", []byte("old"), true, "old.lua", []pendingScriptFetchRequest{
		{requestID: "req-old", targetPath: "lua/scripts/main.lua"},
	}) {
		t.Fatalf("first register should succeed")
	}
	if registerPendingScriptStart("device-4", []byte("new"), true, "new.lua", []pendingScriptFetchRequest{
		{requestID: "req-new", targetPath: "lua/scripts/main.lua"},
	}) {
		t.Fatalf("second register should be rejected while previous batch pending")
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
	resetPendingScriptStartsForTest()
	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	defer func() {
		scriptStartWaitTimeout = oldTimeout
		resetPendingScriptStartsForTest()
	}()

	if !registerPendingScriptStart("device-5", []byte("x"), true, "main.lua", []pendingScriptFetchRequest{
		{requestID: "req-1", targetPath: "a.lua"},
	}) {
		t.Fatalf("register should succeed")
	}

	handleTransferFetchCompletionForScriptStart("device-5", map[string]interface{}{
		"targetPath": "a.lua",
		"success":    true,
	})
	if count := pendingScriptStartCountForTest(); count != 0 {
		t.Fatalf("legacy completion without requestId should still complete by targetPath, got %d", count)
	}
}
