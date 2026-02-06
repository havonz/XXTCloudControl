package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
