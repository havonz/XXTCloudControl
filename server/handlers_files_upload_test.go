package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func uploadRequestBody(t *testing.T, fileField string) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("category", "scripts"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("path", "upload-test"); err != nil {
		t.Fatal(err)
	}
	if fileField != "" {
		part, err := writer.CreateFormFile(fileField, "WS注册脚本.tar")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(bytes.Repeat([]byte{'x'}, 196*1024)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

type uploadReadError struct{ err error }

func (r uploadReadError) Read([]byte) (int, error) { return 0, r.err }

func TestServerFilesUploadHandler_ParseFailuresPreserveOriginalCause(t *testing.T) {
	for _, name := range []string{"wrong-content-type", "missing-boundary", "truncated", "timeout", "missing-file", "wrong-file-field", "temporary-directory"} {
		t.Run(name, func(t *testing.T) {
			dataDir := setupFileHandlersTestDataDir(t)
			field := "file"
			if name == "missing-file" {
				field = ""
			} else if name == "wrong-file-field" {
				field = "attachment"
			}
			body, contentType := uploadRequestBody(t, field)
			var reader io.Reader = bytes.NewReader(body)
			status, code := http.StatusBadRequest, "error.file.upload_invalid"
			switch name {
			case "wrong-content-type":
				contentType = "application/json"
			case "missing-boundary":
				contentType = "multipart/form-data"
			case "truncated":
				reader = bytes.NewReader(body[:len(body)-100])
				code = "error.file.upload_interrupted"
			case "timeout":
				reader = uploadReadError{os.ErrDeadlineExceeded}
				status, code = http.StatusRequestTimeout, "error.request.timeout"
			case "missing-file", "wrong-file-field":
				code = "error.file.upload_missing"
			case "temporary-directory":
				t.Setenv("TMPDIR", filepath.Join(dataDir, "missing-temp"))
				t.Setenv("TMP", filepath.Join(dataDir, "missing-temp"))
				t.Setenv("TEMP", filepath.Join(dataDir, "missing-temp"))
				status, code = http.StatusInternalServerError, "error.file.upload_storage_failed"
			}
			w := httptest.NewRecorder()
			c, engine := gin.CreateTestContext(w)
			if name == "temporary-directory" {
				engine.MaxMultipartMemory = 1
			}
			c.Request = httptest.NewRequest(http.MethodPost, "/api/server-files/upload", reader)
			c.Request.Header.Set("Content-Type", contentType)
			serverFilesUploadHandler(c)
			var payload struct {
				Code   string `json:"errorCode"`
				Detail string `json:"detail"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if w.Code != status || payload.Code != code {
				t.Fatalf("status=%d payload=%s; want %d %s", w.Code, w.Body.String(), status, code)
			}
			if code != "error.file.upload_missing" && payload.Detail == "" {
				t.Fatal("original parse error was discarded")
			}
			if name == "truncated" && !strings.Contains(payload.Detail, "unexpected EOF") {
				t.Fatalf("unexpected truncation detail: %q", payload.Detail)
			}
			if _, err := os.Stat(filepath.Join(dataDir, "scripts", "upload-test", "WS注册脚本.tar")); !os.IsNotExist(err) {
				t.Fatalf("failed upload must not create a file: %v", err)
			}
		})
	}
}

func TestServerFilesUploadHandler_ChineseFilenameAndTemporaryFileCleanup(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)
	t.Setenv("TMP", tempDir)
	t.Setenv("TEMP", tempDir)
	body, contentType := uploadRequestBody(t, "file")
	w := httptest.NewRecorder()
	c, engine := gin.CreateTestContext(w)
	engine.MaxMultipartMemory = 1
	c.Request = httptest.NewRequest(http.MethodPost, "/api/server-files/upload", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", contentType)
	serverFilesUploadHandler(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	saved, err := os.ReadFile(filepath.Join(dataDir, "scripts", "upload-test", "WS注册脚本.tar"))
	if err != nil || !bytes.Equal(saved, bytes.Repeat([]byte{'x'}, 196*1024)) {
		t.Fatalf("upload content mismatch: %v", err)
	}
	entries, err := os.ReadDir(tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary upload files were not cleaned: %v %v", entries, err)
	}
}
