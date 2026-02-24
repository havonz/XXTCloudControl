package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func resetMD5Cache() {
	md5Cache.Lock()
	md5Cache.entries = make(map[string]md5CacheEntry)
	md5Cache.Unlock()
}

func TestCalculateFileMD5Cached_UpdatesOnChange(t *testing.T) {
	resetMD5Cache()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "hash.txt")
	if err := os.WriteFile(filePath, []byte("abc"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	info1, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("stat file: %v", err)
	}

	hash1, err := calculateFileMD5Cached(filePath, info1)
	if err != nil {
		t.Fatalf("hash file: %v", err)
	}

	hash1b, err := calculateFileMD5Cached(filePath, info1)
	if err != nil {
		t.Fatalf("hash file again: %v", err)
	}
	if hash1 != hash1b {
		t.Fatalf("expected cached hash to match, got %s vs %s", hash1, hash1b)
	}

	// Modify content (same size) and force mtime forward.
	if err := os.WriteFile(filePath, []byte("abd"), 0644); err != nil {
		t.Fatalf("rewrite file: %v", err)
	}
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(filePath, future, future); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	info2, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("stat file after update: %v", err)
	}

	hash2, err := calculateFileMD5Cached(filePath, info2)
	if err != nil {
		t.Fatalf("hash updated file: %v", err)
	}
	if hash2 == hash1 {
		t.Fatalf("expected hash to change after file update")
	}
}

func resetTransferTokensForTest() {
	transferTokensMu.Lock()
	transferTokens = make(map[string]*TransferToken)
	transferTokensMu.Unlock()
}

func setupTransferTokenCreateTest(t *testing.T) (dataDir string, filePath string) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	resetTransferTokensForTest()
	t.Cleanup(resetTransferTokensForTest)

	dataDir = t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatalf("mkdir scripts dir failed: %v", err)
	}

	filePath = filepath.Join(scriptsDir, "token.txt")
	if err := os.WriteFile(filePath, []byte("token"), 0o644); err != nil {
		t.Fatalf("write token file failed: %v", err)
	}

	return dataDir, filePath
}

func createTransferTokenWithPayload(t *testing.T, payload map[string]any) string {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload failed: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/transfer/create-token", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	createTransferTokenHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("create token status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode create token response failed: %v", err)
	}
	if resp.Token == "" {
		t.Fatalf("expected token in response")
	}
	return resp.Token
}

func tokenOneTimeValue(t *testing.T, token string) bool {
	t.Helper()

	transferTokensMu.RLock()
	defer transferTokensMu.RUnlock()

	info, ok := transferTokens[token]
	if !ok {
		t.Fatalf("token not found in storage: %s", token)
	}
	return info.OneTime
}

func TestCreateTransferToken_DefaultOneTimeTrue(t *testing.T) {
	setupTransferTokenCreateTest(t)

	token := createTransferTokenWithPayload(t, map[string]any{
		"type":       "download",
		"deviceSN":   "device-1",
		"category":   "scripts",
		"path":       "token.txt",
		"targetPath": "/tmp/token.txt",
		// intentionally omit oneTime
	})

	if !tokenOneTimeValue(t, token) {
		t.Fatalf("expected omitted oneTime to default to true")
	}
}

func TestCreateTransferToken_ExplicitOneTimeFalse(t *testing.T) {
	setupTransferTokenCreateTest(t)

	token := createTransferTokenWithPayload(t, map[string]any{
		"type":       "download",
		"deviceSN":   "device-1",
		"category":   "scripts",
		"path":       "token.txt",
		"targetPath": "/tmp/token.txt",
		"oneTime":    false,
	})

	if tokenOneTimeValue(t, token) {
		t.Fatalf("expected explicit oneTime=false to be kept")
	}
}

func TestCreateTransferToken_ExplicitOneTimeTrue(t *testing.T) {
	setupTransferTokenCreateTest(t)

	token := createTransferTokenWithPayload(t, map[string]any{
		"type":       "download",
		"deviceSN":   "device-1",
		"category":   "scripts",
		"path":       "token.txt",
		"targetPath": "/tmp/token.txt",
		"oneTime":    true,
	})

	if !tokenOneTimeValue(t, token) {
		t.Fatalf("expected explicit oneTime=true to be kept")
	}
}

