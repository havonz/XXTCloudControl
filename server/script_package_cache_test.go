package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScriptPackageCacheEvictsLeastRecentlyUsedWithinBudget(t *testing.T) {
	cache := scriptPackageCacheStore{
		entries: make(map[string]scriptPackageCacheEntry), maxBytes: 4096, maxEntryBytes: 2048,
	}
	files := []scriptFileData{{Path: "main.lua", Data: strings.Repeat("x", 256)}}
	cache.put("a", "v1", files)
	entryBytes := cache.totalBytes
	cache.maxBytes = entryBytes * 2
	cache.put("b", "v1", files)
	if _, ok := cache.get("a", "v1"); !ok {
		t.Fatal("first package was not cached")
	}
	cache.put("c", "v1", files)
	if _, ok := cache.get("b", "v1"); ok {
		t.Fatal("least recently used package was not evicted")
	}
	for _, key := range []string{"a", "c"} {
		if _, ok := cache.get(key, "v1"); !ok {
			t.Fatalf("expected retained package %s", key)
		}
	}
	if cache.totalBytes > cache.maxBytes || len(cache.entries) != 2 {
		t.Fatalf("cache exceeded budget: bytes=%d entries=%d", cache.totalBytes, len(cache.entries))
	}
}

func TestScriptPackageCacheBypassesOversizeEntriesAndAccountsForReplacement(t *testing.T) {
	cache := scriptPackageCacheStore{
		entries: make(map[string]scriptPackageCacheEntry), maxBytes: 4096, maxEntryBytes: 512,
	}
	files := []scriptFileData{{Path: "main.lua", Data: "original"}}
	cache.put("hot", "v1", files)
	originalBytes := cache.totalBytes
	files[0].Data = "caller changed metadata"
	loaded, ok := cache.get("hot", "v1")
	if !ok || loaded[0].Data != "original" {
		t.Fatal("caller mutation changed the cached package")
	}
	loaded[0].Data = "another change"
	loaded, _ = cache.get("hot", "v1")
	if loaded[0].Data != "original" {
		t.Fatal("lookup returned mutable cached metadata")
	}
	cache.put("large", "v1", []scriptFileData{{Data: strings.Repeat("x", 513)}})
	if len(cache.entries) != 1 || cache.totalBytes != originalBytes {
		t.Fatal("oversize package displaced the hot package")
	}
	cache.put("hot", "v2", []scriptFileData{{Path: "main.lua", Data: "updated version"}})
	if cache.totalBytes != cache.entries["hot"].bytes || cache.totalBytes <= originalBytes {
		t.Fatal("replacing an entry did not update its retained byte count")
	}
	if _, ok := cache.get("hot", "v3"); ok || cache.totalBytes != 0 || len(cache.entries) != 0 {
		t.Fatal("invalidated package was retained")
	}
}

func TestScriptPackageCacheAlsoLimitsEntryCount(t *testing.T) {
	cache := scriptPackageCacheStore{
		entries: make(map[string]scriptPackageCacheEntry), maxBytes: 1024 * 1024, maxEntryBytes: 4096,
	}
	for i := 0; i <= scriptPackageCacheMax; i++ {
		cache.put(fmt.Sprintf("package-%d", i), "v1", []scriptFileData{{Data: "small"}})
	}
	if len(cache.entries) != scriptPackageCacheMax {
		t.Fatalf("unexpected entry count: %d", len(cache.entries))
	}
	if _, ok := cache.get("package-0", "v1"); ok {
		t.Fatal("oldest package remained after the entry limit was reached")
	}
}

func TestCollectScriptFilesCachedStillReturnsOversizePackages(t *testing.T) {
	resetScriptPackageCacheForTest()
	previousLimit := scriptPackageCache.maxEntryBytes
	scriptPackageCache.maxEntryBytes = 512
	t.Cleanup(func() {
		scriptPackageCache.maxEntryBytes = previousLimit
		resetScriptPackageCacheForTest()
	})
	path := filepath.Join(t.TempDir(), "main.lua")
	content := strings.Repeat("print('keep this file')\n", 64)
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	files, err := collectScriptFilesCached(path, "main.lua", false, false)
	if err != nil || len(files) != 1 || decodeBase64ForTest(t, files[0].Data) != content {
		t.Fatalf("cache limit changed script contents: files=%d err=%v", len(files), err)
	}
	if len(scriptPackageCache.entries) != 0 || scriptPackageCache.totalBytes != 0 {
		t.Fatal("oversize package was retained in the cache")
	}
}
