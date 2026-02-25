package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
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

func createScriptSymlinkOrSkip(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink is not available in this environment: %v", err)
	}
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

func TestCollectScriptFilesCached_SkipNestedDirectorySymlinkAndIncludeFileSymlink(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	scriptDir := filepath.Join(rootDir, "bundle")
	if err := os.MkdirAll(scriptDir, 0o755); err != nil {
		t.Fatalf("failed to create script dir: %v", err)
	}

	if err := os.WriteFile(filepath.Join(scriptDir, "a.lua"), []byte("print('a')"), 0o644); err != nil {
		t.Fatalf("failed to write regular file: %v", err)
	}

	outsideDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(outsideDir, "nested.lua"), []byte("print('nested')"), 0o644); err != nil {
		t.Fatalf("failed to write outside nested file: %v", err)
	}
	createScriptSymlinkOrSkip(t, outsideDir, filepath.Join(scriptDir, "linked-dir"))

	outsideFile := filepath.Join(t.TempDir(), "linked-file.lua")
	if err := os.WriteFile(outsideFile, []byte("print('linked-file')"), 0o644); err != nil {
		t.Fatalf("failed to write outside linked file: %v", err)
	}
	createScriptSymlinkOrSkip(t, outsideFile, filepath.Join(scriptDir, "linked-file.lua"))

	files, err := collectScriptFilesCached(scriptDir, "bundle", true, false)
	if err != nil {
		t.Fatalf("collect failed: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files (regular + symlink file), got %d", len(files))
	}

	foundRegular := false
	foundSymlinkFile := false
	for _, f := range files {
		if strings.Contains(f.NormalizedPath, "linked-dir/") {
			t.Fatalf("directory symlink content should be skipped, got path=%s", f.NormalizedPath)
		}
		if strings.HasSuffix(f.NormalizedPath, "/a.lua") {
			foundRegular = true
		}
		if strings.HasSuffix(f.NormalizedPath, "/linked-file.lua") {
			foundSymlinkFile = true
			if got := decodeBase64ForTest(t, f.Data); got != "print('linked-file')" {
				t.Fatalf("unexpected symlink file content: %q", got)
			}
		}
	}
	if !foundRegular {
		t.Fatalf("regular file not found in package")
	}
	if !foundSymlinkFile {
		t.Fatalf("symlink file not found in package")
	}
}
