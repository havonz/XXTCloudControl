package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type browserDownloadTokens struct {
	Token         string `json:"token"`
	DownloadToken string `json:"downloadToken"`
}

func startBrowserDownloadForTest(t *testing.T, path string) browserDownloadTokens {
	t.Helper()
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
		"deviceSN": "device-http-bin", "sourcePath": "/res/source.bin", "category": "files", "path": path, "temporary": true,
	}, pullFileFromDeviceHandler)
	if response.Code != http.StatusOK {
		t.Fatalf("initiate browser download: %d %s", response.Code, response.Body)
	}
	var result browserDownloadTokens
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Token == "" || result.DownloadToken == "" || result.Token == result.DownloadToken {
		t.Fatalf("missing distinct upload/download tokens: %+v", result)
	}
	return result
}

func TestBrowserDownloadExpiresAfterDeviceUpload(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })
	path := "_temp/download-browser/payload"
	tokens := startBrowserDownloadForTest(t, path)
	response := requestTransferUpload(tokens.Token, bytes.NewBufferString("device file"), 11)
	if response.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", response.Code, response.Body)
	}
	transferTokensMu.Lock()
	_, uploadExists := transferTokens[tokens.Token]
	transferTokens[tokens.DownloadToken].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	if uploadExists {
		t.Fatal("one-time upload token was retained")
	}
	cleanupExpiredTokens()
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(filepath.Dir(filepath.Join(dataDir, "files", path)))
		return os.IsNotExist(err)
	}) {
		t.Fatal("abandoned browser download left its file or directory behind")
	}
}

func TestBrowserDownloadWaitsForUploadAndRemovesCompletedFile(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })
	path := "_temp/download-ready/payload"
	tokens := startBrowserDownloadForTest(t, path)
	early := httptest.NewRecorder()
	requestTransferDownload(tokens.DownloadToken, early)
	if early.Code != http.StatusConflict {
		t.Fatalf("pending browser download: %d %s", early.Code, early.Body)
	}
	if response := requestTransferUpload(tokens.Token, bytes.NewBufferString("ready"), 5); response.Code != http.StatusOK {
		t.Fatal("device upload failed")
	}
	response := httptest.NewRecorder()
	requestTransferDownload(tokens.DownloadToken, response)
	if response.Code != http.StatusOK || response.Body.String() != "ready" {
		t.Fatalf("browser download: %d %s", response.Code, response.Body)
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
		_, err := os.Stat(filepath.Dir(filepath.Join(dataDir, "files", path)))
		return os.IsNotExist(err)
	}) {
		t.Fatal("completed browser download was not cleaned up")
	}
}

func TestBrowserDownloadExpirationWaitsForActiveUpload(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })
	path := "_temp/download-uploading/payload"
	tokens := startBrowserDownloadForTest(t, path)
	started, release := make(chan struct{}), make(chan struct{})
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- requestTransferUpload(tokens.Token, &gatedUploadReader{started: started, release: release, rest: bytes.NewReader([]byte("last"))}, 10)
		close(done)
	}()
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); <-done })
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("upload did not start")
	}
	transferTokensMu.Lock()
	transferTokens[tokens.DownloadToken].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	cleanupExpiredTokens()
	time.Sleep(30 * time.Millisecond)
	directory := filepath.Dir(filepath.Join(dataDir, "files", path))
	if _, err := os.Stat(directory); err != nil {
		t.Fatalf("expiration removed an active upload directory: %v", err)
	}
	releaseOnce.Do(func() { close(release) })
	response := <-done
	if response.Code != http.StatusOK {
		t.Fatalf("active upload failed: %d %s", response.Code, response.Body)
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool { _, err := os.Stat(directory); return os.IsNotExist(err) }) {
		t.Fatal("expired browser file remained after its upload ended")
	}
}

func TestBrowserDownloadKeepsSourceDuringBrowserRead(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })
	path := "_temp/download-reading/payload"
	tokens := startBrowserDownloadForTest(t, path)
	if response := requestTransferUpload(tokens.Token, bytes.NewBufferString("content"), 7); response.Code != http.StatusOK {
		t.Fatal("upload failed")
	}
	writer := &blockedTransferWriter{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() { requestTransferDownload(tokens.DownloadToken, writer); close(done) }()
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(writer.release) }); <-done })
	select {
	case <-writer.started:
	case <-time.After(time.Second):
		t.Fatal("browser read did not start")
	}
	cleanupExpiredTokens()
	time.Sleep(30 * time.Millisecond)
	source := filepath.Join(dataDir, "files", path)
	if contents, err := os.ReadFile(source); err != nil || string(contents) != "content" {
		t.Fatalf("active read lost its source: %q %v", contents, err)
	}
	releaseOnce.Do(func() { close(writer.release) })
	<-done
	if writer.Code != http.StatusOK || writer.Body.String() != "content" {
		t.Fatal("browser read was corrupted")
	}
	if !waitUntil(time.Second, 5*time.Millisecond, func() bool { _, err := os.Stat(filepath.Dir(source)); return os.IsNotExist(err) }) {
		t.Fatal("browser read left its source behind")
	}
}

