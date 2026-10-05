package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type interruptedUploadReader struct {
	sent bool
}

func (r *interruptedUploadReader) Read(p []byte) (int, error) {
	if !r.sent {
		r.sent = true
		return copy(p, "partial"), nil
	}
	return 0, errors.New("connection interrupted")
}

func requestTransferUpload(token string, body io.Reader, size int64) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/transfer/upload/"+token, body)
	ctx.Request.ContentLength = size
	ctx.Params = gin.Params{{Key: "token", Value: token}}
	transferUploadHandler(ctx)
	return response
}

func TestInterruptedTransferUploadPreservesDestination(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "new_file"
		if existing {
			name = "existing_file"
		}
		t.Run(name, func(t *testing.T) {
			dataDir, _ := setupTransferTokenCreateTest(t)
			destination := filepath.Join(dataDir, "scripts", "received.bin")
			if existing {
				if err := os.WriteFile(destination, []byte("original"), 0640); err != nil {
					t.Fatal(err)
				}
			}
			token := createTransferTokenWithPayload(t, map[string]any{
				"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "received.bin",
			})
			response := requestTransferUpload(token, &interruptedUploadReader{}, 100)
			if response.Code == http.StatusOK {
				t.Fatal("interrupted upload was reported as successful")
			}
			contents, err := os.ReadFile(destination)
			if existing && (err != nil || string(contents) != "original") {
				t.Fatalf("interrupted upload damaged the original: %q, %v", contents, err)
			}
			if !existing && !os.IsNotExist(err) {
				t.Fatalf("interrupted upload published a partial file: %q, %v", contents, err)
			}
			entries, err := os.ReadDir(filepath.Dir(destination))
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				if entry.Name() != "token.txt" && !(existing && entry.Name() == "received.bin") {
					t.Fatalf("upload left a temporary file: %s", entry.Name())
				}
			}
		})
	}
}

func TestTransferUploadRejectsIncompleteBody(t *testing.T) {
	_, destination := setupTransferTokenCreateTest(t)
	token := createTransferTokenWithPayload(t, map[string]any{
		"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "token.txt",
	})
	response := requestTransferUpload(token, bytes.NewBufferString("short"), 100)
	if response.Code == http.StatusOK {
		t.Fatal("a short body was accepted despite its declared length")
	}
	contents, err := os.ReadFile(destination)
	if err != nil || string(contents) != "token" {
		t.Fatalf("short upload replaced the original: %q, %v", contents, err)
	}
}

type gatedUploadReader struct {
	started chan struct{}
	release chan struct{}
	sent    bool
	rest    *bytes.Reader
}

func (r *gatedUploadReader) Read(p []byte) (int, error) {
	if !r.sent {
		r.sent = true
		return copy(p, "first "), nil
	}
	if r.started != nil {
		close(r.started)
		r.started = nil
		<-r.release
	}
	return r.rest.Read(p)
}

func TestTransferUploadPublishesOnlyCompleteContent(t *testing.T) {
	_, destination := setupTransferTokenCreateTest(t)
	token := createTransferTokenWithPayload(t, map[string]any{
		"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "token.txt",
	})
	started, release := make(chan struct{}), make(chan struct{})
	reader := &gatedUploadReader{started: started, release: release, rest: bytes.NewReader([]byte("last"))}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- requestTransferUpload(token, reader, 10)
		close(done)
	}()
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(release) })
		<-done
	})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("upload did not start")
	}
	contents, err := os.ReadFile(destination)
	if err != nil || string(contents) != "token" {
		t.Fatalf("an in-progress upload exposed partial contents: %q, %v", contents, err)
	}
	if replay := requestTransferUpload(token, bytes.NewReader([]byte("replacement")), 11); replay.Code != http.StatusNotFound {
		t.Fatalf("an in-use one-time token was accepted twice: %d", replay.Code)
	}
	releaseOnce.Do(func() { close(release) })
	response := <-done
	if response.Code != http.StatusOK {
		t.Fatalf("complete upload failed: %d %s", response.Code, response.Body)
	}
	contents, err = os.ReadFile(destination)
	if err != nil || string(contents) != "first last" {
		t.Fatalf("complete contents were not published: %q, %v", contents, err)
	}
}

