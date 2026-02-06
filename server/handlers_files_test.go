package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestServerFilesListHandler_MetaParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		t.Fatalf("mkdir scripts dir: %v", err)
	}

	content := []byte("hello")
	filePath := filepath.Join(scriptsDir, "hello.txt")
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	// meta=0 should skip size/modTime
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=0", nil)
		serverFilesListHandler(c)

		if w.Code != http.StatusOK {
			t.Fatalf("unexpected status: %d", w.Code)
		}

		var resp struct {
			Files []ServerFileItem `json:"files"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(resp.Files) != 1 {
			t.Fatalf("expected 1 file, got %d", len(resp.Files))
		}
		if resp.Files[0].Size != 0 {
			t.Fatalf("expected size 0 when meta=0, got %d", resp.Files[0].Size)
		}
		if resp.Files[0].ModTime != "" {
			t.Fatalf("expected empty modTime when meta=0, got %q", resp.Files[0].ModTime)
		}
	}

	// meta=1 should include size/modTime
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=1", nil)
		serverFilesListHandler(c)

		if w.Code != http.StatusOK {
			t.Fatalf("unexpected status: %d", w.Code)
		}

		var resp struct {
			Files []ServerFileItem `json:"files"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(resp.Files) != 1 {
			t.Fatalf("expected 1 file, got %d", len(resp.Files))
		}
		if resp.Files[0].Size != int64(len(content)) {
			t.Fatalf("expected size %d when meta=1, got %d", len(content), resp.Files[0].Size)
		}
		if resp.Files[0].ModTime == "" {
			t.Fatalf("expected modTime when meta=1")
		}
	}
}

func TestServerFilesBatchCopyHandler_CopiesFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	srcDir := filepath.Join(dataDir, "scripts")
	dstDir := filepath.Join(dataDir, "files")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir src dir: %v", err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatalf("mkdir dst dir: %v", err)
	}

	srcFile := filepath.Join(srcDir, "foo.txt")
	content := []byte("copy me")
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("write src file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"foo.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-copy", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchCopyHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	dstFile := filepath.Join(dstDir, "foo.txt")
	copied, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if !bytes.Equal(copied, content) {
		t.Fatalf("copied content mismatch")
	}
}

func TestServerFilesBatchMoveHandler_MovesFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	srcDir := filepath.Join(dataDir, "scripts")
	dstDir := filepath.Join(dataDir, "files")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir src dir: %v", err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatalf("mkdir dst dir: %v", err)
	}

	srcFile := filepath.Join(srcDir, "move.txt")
	content := []byte("move me")
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("write src file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"move.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-move", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchMoveHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	if _, err := os.Stat(srcFile); !os.IsNotExist(err) {
		t.Fatalf("expected source file to be removed")
	}

	dstFile := filepath.Join(dstDir, "move.txt")
	moved, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("read moved file: %v", err)
	}
	if !bytes.Equal(moved, content) {
		t.Fatalf("moved content mismatch")
	}
}
