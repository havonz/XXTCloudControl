package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func setupTempTransferCleanupTest(t *testing.T) string {
	t.Helper()
	dataDir := setupFileHandlersTestDataDir(t)
	resetTransferTokensForTest()
	resetSharedTempRefsForTest()
	previousGrace := sharedTempCleanupGrace
	sharedTempCleanupGrace = 10 * time.Millisecond
	t.Cleanup(func() {
		sharedTempCleanupGrace = previousGrace
		resetTransferTokensForTest()
		resetSharedTempRefsForTest()
	})
	return dataDir
}

func requestTransferDownload(token string, writer http.ResponseWriter) {
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/transfer/download/"+token, nil)
	ctx.Params = gin.Params{{Key: "token", Value: token}}
	transferDownloadHandler(ctx)
}

func TestTemporaryDownloadSourceRemovedOnExpiration(t *testing.T) {
	for _, viaRequest := range []bool{false, true} {
		name := "periodic_cleanup"
		if viaRequest {
			name = "expired_request"
		}
		t.Run(name, func(t *testing.T) {
			dataDir := setupTempTransferCleanupTest(t)
			relativePath := "_temp/upload-expiring/same.bin"
			path := filepath.Join(dataDir, "files", relativePath)
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("payload"), 0644); err != nil {
				t.Fatal(err)
			}
			token := createTransferTokenWithPayload(t, map[string]any{
				"type": "download", "deviceSN": "device-a", "category": "files",
				"path": relativePath, "targetPath": "/res/same.bin",
			})
			transferTokensMu.Lock()
			transferTokens[token].ExpiresAt = time.Now().Add(-time.Second)
			transferTokensMu.Unlock()
			if viaRequest {
				response := httptest.NewRecorder()
				requestTransferDownload(token, response)
				if response.Code != http.StatusGone {
					t.Fatalf("expected expired token rejection, got %d", response.Code)
				}
			} else {
				cleanupExpiredTokens()
			}
			if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
				_, err := os.Stat(filepath.Dir(path))
				return os.IsNotExist(err)
			}) {
				t.Fatal("expired download left its source or isolated directory behind")
			}
			if _, err := os.Stat(filepath.Join(dataDir, "files", "_temp")); err != nil {
				t.Fatal("cleanup removed the shared temp root")
			}
		})
	}
}

func TestSingleDevicePushRegistersSourceForExpirationCleanup(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	path := filepath.Join(dataDir, "files", "_temp", "upload-single", "file.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, 128*1024+1), 0644); err != nil {
		t.Fatal(err)
	}
	setupHTTPBinProxyTestState(t, nil, &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }})
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/push-to-device", map[string]any{
		"deviceSN": "device-http-bin", "category": "files", "path": "_temp/upload-single/file.bin",
		"targetPath": "/res/file.bin",
	}, pushFileToDeviceHandler)
	if response.Code != http.StatusOK {
		t.Fatalf("push failed: %d %s", response.Code, response.Body)
	}
	var result struct{ Token string }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	transferTokensMu.Lock()
	transferTokens[result.Token].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	cleanupExpiredTokens()
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(filepath.Dir(path))
		return os.IsNotExist(err)
	}) {
		t.Fatal("single-device push source was not removed after expiration")
	}
}

func TestTemporarySourceSurvivesUntilAllIndependentTokensFinish(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	relativePath := "_temp/legacy.bin"
	path := filepath.Join(dataDir, "files", relativePath)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("shared payload"), 0644); err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{
		"type": "download", "deviceSN": "device-a", "category": "files", "path": relativePath, "targetPath": "/res/legacy.bin",
	}
	first := createTransferTokenWithPayload(t, payload)
	second := createTransferTokenWithPayload(t, payload)
	transferTokensMu.Lock()
	transferTokens[first].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	cleanupExpiredTokens()
	time.Sleep(30 * time.Millisecond)
	response := httptest.NewRecorder()
	requestTransferDownload(second, response)
	if response.Code != http.StatusOK || response.Body.String() != "shared payload" {
		t.Fatalf("remaining token lost its source: %d %s", response.Code, response.Body)
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	}) {
		t.Fatal("completed source was not removed")
	}
}

type blockedTransferWriter struct {
	*httptest.ResponseRecorder
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *blockedTransferWriter) Write(data []byte) (int, error) {
	w.once.Do(func() {
		close(w.started)
		<-w.release
	})
	return w.ResponseRecorder.Write(data)
}

func TestReusableTempTokenExpirationWaitsForActiveDownload(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	path := filepath.Join(dataDir, "files", "_temp", "active.bin")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("active payload"), 0644); err != nil {
		t.Fatal(err)
	}
	token := createTransferTokenWithPayload(t, map[string]any{
		"type": "download", "deviceSN": "device-a", "category": "files", "path": "_temp/active.bin",
		"targetPath": "/res/active.bin", "oneTime": false,
	})
	writer := &blockedTransferWriter{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(writer.release) })
		<-done
	})
	go func() {
		requestTransferDownload(token, writer)
		close(done)
	}()
	select {
	case <-writer.started:
	case <-time.After(time.Second):
		t.Fatal("download did not start")
	}
	transferTokensMu.Lock()
	transferTokens[token].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	cleanupExpiredTokens()
	time.Sleep(30 * time.Millisecond)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expired token removed an active source: %v", err)
	}
	releaseOnce.Do(func() { close(writer.release) })
	<-done
	if writer.Code != http.StatusOK || writer.Body.String() != "active payload" {
		t.Fatalf("active download failed: %d %s", writer.Code, writer.Body)
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	}) {
		t.Fatal("expired source was not removed after active download ended")
	}
}

func TestExpirationKeepsPermanentFilesAndUploadDestinations(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	for _, item := range []struct{ kind, path string }{{"download", "saved.bin"}, {"upload", "_temp/device-upload.bin"}} {
		path := filepath.Join(dataDir, "files", item.path)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("keep"), 0644); err != nil {
			t.Fatal(err)
		}
		token := createTransferTokenWithPayload(t, map[string]any{
			"type": item.kind, "deviceSN": "device-a", "category": "files", "path": item.path, "targetPath": "/res/saved.bin",
		})
		transferTokensMu.Lock()
		transferTokens[token].ExpiresAt = time.Now().Add(-time.Second)
		transferTokensMu.Unlock()
		cleanupExpiredTokens()
		time.Sleep(30 * time.Millisecond)
		if contents, err := os.ReadFile(path); err != nil || string(contents) != "keep" {
			t.Fatalf("expiration changed %s destination: %q %v", item.kind, contents, err)
		}
	}
}