func TestTransferUploadPreservesLinksAndAcceptsEmptyAndChunkedFiles(t *testing.T) {
	for _, mode := range []string{"existing", "empty", "chunked", "symlink", "dangling_symlink"} {
		t.Run(mode, func(t *testing.T) {
			dataDir, _ := setupTransferTokenCreateTest(t)
			destination := filepath.Join(dataDir, "scripts", "received.bin")
			resolved := destination
			contents := []byte{0, 1, 127, 255}
			if mode == "empty" {
				contents = nil
			}
			if mode == "symlink" || mode == "dangling_symlink" {
				resolved = filepath.Join(t.TempDir(), "linked.bin")
				createSymlinkOrSkip(t, resolved, destination)
			}
			if mode == "existing" || mode == "symlink" {
				if err := os.WriteFile(resolved, []byte("old"), 0640); err != nil {
					t.Fatal(err)
				}
			}
			token := createTransferTokenWithPayload(t, map[string]any{
				"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "received.bin",
			})
			size := int64(len(contents))
			if mode == "chunked" {
				size = -1
			}
			response := requestTransferUpload(token, bytes.NewReader(contents), size)
			if response.Code != http.StatusOK {
				t.Fatalf("upload failed: %d %s", response.Code, response.Body)
			}
			var result struct {
				Bytes int64
				MD5   string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			hash := md5.Sum(contents)
			if result.Bytes != int64(len(contents)) || result.MD5 != hex.EncodeToString(hash[:]) {
				t.Fatalf("upload result does not match contents: %+v", result)
			}
			actual, err := os.ReadFile(resolved)
			if err != nil || !bytes.Equal(actual, contents) {
				t.Fatalf("incorrect destination: %v %v", actual, err)
			}
			info, err := os.Stat(resolved)
			if err != nil {
				t.Fatal(err)
			}
			if (mode == "existing" || mode == "symlink") && info.Mode().Perm() != 0640 {
				t.Fatalf("existing permissions changed: %v", info.Mode())
			}
			if mode == "symlink" || mode == "dangling_symlink" {
				link, err := os.Lstat(destination)
				if err != nil || link.Mode()&os.ModeSymlink == 0 {
					t.Fatal("upload replaced the symbolic link itself")
				}
			}
			leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(resolved), ".xxt-upload-*"))
			if err != nil || len(leftovers) != 0 {
				t.Fatalf("upload left temporary files: %v %v", leftovers, err)
			}
		})
	}
}

func TestCanceledTransferUploadKeepsOriginal(t *testing.T) {
	_, destination := setupTransferTokenCreateTest(t)
	token := createTransferTokenWithPayload(t, map[string]any{
		"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "token.txt",
	})
	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/transfer/upload/"+token, bytes.NewBufferString("replacement")).WithContext(requestContext)
	ctx.Params = gin.Params{{Key: "token", Value: token}}
	transferUploadHandler(ctx)
	contents, err := os.ReadFile(destination)
	if response.Code == http.StatusOK || err != nil || string(contents) != "token" {
		t.Fatalf("canceled upload changed destination: %d %q %v", response.Code, contents, err)
	}
}

func TestConcurrentOneTimeUploadClaimsTokenOnce(t *testing.T) {
	setupTransferTokenCreateTest(t)
	token := createTransferTokenWithPayload(t, map[string]any{
		"type": "upload", "deviceSN": "device-a", "category": "scripts", "path": "token.txt",
	})
	const requests = 24
	ready := make(chan struct{}, requests)
	results := make(chan int, requests)
	transferTokensMu.RLock()
	for index := 0; index < requests; index++ {
		go func() {
			ready <- struct{}{}
			results <- requestTransferUpload(token, bytes.NewBufferString("complete"), 8).Code
		}()
	}
	for index := 0; index < requests; index++ {
		<-ready
	}
	// 旧实现能在读锁期间同时查到令牌，随后各自删除同一个令牌并写入。
	time.Sleep(20 * time.Millisecond)
	transferTokensMu.RUnlock()
	succeeded := 0
	for index := 0; index < requests; index++ {
		status := <-results
		if status == http.StatusOK {
			succeeded++
		} else if status != http.StatusNotFound {
			t.Fatalf("unexpected token response: %d", status)
		}
	}
	if succeeded != 1 {
		t.Fatalf("one-time upload accepted %d concurrent requests", succeeded)
	}
}
