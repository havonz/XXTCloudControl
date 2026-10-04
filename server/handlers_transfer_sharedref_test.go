package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
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
	registerSharedTempRef(sharedID, filePath, 0)
	releaseSharedTempRef(sharedID)

	time.Sleep(10 * time.Millisecond)
	registerSharedTempRef(sharedID, filePath, 0)

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
	registerSharedTempRef(sharedID, filePath, 0)
	registerSharedTempRef(sharedID, filePath, 0)

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

func TestSharedTempRefKeepsSourceUntilLaterBatchesRegister(t *testing.T) {
	resetSharedTempRefsForTest()
	oldGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 10 * time.Millisecond
	t.Cleanup(func() {
		sharedTempCleanupGrace = oldGrace
		resetSharedTempRefsForTest()
	})
	tempDir := filepath.Join(t.TempDir(), "_temp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(tempDir, "queued.bin")
	if err := os.WriteFile(path, []byte("shared payload"), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		registerSharedTempRef("queued-batch", path, 3)
		releaseSharedTempRef("queued-batch")
		if i < 2 {
			time.Sleep(30 * time.Millisecond)
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("source disappeared before all batches registered: %v", err)
			}
		}
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	}) {
		t.Fatal("completed fanout did not clean up its source")
	}
}

func TestSharedTempRefAbandonedBatchExpiresWithoutInterruptingActiveDownload(t *testing.T) {
	resetSharedTempRefsForTest()
	oldGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 10 * time.Millisecond
	t.Cleanup(func() {
		sharedTempCleanupGrace = oldGrace
		resetSharedTempRefsForTest()
	})
	tempDir := filepath.Join(t.TempDir(), "_temp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, active := range []bool{false, true} {
		id := "abandoned"
		if active {
			id = "active"
		}
		path := filepath.Join(tempDir, id+".bin")
		if err := os.WriteFile(path, []byte("shared payload"), 0600); err != nil {
			t.Fatal(err)
		}
		registerSharedTempRef(id, path, 3)
		if !active {
			releaseSharedTempRef(id)
		}
		sharedTempRefs.Lock()
		sharedTempRefs.entries[id].registrationDeadline = time.Now().Add(-time.Second)
		sharedTempRefs.Unlock()
		cleanupExpiredTokens()
		if active {
			time.Sleep(30 * time.Millisecond)
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("active download lost its source: %v", err)
			}
			releaseSharedTempRef(id)
		}
		if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
			_, err := os.Stat(path)
			return os.IsNotExist(err)
		}) {
			t.Fatalf("abandoned source %s was not removed", id)
		}
	}
}

func TestPushToDeviceAccountsForQueuedAndFailedTargets(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	resetTransferTokensForTest()
	resetSharedTempRefsForTest()
	oldGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 10 * time.Millisecond
	t.Cleanup(func() {
		sharedTempCleanupGrace = oldGrace
		resetTransferTokensForTest()
		resetSharedTempRefsForTest()
	})
	path := filepath.Join(dataDir, "files", "_temp", "fanout.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, 128*1024), 0600); err != nil {
		t.Fatal(err)
	}
	setupHTTPBinProxyTestState(t, nil, &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }})
	request := map[string]any{
		"deviceSN": "device-http-bin", "category": "files", "path": "_temp/fanout.bin",
		"targetPath": "/res/fanout.bin", "sharedSourceId": "handler-batch", "sharedSourceTotal": 2,
	}
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", request, pushFileToDeviceHandler)
	if response.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	sharedTempRefs.Lock()
	pending := sharedTempRefs.entries["handler-batch"].pendingRegistrations
	sharedTempRefs.Unlock()
	if pending != 1 {
		t.Fatalf("queued device was not reserved: pending=%d", pending)
	}

	request["deviceSN"] = "offline"
	failed := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", request, pushFileToDeviceHandler)
	if failed.Code != http.StatusBadRequest {
		t.Fatalf("expected offline target to fail: %d", failed.Code)
	}
	sharedTempRefs.Lock()
	entry := sharedTempRefs.entries["handler-batch"]
	pending, active := entry.pendingRegistrations, entry.remaining
	sharedTempRefs.Unlock()
	if pending != 0 || active != 1 {
		t.Fatalf("failed target retained a reservation: pending=%d active=%d", pending, active)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/transfer/download/"+result.Token, nil)
	c.Params = gin.Params{{Key: "token", Value: result.Token}}
	transferDownloadHandler(c)
	if w.Code != http.StatusOK || w.Body.Len() != 128*1024 {
		t.Fatalf("remaining device could not download: status=%d bytes=%d", w.Code, w.Body.Len())
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	}) {
		t.Fatal("completed and failed targets left the source behind")
	}
}
