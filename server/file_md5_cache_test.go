package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFileMD5CacheCoalescesConcurrentMisses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.bin")
	if err := os.WriteFile(path, make([]byte, 16*1024*1024), 0600); err != nil {
		t.Fatal(err)
	}
	var calculations atomic.Int32
	cache := fileMD5Cache{
		entries: make(map[string]md5CacheEntry),
		pending: make(map[md5FileVersion]*pendingMD5),
		hashFile: func(path string) (string, error) {
			calculations.Add(1)
			return calculateFileMD5(path)
		},
	}
	const callers = 16
	start := make(chan struct{})
	results := make(chan md5Result, callers)
	var workers sync.WaitGroup
	for i := 0; i < callers; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			hash, err := cache.get(path, nil)
			results <- md5Result{hash: hash, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	for result := range results {
		if result.err != nil || result.hash != "2c7ab85a893283e98c931e9511add182" {
			t.Fatalf("unexpected MD5 result: %+v", result)
		}
	}
	if got := calculations.Load(); got != 1 {
		t.Fatalf("16 concurrent requests performed %d hashes, expected 1", got)
	}
}

func TestFileMD5CacheDoesNotBlockOtherFilesOrVersions(t *testing.T) {
	for _, samePath := range []bool{false, true} {
		t.Run(map[bool]string{false: "other file", true: "new file version"}[samePath], func(t *testing.T) {
			firstPath := filepath.Join(t.TempDir(), "first.bin")
			if err := os.WriteFile(firstPath, []byte("first"), 0600); err != nil {
				t.Fatal(err)
			}
			started := make(chan struct{})
			blocked := make(chan struct{})
			release := sync.OnceFunc(func() { close(blocked) })
			t.Cleanup(release)
			var calculations atomic.Int32
			cache := fileMD5Cache{
				entries: make(map[string]md5CacheEntry),
				pending: make(map[md5FileVersion]*pendingMD5),
				hashFile: func(string) (string, error) {
					if calculations.Add(1) == 1 {
						close(started)
						<-blocked
						return "first hash", nil
					}
					return "second hash", nil
				},
			}
			firstDone := make(chan md5Result, 1)
			go func() {
				hash, err := cache.get(firstPath, nil)
				firstDone <- md5Result{hash: hash, err: err}
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("first hash did not start")
			}
			secondPath := filepath.Join(filepath.Dir(firstPath), "second.bin")
			if samePath {
				secondPath = firstPath
			}
			if err := os.WriteFile(secondPath, []byte("second version"), 0600); err != nil {
				t.Fatal(err)
			}
			secondDone := make(chan md5Result, 1)
			go func() {
				hash, err := cache.get(secondPath, nil)
				secondDone <- md5Result{hash: hash, err: err}
			}()
			select {
			case result := <-secondDone:
				if result.err != nil || result.hash != "second hash" {
					t.Fatalf("second calculation reused stale data: %+v", result)
				}
			case <-time.After(time.Second):
				t.Fatal("unrelated calculation waited for the blocked file version")
			}
			release()
			select {
			case result := <-firstDone:
				if result.err != nil || result.hash != "first hash" {
					t.Fatalf("unexpected first result: %+v", result)
				}
			case <-time.After(time.Second):
				t.Fatal("first calculation did not finish")
			}
			if hash, err := cache.get(secondPath, nil); err != nil || hash != "second hash" || calculations.Load() != 2 {
				t.Fatalf("older completion displaced the newer cache entry: hash=%q err=%v calculations=%d", hash, err, calculations.Load())
			}
		})
	}
}

func TestFileMD5CacheRetriesAfterFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.bin")
	if err := os.WriteFile(path, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	wantError := errors.New("read failed")
	calculations := 0
	cache := fileMD5Cache{
		entries: make(map[string]md5CacheEntry),
		pending: make(map[md5FileVersion]*pendingMD5),
		hashFile: func(string) (string, error) {
			calculations++
			if calculations == 1 {
				return "", wantError
			}
			return "recovered hash", nil
		},
	}
	if _, err := cache.get(path, nil); !errors.Is(err, wantError) {
		t.Fatalf("expected read failure, got %v", err)
	}
	for i := 0; i < 2; i++ {
		if hash, err := cache.get(path, nil); err != nil || hash != "recovered hash" {
			t.Fatalf("retry did not recover: %q, %v", hash, err)
		}
	}
	if calculations != 2 || len(cache.pending) != 0 {
		t.Fatalf("unexpected retry state: calculations=%d pending=%d", calculations, len(cache.pending))
	}
}

func TestFileMD5CacheReplacementDoesNotEvictOtherFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "changed.bin")
	if err := os.WriteFile(path, []byte("updated"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := fileMD5Cache{
		entries:  make(map[string]md5CacheEntry),
		pending:  make(map[md5FileVersion]*pendingMD5),
		hashFile: func(string) (string, error) { return "updated hash", nil },
	}
	cache.entries[path] = md5CacheEntry{hash: "old hash"}
	for i := 1; i < md5CacheMaxEntries; i++ {
		cache.entries[fmt.Sprintf("cached-%d", i)] = md5CacheEntry{hash: "cached"}
	}
	if hash, err := cache.get(path, nil); err != nil || hash != "updated hash" {
		t.Fatalf("replacement failed: %q, %v", hash, err)
	}
	if len(cache.entries) != md5CacheMaxEntries {
		t.Fatalf("replacement evicted unrelated entries: %d", len(cache.entries))
	}
}
