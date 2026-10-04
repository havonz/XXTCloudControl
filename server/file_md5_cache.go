package main

import (
	"os"
	"sync"
)

type md5CacheEntry struct {
	size       int64
	modTime    int64
	hash       string
	generation uint64
}

type md5FileVersion struct {
	path    string
	size    int64
	modTime int64
}

type pendingMD5 struct {
	done       chan struct{}
	hash       string
	err        error
	generation uint64
}

type fileMD5Cache struct {
	sync.RWMutex
	entries    map[string]md5CacheEntry
	pending    map[md5FileVersion]*pendingMD5
	hashFile   func(string) (string, error)
	generation uint64
}

func (cache *fileMD5Cache) get(filePath string, info os.FileInfo) (string, error) {
	if info == nil {
		var err error
		info, err = os.Stat(filePath)
		if err != nil {
			return "", err
		}
	}
	version := md5FileVersion{path: filePath, size: info.Size(), modTime: info.ModTime().UnixNano()}
	cache.RLock()
	entry, ok := cache.entries[filePath]
	cache.RUnlock()
	if ok && entry.size == version.size && entry.modTime == version.modTime {
		return entry.hash, nil
	}

	cache.Lock()
	if entry, ok := cache.entries[filePath]; ok && entry.size == version.size && entry.modTime == version.modTime {
		cache.Unlock()
		return entry.hash, nil
	}
	if pending := cache.pending[version]; pending != nil {
		cache.Unlock()
		<-pending.done
		return pending.hash, pending.err
	}
	cache.generation++
	pending := &pendingMD5{done: make(chan struct{}), generation: cache.generation}
	cache.pending[version] = pending
	cache.Unlock()

	// 只合并相同文件版本的计算，磁盘读取期间不持有缓存锁，以免拖住其他文件。
	pending.hash, pending.err = cache.hashFile(filePath)
	cache.Lock()
	// 后完成的旧版本计算不能覆盖已经缓存的新版本或上传结果。
	if pending.err == nil && cache.entries[filePath].generation <= pending.generation {
		cache.trimLocked(filePath)
		cache.entries[filePath] = md5CacheEntry{
			size:       version.size,
			modTime:    version.modTime,
			hash:       pending.hash,
			generation: pending.generation,
		}
	}
	delete(cache.pending, version)
	close(pending.done)
	cache.Unlock()
	return pending.hash, pending.err
}

func (cache *fileMD5Cache) trimLocked(filePath string) {
	if _, replacing := cache.entries[filePath]; replacing {
		return
	}
	if len(cache.entries) < md5CacheMaxEntries {
		return
	}
	toRemove := len(cache.entries) - md5CacheTrimEntries
	for key := range cache.entries {
		delete(cache.entries, key)
		toRemove--
		if toRemove <= 0 {
			break
		}
	}
}
