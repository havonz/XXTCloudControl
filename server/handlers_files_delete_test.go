package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestServerFilesBatchDeletePreservesSymlinkTargets(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	base := filepath.Join(dataDir, "files", "selected")
	folder := filepath.Join(base, "folder")
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "keep.txt")
	for _, path := range []string{outsideFile, filepath.Join(base, "file.txt"), filepath.Join(base, " spaced .txt"), filepath.Join(folder, "child.txt")} {
		if err := os.WriteFile(path, []byte("keep target"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	createSymlinkOrSkip(t, outside, filepath.Join(base, "directory-link"))
	createSymlinkOrSkip(t, outsideFile, filepath.Join(base, "file-link"))
	createSymlinkOrSkip(t, filepath.Join(outside, "missing"), filepath.Join(base, "broken-link"))
	createSymlinkOrSkip(t, outside, filepath.Join(folder, "nested-link"))
	items := []string{"file.txt", "folder", "directory-link", "file-link", "broken-link", " spaced .txt"}
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/server-files/batch-delete", map[string]any{
		"category": "files", "path": "selected", "items": items,
	}, serverFilesBatchDeleteHandler)
	result := decodeServerFilesBatchTestResponse(t, response)
	if response.Code != http.StatusOK || !result.Success || result.SuccessCount != len(items) || len(result.ErrorItems) != 0 {
		t.Fatalf("delete result: status=%d %+v", response.Code, result)
	}
	for _, item := range items {
		if _, err := os.Lstat(filepath.Join(base, item)); !os.IsNotExist(err) {
			t.Fatalf("selected item %q remains: %v", item, err)
		}
	}
	if contents, err := os.ReadFile(outsideFile); err != nil || string(contents) != "keep target" {
		t.Fatalf("symlink target changed: %q %v", contents, err)
	}
	if _, err := os.Stat(base); err != nil {
		t.Fatalf("parent directory was removed: %v", err)
	}
}

func TestServerFilesBatchDeleteReportsFailuresAndKeepsProcessing(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	base := filepath.Join(dataDir, "scripts")
	if err := os.WriteFile(filepath.Join(base, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "outside.txt"), []byte("outside"), 0644); err != nil {
		t.Fatal(err)
	}
	items := []string{"missing.txt", "..", ".", "", "../outside.txt", "subdir/keep.txt", `subdir\keep.txt`}
	failureCount := len(items)
	for index := 0; index < 100; index++ {
		name := fmt.Sprintf("file-%d.txt", index)
		if err := os.WriteFile(filepath.Join(base, name), []byte("delete"), 0644); err != nil {
			t.Fatal(err)
		}
		items = append(items, name)
	}
	response := performJSONHandlerRequest(t, http.MethodPost, "/api/server-files/batch-delete?locale=en-US", map[string]any{
		"category": "scripts", "path": "", "items": items,
	}, serverFilesBatchDeleteHandler)
	result := decodeServerFilesBatchTestResponse(t, response)
	if response.Code != http.StatusOK || result.Success || result.SuccessCount != 100 || result.TotalCount != len(items) || len(result.ErrorItems) != failureCount {
		t.Fatalf("partial result: status=%d %+v", response.Code, result)
	}
	for index, failure := range result.ErrorItems {
		if failure.Item != items[index] || failure.Error == "" || failure.ErrorCode == "" {
			t.Fatalf("missing or reordered failure at %d: %+v", index, failure)
		}
	}
	if response.Header().Get("Content-Language") != "en-US" {
		t.Fatal("response language was not preserved")
	}
	for _, item := range items[failureCount:] {
		if _, err := os.Stat(filepath.Join(base, item)); !os.IsNotExist(err) {
			t.Fatalf("valid item %s was skipped after earlier failures", item)
		}
	}
	for _, path := range []string{filepath.Join(base, "keep.txt"), filepath.Join(dataDir, "outside.txt")} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("unselected file was removed: %v", err)
		}
	}
}

func TestServerFilesBatchDeleteRejectsInvalidRequests(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	path := filepath.Join(dataDir, "files", "keep.txt")
	if err := os.WriteFile(path, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, payload := range []map[string]any{
		{"category": "files", "items": []string{}},
		{"category": "invalid", "items": []string{"keep.txt"}},
		{"items": []string{"keep.txt"}},
		{"category": "files", "items": "keep.txt"},
	} {
		response := performJSONHandlerRequest(t, http.MethodPost, "/api/server-files/batch-delete", payload, serverFilesBatchDeleteHandler)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid request accepted: %d %s", response.Code, response.Body)
		}
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("invalid request removed a file: %v", err)
	}
}

func TestServerFilesBatchDeleteCancellationAndAuthentication(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	path := filepath.Join(dataDir, "files", "keep.txt")
	if err := os.WriteFile(path, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{"category": "files", "items": []string{"keep.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/server-files/batch-delete", bytes.NewReader(body)).WithContext(requestContext)
	c.Request.Header.Set("Content-Type", "application/json")
	serverFilesBatchDeleteHandler(c)
	result := decodeServerFilesBatchTestResponse(t, response)
	if result.Success || result.SuccessCount != 0 || len(result.ErrorItems) != 1 {
		t.Fatalf("canceled request result: %+v", result)
	}
	router := gin.New()
	router.Use(apiAuthMiddleware())
	router.POST("/api/server-files/batch-delete", serverFilesBatchDeleteHandler)
	unauthorized := httptest.NewRecorder()
	router.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/api/server-files/batch-delete", bytes.NewReader(body)))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("missing authentication accepted: %d", unauthorized.Code)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("canceled or unauthorized request removed a file: %v", err)
	}
}

func TestServerFilesDeleteHandlerPreservesLegacyStatus(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	path := filepath.Join(dataDir, "files", "file.txt")
	if err := os.WriteFile(path, []byte("delete"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		query  string
		status int
	}{
		{"category=files&path=.", http.StatusBadRequest},
		{"category=files&path=missing.txt", http.StatusNotFound},
		{"category=files&path=file.txt", http.StatusOK},
	} {
		response := performJSONHandlerRequest(t, http.MethodDelete, "/api/server-files/delete?"+test.query, nil, serverFilesDeleteHandler)
		if response.Code != test.status {
			t.Fatalf("legacy delete: %s status=%d expected=%d", test.query, response.Code, test.status)
		}
	}
}
