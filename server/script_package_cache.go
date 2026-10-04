package main

import (
	"reflect"
	"sync"
)

const (
	scriptPackageCacheMax           = 64
	scriptPackageCacheMaxBytes      = 64 * 1024 * 1024
	scriptPackageCacheMaxEntryBytes = 16 * 1024 * 1024
)

type scriptPackageCacheEntry struct {
	signature string
	files     []scriptFileData
	bytes     int64
	lastUsed  uint64
}

type scriptPackageCacheStore struct {
	sync.Mutex
	entries       map[string]scriptPackageCacheEntry
	totalBytes    int64
	useSequence   uint64
	maxBytes      int64
	maxEntryBytes int64
}

var scriptPackageCache = scriptPackageCacheStore{
	entries:       make(map[string]scriptPackageCacheEntry),
	maxBytes:      scriptPackageCacheMaxBytes,
	maxEntryBytes: scriptPackageCacheMaxEntryBytes,
}

func (cache *scriptPackageCacheStore) get(key, signature string) ([]scriptFileData, bool) {
	cache.Lock()
	entry, ok := cache.entries[key]
	if ok && entry.signature != signature {
		cache.totalBytes -= entry.bytes
		delete(cache.entries, key)
		ok = false
	}
	if ok {
		cache.useSequence++
		entry.lastUsed = cache.useSequence
		cache.entries[key] = entry
	}
	cache.Unlock()
	if !ok {
		return nil, false
	}
	return cloneScriptFileDataSlice(entry.files), true
}

func (cache *scriptPackageCacheStore) put(key, signature string, files []scriptFileData) {
	bytes := int64(len(key)+len(signature)) + int64(len(files))*int64(reflect.TypeOf(scriptFileData{}).Size())
	for _, file := range files {
		bytes += int64(len(file.Data) + len(file.Path) + len(file.NormalizedPath) + len(file.SourcePath))
	}

	cache.Lock()
	defer cache.Unlock()
	if old, ok := cache.entries[key]; ok {
		cache.totalBytes -= old.bytes
		delete(cache.entries, key)
	}
	// 超大脚本仍正常分发，只跳过常驻缓存，避免一次使用挤掉全部常用脚本。
	if bytes > cache.maxEntryBytes || bytes > cache.maxBytes {
		return
	}
	for len(cache.entries) >= scriptPackageCacheMax || cache.totalBytes+bytes > cache.maxBytes {
		var oldestKey string
		oldestUse := ^uint64(0)
		for key, entry := range cache.entries {
			if entry.lastUsed < oldestUse {
				oldestKey, oldestUse = key, entry.lastUsed
			}
		}
		cache.totalBytes -= cache.entries[oldestKey].bytes
		delete(cache.entries, oldestKey)
	}
	cache.useSequence++
	cache.entries[key] = scriptPackageCacheEntry{
		signature: signature,
		files:     cloneScriptFileDataSlice(files),
		bytes:     bytes,
		lastUsed:  cache.useSequence,
	}
	cache.totalBytes += bytes
}