func TestTransferDownloadHandler_DoesNotCompletePendingScriptStartOnHTTPCopy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetTransferTokensForTest()
	resetPendingScriptStartsForTest()
	t.Cleanup(resetTransferTokensForTest)
	t.Cleanup(resetPendingScriptStartsForTest)

	oldTimeout := scriptStartWaitTimeout
	scriptStartWaitTimeout = 0
	t.Cleanup(func() {
		scriptStartWaitTimeout = oldTimeout
	})

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "payload.bin")
	if err := os.WriteFile(filePath, []byte("payload"), 0o644); err != nil {
		t.Fatalf("write payload failed: %v", err)
	}

	const (
		token      = "download-token"
		deviceSN   = "device-1"
		targetPath = "lua/scripts/payload.bin"
	)

	transferTokensMu.Lock()
	transferTokens[token] = &TransferToken{
		Type:       "download",
		FilePath:   filePath,
		TargetPath: targetPath,
		DeviceSN:   deviceSN,
		ExpiresAt:  time.Now().Add(1 * time.Minute),
		OneTime:    false,
	}
	transferTokensMu.Unlock()

	if !registerPendingScriptStart(deviceSN, []byte(`{"type":"script/run"}`), true, "main.lua", []pendingScriptFetchRequest{
		{requestID: "req-http-copy", targetPath: targetPath},
	}) {
		t.Fatalf("register should succeed")
	}
	if count := pendingScriptStartCountForTest(); count != 1 {
		t.Fatalf("expected 1 pending entry before HTTP download, got %d", count)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "token", Value: token}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/transfer/download/"+token, nil)
	transferDownloadHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}
	if count := pendingScriptStartCountForTest(); count != 1 {
		t.Fatalf("pending script start should not be completed by HTTP copy, got %d", count)
	}
}

func TestNormalizeTransferTimeoutSeconds_DefaultValue(t *testing.T) {
	got := normalizeTransferTimeoutSeconds(0)
	if got != defaultTransferTimeoutSec {
		t.Fatalf("expected default timeout %d, got %d", defaultTransferTimeoutSec, got)
	}
}

func TestNormalizeTransferTimeoutSeconds_KeepRequestedValue(t *testing.T) {
	const requested = 3600
	got := normalizeTransferTimeoutSeconds(requested)
	if got != requested {
		t.Fatalf("expected requested timeout %d, got %d", requested, got)
	}
}

func TestTransferTokenTTLForTimeout(t *testing.T) {
	if got := transferTokenTTLForTimeout(30); got != defaultTransferTokenTTL {
		t.Fatalf("expected minimum token ttl %s, got %s", defaultTransferTokenTTL, got)
	}

	timeout := 3600
	expected := time.Duration(timeout)*time.Second + transferTokenTTLGrace
	if got := transferTokenTTLForTimeout(timeout); got != expected {
		t.Fatalf("expected ttl %s, got %s", expected, got)
	}
}

func TestProgressWriter_TouchWriteCalled(t *testing.T) {
	var touched int32
	pw := &ProgressWriter{
		w: bytes.NewBuffer(nil),
		touchWrite: func() {
			atomic.AddInt32(&touched, 1)
		},
	}

	if _, err := pw.Write([]byte("abc")); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	if got := atomic.LoadInt32(&touched); got != 1 {
		t.Fatalf("expected touchWrite called once, got %d", got)
	}
}

func TestProgressReader_TouchReadCalled(t *testing.T) {
	var touched int32
	pr := &ProgressReader{
		r: bytes.NewBufferString("abc"),
		touchRead: func() {
			atomic.AddInt32(&touched, 1)
		},
	}

	buf := make([]byte, 4)
	n, err := pr.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("read failed: %v", err)
	}
	if n == 0 {
		t.Fatalf("expected to read bytes")
	}
	if got := atomic.LoadInt32(&touched); got != 1 {
		t.Fatalf("expected touchRead called once, got %d", got)
	}
}
