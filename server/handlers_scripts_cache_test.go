package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func resetScriptPackageCacheForTest() {
	scriptPackageCache.Lock()
	scriptPackageCache.entries = make(map[string]scriptPackageCacheEntry)
	scriptPackageCache.Unlock()
}

func decodeBase64ForTest(t *testing.T, encoded string) string {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("failed to decode base64: %v", err)
	}
	return string(data)
}

func TestCollectScriptFilesCachedInvalidatesOnSingleFileChange(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	scriptPath := filepath.Join(rootDir, "main.lua")

	if err := os.WriteFile(scriptPath, []byte("print('v1')"), 0o644); err != nil {
		t.Fatalf("failed to write script v1: %v", err)
	}

	filesV1, err := collectScriptFilesCached(scriptPath, "main.lua", false, false)
	if err != nil {
		t.Fatalf("collect v1 failed: %v", err)
	}
	if len(filesV1) != 1 {
		t.Fatalf("expected 1 file, got %d", len(filesV1))
	}
	if got := decodeBase64ForTest(t, filesV1[0].Data); got != "print('v1')" {
		t.Fatalf("unexpected v1 content: %q", got)
	}

	// Ensure mtime differs on filesystems with coarse timestamp precision.
	time.Sleep(5 * time.Millisecond)
	if err := os.WriteFile(scriptPath, []byte("print('v2')"), 0o644); err != nil {
		t.Fatalf("failed to write script v2: %v", err)
	}

	filesV2, err := collectScriptFilesCached(scriptPath, "main.lua", false, false)
	if err != nil {
		t.Fatalf("collect v2 failed: %v", err)
	}
	if len(filesV2) != 1 {
		t.Fatalf("expected 1 file after update, got %d", len(filesV2))
	}
	if got := decodeBase64ForTest(t, filesV2[0].Data); got != "print('v2')" {
		t.Fatalf("expected updated content, got %q", got)
	}
}

func TestCollectScriptFilesCachedInvalidatesOnDirectoryFileAdd(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	scriptDir := filepath.Join(rootDir, "bundle")
	if err := os.MkdirAll(scriptDir, 0o755); err != nil {
		t.Fatalf("failed to create script dir: %v", err)
	}

	firstFile := filepath.Join(scriptDir, "a.lua")
	if err := os.WriteFile(firstFile, []byte("print('a')"), 0o644); err != nil {
		t.Fatalf("failed to write first file: %v", err)
	}

	files1, err := collectScriptFilesCached(scriptDir, "bundle", true, false)
	if err != nil {
		t.Fatalf("collect first failed: %v", err)
	}
	if len(files1) != 1 {
		t.Fatalf("expected 1 file initially, got %d", len(files1))
	}

	time.Sleep(5 * time.Millisecond)
	secondFile := filepath.Join(scriptDir, "b.lua")
	if err := os.WriteFile(secondFile, []byte("print('b')"), 0o644); err != nil {
		t.Fatalf("failed to write second file: %v", err)
	}

	files2, err := collectScriptFilesCached(scriptDir, "bundle", true, false)
	if err != nil {
		t.Fatalf("collect second failed: %v", err)
	}
	if len(files2) != 2 {
		t.Fatalf("expected 2 files after add, got %d", len(files2))
	}
}
