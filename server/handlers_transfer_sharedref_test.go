package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func resetSharedTempRefsForTest() {
	sharedTempRefs.Lock()
	sharedTempRefs.entries = make(map[string]*sharedTempRef)
	sharedTempRefs.Unlock()
}

func waitUntil(timeout time.Duration, interval time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(interval)
	}
}

func TestSharedTempRefReleaseThenRegisterBeforeGraceDoesNotDelete(t *testing.T) {
	resetSharedTempRefsForTest()
	oldGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 40 * time.Millisecond
	defer func() {
		sharedTempCleanupGrace = oldGrace
		resetSharedTempRefsForTest()
	}()

	baseDir := t.TempDir()
	tempDir := filepath.Join(baseDir, "_temp")
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	filePath := filepath.Join(tempDir, "fanout.bin")
	if err := os.WriteFile(filePath, []byte("xxt"), 0o644); err != nil {
		t.Fatalf("write temp file failed: %v", err)
	}

	sharedID := "shared-a"
	registerSharedTempRef(sharedID, filePath)
	releaseSharedTempRef(sharedID)

	time.Sleep(10 * time.Millisecond)
	registerSharedTempRef(sharedID, filePath)

	time.Sleep(80 * time.Millisecond)
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("file should still exist after re-register before grace: %v", err)
	}

	releaseSharedTempRef(sharedID)
	removed := waitUntil(500*time.Millisecond, 20*time.Millisecond, func() bool {
		_, err := os.Stat(filePath)
		return os.IsNotExist(err)
	})
	if !removed {
		t.Fatalf("file should be removed after final release")
	}
}

func TestSharedTempRefNeedsAllReleases(t *testing.T) {
	resetSharedTempRefsForTest()
	oldGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 40 * time.Millisecond
	defer func() {
		sharedTempCleanupGrace = oldGrace
		resetSharedTempRefsForTest()
	}()

	baseDir := t.TempDir()
	tempDir := filepath.Join(baseDir, "_temp")
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	filePath := filepath.Join(tempDir, "multi.bin")
	if err := os.WriteFile(filePath, []byte("xxt"), 0o644); err != nil {
		t.Fatalf("write temp file failed: %v", err)
	}

	sharedID := "shared-b"
	registerSharedTempRef(sharedID, filePath)
	registerSharedTempRef(sharedID, filePath)

	releaseSharedTempRef(sharedID)
	time.Sleep(80 * time.Millisecond)
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("file should not be removed before all refs are released: %v", err)
	}

	releaseSharedTempRef(sharedID)
	removed := waitUntil(500*time.Millisecond, 20*time.Millisecond, func() bool {
		_, err := os.Stat(filePath)
		return os.IsNotExist(err)
	})
	if !removed {
		t.Fatalf("file should be removed after all refs are released")
	}
}
