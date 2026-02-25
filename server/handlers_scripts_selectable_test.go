package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func createSelectableScriptSymlinkOrSkip(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink is not available in this environment: %v", err)
	}
}

func TestSelectableScriptsHandler_IncludesSymlinkedPiledScriptDirectory(t *testing.T) {
	gin.SetMode(gin.TestMode)

	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatalf("mkdir scripts dir failed: %v", err)
	}

	targetDir := filepath.Join(t.TempDir(), "piled-script")
	mainLuaPath := filepath.Join(targetDir, "lua", "scripts", "main.lua")
	if err := os.MkdirAll(filepath.Dir(mainLuaPath), 0o755); err != nil {
		t.Fatalf("mkdir target piled structure failed: %v", err)
	}
	if err := os.WriteFile(mainLuaPath, []byte("print('ok')"), 0o644); err != nil {
		t.Fatalf("write target main.lua failed: %v", err)
	}

	linkName := "linked-piled"
	createSelectableScriptSymlinkOrSkip(t, targetDir, filepath.Join(scriptsDir, linkName))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/scripts/selectable", nil)
	selectableScriptsHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Scripts []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"scripts"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}

	found := false
	for _, script := range resp.Scripts {
		if script.Name == linkName && script.Path == "main.lua" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected symlinked piled script to be selectable, got: %+v", resp.Scripts)
	}
}

func TestSelectableScriptsHandler_IncludesSymlinkedXPPDirectory(t *testing.T) {
	gin.SetMode(gin.TestMode)

	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatalf("mkdir scripts dir failed: %v", err)
	}

	targetDir := filepath.Join(t.TempDir(), "xpp-target")
	if err := os.MkdirAll(filepath.Join(targetDir, "lua"), 0o755); err != nil {
		t.Fatalf("mkdir target directory failed: %v", err)
	}

	linkName := "demo.xpp"
	createSelectableScriptSymlinkOrSkip(t, targetDir, filepath.Join(scriptsDir, linkName))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/scripts/selectable", nil)
	selectableScriptsHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Scripts []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"scripts"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}

	found := false
	for _, script := range resp.Scripts {
		if script.Name == linkName && script.Path == linkName {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected symlinked xpp directory to be selectable, got: %+v", resp.Scripts)
	}
}
