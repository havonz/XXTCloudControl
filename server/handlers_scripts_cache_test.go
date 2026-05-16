package main

import (
	"bytes"
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

func TestCollectScriptFilesCachedPreservesSingleFilePaths(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	smallPath := filepath.Join(rootDir, "main.lua")
	if err := os.WriteFile(smallPath, []byte("print('single')"), 0o644); err != nil {
		t.Fatalf("failed to write small script: %v", err)
	}

	smallFiles, err := collectScriptFilesCached(smallPath, "main.lua", false, false)
	if err != nil {
		t.Fatalf("collect small script failed: %v", err)
	}
	if len(smallFiles) != 1 {
		t.Fatalf("expected 1 small script file, got %d", len(smallFiles))
	}
	if smallFiles[0].Path != "lua/scripts/main.lua" {
		t.Fatalf("single small file target path changed: %s", smallFiles[0].Path)
	}
	if smallFiles[0].Data == "" {
		t.Fatalf("single small file should be inlined")
	}

	largePath := filepath.Join(rootDir, "huge.lua")
	largeContent := bytes.Repeat([]byte("z"), scriptLargeFileThreshold)
	if err := os.WriteFile(largePath, largeContent, 0o644); err != nil {
		t.Fatalf("failed to write large script: %v", err)
	}

	largeFiles, err := collectScriptFilesCached(largePath, "huge.lua", false, false)
	if err != nil {
		t.Fatalf("collect large script failed: %v", err)
	}
	if len(largeFiles) != 1 {
		t.Fatalf("expected 1 large script file, got %d", len(largeFiles))
	}
	if largeFiles[0].Path != "lua/scripts/huge.lua" {
		t.Fatalf("single large file target path changed: %s", largeFiles[0].Path)
	}
	if largeFiles[0].Data != "" {
		t.Fatalf("single large file should use transfer path, got inline data length=%d", len(largeFiles[0].Data))
	}
	if largeFiles[0].Size != int64(len(largeContent)) {
		t.Fatalf("unexpected single large size: %d", largeFiles[0].Size)
	}
}

func TestCollectScriptFilesCachedPreservesSmallAndLargeFilePaths(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	scriptDir := filepath.Join(rootDir, "bundle")
	if err := os.MkdirAll(filepath.Join(scriptDir, "sub"), 0o755); err != nil {
		t.Fatalf("failed to create script dir: %v", err)
	}

	smallPath := filepath.Join(scriptDir, "sub", "small.lua")
	if err := os.WriteFile(smallPath, []byte("print('small')"), 0o644); err != nil {
		t.Fatalf("failed to write small file: %v", err)
	}

	largePath := filepath.Join(scriptDir, "large.dat")
	largeContent := bytes.Repeat([]byte("x"), scriptLargeFileThreshold)
	if err := os.WriteFile(largePath, largeContent, 0o644); err != nil {
		t.Fatalf("failed to write large file: %v", err)
	}

	files, err := collectScriptFilesCached(scriptDir, "bundle", true, false)
	if err != nil {
		t.Fatalf("collect failed: %v", err)
	}

	byPath := make(map[string]scriptFileData, len(files))
	for _, f := range files {
		byPath[f.Path] = f
	}

	small, ok := byPath["lua/scripts/bundle/sub/small.lua"]
	if !ok {
		t.Fatalf("small file target path changed, files=%v", files)
	}
	if small.SourcePath != smallPath {
		t.Fatalf("unexpected small source path: %s", small.SourcePath)
	}
	if small.Data == "" {
		t.Fatalf("small file should be inlined")
	}
	if got := decodeBase64ForTest(t, small.Data); got != "print('small')" {
		t.Fatalf("unexpected small content: %q", got)
	}

	large, ok := byPath["lua/scripts/bundle/large.dat"]
	if !ok {
		t.Fatalf("large file target path changed, files=%v", files)
	}
	if large.SourcePath != largePath {
		t.Fatalf("unexpected large source path: %s", large.SourcePath)
	}
	if large.Data != "" {
		t.Fatalf("large file should use transfer path, got inline data length=%d", len(large.Data))
	}
	if large.Size != int64(len(largeContent)) {
		t.Fatalf("unexpected large size: %d", large.Size)
	}
}

func TestCollectScriptFilesCachedPreservesPiledScriptPaths(t *testing.T) {
	resetScriptPackageCacheForTest()

	rootDir := t.TempDir()
	scriptDir := filepath.Join(rootDir, "bundle.xpp")
	if err := os.MkdirAll(filepath.Join(scriptDir, "lua", "scripts"), 0o755); err != nil {
		t.Fatalf("failed to create piled script dir: %v", err)
	}

	smallPath := filepath.Join(scriptDir, "lua", "scripts", "main.lua")
	if err := os.WriteFile(smallPath, []byte("print('main')"), 0o644); err != nil {
		t.Fatalf("failed to write piled small file: %v", err)
	}

	largePath := filepath.Join(scriptDir, "asset.bin")
	largeContent := bytes.Repeat([]byte("y"), scriptLargeFileThreshold)
	if err := os.WriteFile(largePath, largeContent, 0o644); err != nil {
		t.Fatalf("failed to write piled large file: %v", err)
	}

	files, err := collectScriptFilesCached(scriptDir, "bundle.xpp", true, true)
	if err != nil {
		t.Fatalf("collect failed: %v", err)
	}

	byPath := make(map[string]scriptFileData, len(files))
	for _, f := range files {
		byPath[f.Path] = f
	}

	small, ok := byPath["lua/scripts/main.lua"]
	if !ok {
		t.Fatalf("piled small file target path changed, files=%v", files)
	}
	if small.SourcePath != smallPath || small.Data == "" {
		t.Fatalf("unexpected piled small file metadata: source=%s dataLen=%d", small.SourcePath, len(small.Data))
	}

	large, ok := byPath["asset.bin"]
	if !ok {
		t.Fatalf("piled large file target path changed, files=%v", files)
	}
	if large.SourcePath != largePath {
		t.Fatalf("unexpected piled large source path: %s", large.SourcePath)
	}
	if large.Data != "" {
		t.Fatalf("piled large file should use transfer path, got inline data length=%d", len(large.Data))
	}
	if large.Size != int64(len(largeContent)) {
		t.Fatalf("unexpected piled large size: %d", large.Size)
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
