package main

import (
	"testing"
	"time"
)

func resetUsedNoncesForTest() {
	usedNonces.Lock()
	usedNonces.store = make(map[string]int64)
	usedNonces.Unlock()
}

func TestCheckAndStoreNonceRejectsReplayWithinTTL(t *testing.T) {
	resetUsedNoncesForTest()

	if ok := checkAndStoreNonce("ws", "nonce-1"); !ok {
		t.Fatalf("first nonce should be accepted")
	}
	if ok := checkAndStoreNonce("ws", "nonce-1"); ok {
		t.Fatalf("replayed nonce within ttl should be rejected")
	}
}

func TestCheckAndStoreNonceAllowsReuseAfterTTL(t *testing.T) {
	resetUsedNoncesForTest()

	now := time.Now().Unix()
	usedNonces.Lock()
	usedNonces.store["http:nonce-2"] = now - nonceTTLSeconds - 1
	usedNonces.Unlock()

	if ok := checkAndStoreNonce("http", "nonce-2"); !ok {
		t.Fatalf("expired nonce should be accepted again")
	}
	if ok := checkAndStoreNonce("http", "nonce-2"); ok {
		t.Fatalf("fresh nonce entry should reject immediate replay")
	}
}

func TestCleanupExpiredNonces(t *testing.T) {
	resetUsedNoncesForTest()

	now := time.Now().Unix()
	usedNonces.Lock()
	usedNonces.store["ws:old"] = now - nonceTTLSeconds - 10
	usedNonces.store["ws:new"] = now
	usedNonces.Unlock()

	removed := cleanupExpiredNonces(now)
	if removed != 1 {
		t.Fatalf("expected 1 removed nonce, got %d", removed)
	}

	usedNonces.Lock()
	_, hasOld := usedNonces.store["ws:old"]
	_, hasNew := usedNonces.store["ws:new"]
	usedNonces.Unlock()

	if hasOld {
		t.Fatalf("expired nonce should be removed")
	}
	if !hasNew {
		t.Fatalf("fresh nonce should be kept")
	}
}