func TestBrowserDownloadFailureAndUnusedTokensRemoveOwnDirectory(t *testing.T) {
	for _, mode := range []string{"upload_failure", "expired_request", "unused", "offline"} {
		t.Run(mode, func(t *testing.T) {
			dataDir := setupTempTransferCleanupTest(t)
			device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
			setupHTTPBinProxyTestState(t, nil, device)
			t.Cleanup(func() { _ = device.Close() })
			path := "_temp/download-abandoned/payload"
			if mode == "offline" {
				response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
					"deviceSN": "offline", "sourcePath": "/res/source.bin", "category": "files", "path": path, "temporary": true,
				}, pullFileFromDeviceHandler)
				if response.Code != http.StatusBadRequest {
					t.Fatalf("offline response: %d", response.Code)
				}
			} else {
				tokens := startBrowserDownloadForTest(t, path)
				if mode == "upload_failure" {
					if response := requestTransferUpload(tokens.Token, &interruptedUploadReader{}, 100); response.Code == http.StatusOK {
						t.Fatal("broken upload succeeded")
					}
				} else {
					transferTokensMu.Lock()
					transferTokens[tokens.Token].ExpiresAt = time.Now().Add(-time.Second)
					transferTokens[tokens.DownloadToken].ExpiresAt = time.Now().Add(-time.Second)
					transferTokensMu.Unlock()
					if mode == "expired_request" {
						if response := requestTransferUpload(tokens.Token, bytes.NewBufferString("late"), 4); response.Code != http.StatusGone {
							t.Fatal("expired upload was accepted")
						}
					}
					cleanupExpiredTokens()
				}
			}
			if !waitUntil(time.Second, 5*time.Millisecond, func() bool {
				_, err := os.Stat(filepath.Dir(filepath.Join(dataDir, "files", path)))
				return os.IsNotExist(err)
			}) {
				t.Fatal("failed or abandoned transfer left its directory behind")
			}
			if _, err := os.Stat(filepath.Join(dataDir, "files", "_temp")); err != nil {
				t.Fatal("shared temporary root was removed")
			}
			transferTokensMu.RLock()
			remaining := len(transferTokens)
			transferTokensMu.RUnlock()
			if remaining != 0 {
				t.Fatalf("leftover transfer tokens: %d", remaining)
			}
		})
	}
}

func TestBrowserDownloadNeverClaimsExistingOrPermanentFiles(t *testing.T) {
	dataDir := setupTempTransferCleanupTest(t)
	device := &SafeConn{writeMessageHook: func(_ int, _ []byte) error { return nil }}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })
	existing := filepath.Join(dataDir, "files", "_temp", "download-existing", "payload")
	if err := os.MkdirAll(filepath.Dir(existing), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(existing, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		category, path string
		status         int
	}{
		{"files", "_temp/download-existing/payload", http.StatusConflict},
		{"scripts", "_temp/download-existing/payload", http.StatusBadRequest},
		{"files", "saved.bin", http.StatusBadRequest},
		{"files", "_temp/upload-unrelated/payload", http.StatusBadRequest},
		{"files", "_temp/download-other/../payload", http.StatusBadRequest},
	} {
		response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
			"deviceSN": "device-http-bin", "sourcePath": "/res/source.bin", "category": item.category, "path": item.path, "temporary": true,
		}, pullFileFromDeviceHandler)
		if response.Code != item.status {
			t.Fatalf("%s/%s: %d %s", item.category, item.path, response.Code, response.Body)
		}
	}
	cleanupExpiredTokens()
	if contents, err := os.ReadFile(existing); err != nil || string(contents) != "keep" {
		t.Fatal("existing destination was changed")
	}
	path := "_temp/download-permanent/payload"
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/transfer/pull-from-device", map[string]any{
		"deviceSN": "device-http-bin", "sourcePath": "/res/source.bin", "category": "files", "path": path,
	}, pullFileFromDeviceHandler)
	var result browserDownloadTokens
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("ordinary pull failed")
	}
	if result.DownloadToken != "" {
		t.Fatal("ordinary pull was assigned an automatic cleanup token")
	}
	if response := requestTransferUpload(result.Token, bytes.NewBufferString("permanent"), 9); response.Code != http.StatusOK {
		t.Fatal("ordinary upload failed")
	}
	cleanupExpiredTokens()
	time.Sleep(30 * time.Millisecond)
	if contents, err := os.ReadFile(filepath.Join(dataDir, "files", path)); err != nil || string(contents) != "permanent" {
		t.Fatal("ordinary uploaded file was removed")
	}
}
