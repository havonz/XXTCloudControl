package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupLanControlArchiveTestDataDir(t *testing.T) string {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	for _, category := range AllowedCategories {
		if err := os.MkdirAll(filepath.Join(dataDir, category), 0o755); err != nil {
			t.Fatalf("mkdir %s dir: %v", category, err)
		}
	}
	return dataDir
}

func buildLanControlArchiveTestBytes(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s failed: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("write zip entry %s failed: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip failed: %v", err)
	}
	return buf.Bytes()
}

func validLanControlArchiveTestBytes(t *testing.T) []byte {
	t.Helper()
	return buildLanControlArchiveTestBytes(t, map[string][]byte{
		".xxtlca/manifest.json": []byte(`{"format":"xxtlca","formatVersion":1}`),
		"lua/scripts/main.xxt":  []byte("encrypted main"),
		"lua/scripts/main.json": []byte(`{"ScriptInfo":{"Name":"演示脚本","Version":"1.2.3","Developer":"tester","Instructions":"demo"}}`),
	})
}

func postLanControlArchiveMultipart(t *testing.T, router *gin.Engine, target string, archive []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write multipart field %s failed: %v", key, err)
		}
	}
	fileWriter, err := writer.CreateFormFile("file", "demo.xxtlca")
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	if _, err := fileWriter.Write(archive); err != nil {
		t.Fatalf("write form file failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func assertLanControlArchiveFileContent(t *testing.T, filename string, expected string) {
	t.Helper()
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("read %s failed: %v", filename, err)
	}
	if string(data) != expected {
		t.Fatalf("unexpected content for %s: got %q, want %q", filename, string(data), expected)
	}
}

func buildLanControlArchiveTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/scripts/lancontrol-archive/inspect", lanControlArchiveInspectHandler)
	router.POST("/api/scripts/lancontrol-archive/install", lanControlArchiveInstallHandler)
	return router
}

func TestLanControlArchiveInspectAndInstallUpload(t *testing.T) {
	dataDir := setupLanControlArchiveTestDataDir(t)
	router := buildLanControlArchiveTestRouter()
	archive := validLanControlArchiveTestBytes(t)

	inspectW := postLanControlArchiveMultipart(t, router, "/api/scripts/lancontrol-archive/inspect", archive, nil)
	if inspectW.Code != http.StatusOK {
		t.Fatalf("inspect expected 200, got %d body=%s", inspectW.Code, inspectW.Body.String())
	}
	var inspectResult lanControlArchiveInspectResult
	if err := json.Unmarshal(inspectW.Body.Bytes(), &inspectResult); err != nil {
		t.Fatalf("decode inspect result failed: %v", err)
	}
	if !inspectResult.Ok || inspectResult.Meta.Name != "演示脚本" || inspectResult.Meta.Author != "tester" || inspectResult.Meta.Version != "1.2.3" || inspectResult.Meta.Description != "demo" {
		t.Fatalf("unexpected inspect result: %+v", inspectResult)
	}
	if inspectResult.InstallName != "演示脚本" || inspectResult.Exists {
		t.Fatalf("unexpected install suggestion: %+v", inspectResult)
	}

	installW := postLanControlArchiveMultipart(t, router, "/api/scripts/lancontrol-archive/install", archive, map[string]string{
		"installName": "InstalledDemo",
	})
	if installW.Code != http.StatusOK {
		t.Fatalf("install expected 200, got %d body=%s", installW.Code, installW.Body.String())
	}
	var installResult lanControlArchiveInstallResult
	if err := json.Unmarshal(installW.Body.Bytes(), &installResult); err != nil {
		t.Fatalf("decode install result failed: %v", err)
	}
	if !installResult.Ok || installResult.InstallName != "InstalledDemo" || installResult.ScriptPath != "InstalledDemo" {
		t.Fatalf("unexpected install result: %+v", installResult)
	}

	scriptDir := filepath.Join(dataDir, "scripts", "InstalledDemo")
	assertLanControlArchiveFileContent(t, filepath.Join(scriptDir, "lua", "scripts", "main.xxt"), "encrypted main")
	assertLanControlArchiveFileContent(t, filepath.Join(scriptDir, "lua", "scripts", "main.json"), `{"ScriptInfo":{"Name":"演示脚本","Version":"1.2.3","Developer":"tester","Instructions":"demo"}}`)
	if _, err := os.Stat(filepath.Join(scriptDir, "lua", "scripts", "XXTLanControl.lua")); !os.IsNotExist(err) {
		t.Fatalf("SDK should not be installed from archive, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(scriptDir, ".xxtlca", "manifest.json")); !os.IsNotExist(err) {
		t.Fatalf("manifest should not be installed into script dir, stat err=%v", err)
	}
}

func TestLanControlArchiveWithoutManifestUsesFileName(t *testing.T) {
	dataDir := setupLanControlArchiveTestDataDir(t)
	router := buildLanControlArchiveTestRouter()
	archive := buildLanControlArchiveTestBytes(t, map[string][]byte{
		"lua/scripts/main.xxt": []byte("encrypted main"),
	})

	inspectW := postLanControlArchiveMultipart(t, router, "/api/scripts/lancontrol-archive/inspect", archive, nil)
	if inspectW.Code != http.StatusOK {
		t.Fatalf("inspect expected 200, got %d body=%s", inspectW.Code, inspectW.Body.String())
	}
	var inspectResult lanControlArchiveInspectResult
	if err := json.Unmarshal(inspectW.Body.Bytes(), &inspectResult); err != nil {
		t.Fatalf("decode inspect result failed: %v", err)
	}
	if !inspectResult.Ok || inspectResult.Meta.Name != "demo" || inspectResult.InstallName != "demo" {
		t.Fatalf("unexpected inspect fallback: %+v", inspectResult)
	}
	if inspectResult.Meta.Version != "" || inspectResult.Meta.Author != "" || inspectResult.Meta.Description != "" {
		t.Fatalf("metadata fallback should keep unknown fields empty: %+v", inspectResult.Meta)
	}

	installW := postLanControlArchiveMultipart(t, router, "/api/scripts/lancontrol-archive/install", archive, nil)
	if installW.Code != http.StatusOK {
		t.Fatalf("install expected 200, got %d body=%s", installW.Code, installW.Body.String())
	}
	assertLanControlArchiveFileContent(t, filepath.Join(dataDir, "scripts", "demo", "lua", "scripts", "main.xxt"), "encrypted main")
}

func TestLanControlArchiveRejectsZipSlip(t *testing.T) {
	dataDir := setupLanControlArchiveTestDataDir(t)
	router := buildLanControlArchiveTestRouter()
	archive := buildLanControlArchiveTestBytes(t, map[string][]byte{
		".xxtlca/manifest.json": []byte(`{"format":"xxtlca","formatVersion":1}`),
		"lua/scripts/main.xxt":  []byte("encrypted main"),
		"../evil.txt":           []byte("evil"),
	})

	w := postLanControlArchiveMultipart(t, router, "/api/scripts/lancontrol-archive/inspect", archive, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("inspect expected 400, got %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dataDir, "evil.txt")); !os.IsNotExist(err) {
		t.Fatalf("zip slip target should not exist, stat err=%v", err)
	}
}

func TestServerFilesUploadLanControlArchiveInstallsScriptPackage(t *testing.T) {
	dataDir := setupLanControlArchiveTestDataDir(t)
	archive := validLanControlArchiveTestBytes(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("category", "scripts"); err != nil {
		t.Fatalf("write category field: %v", err)
	}
	fileWriter, err := writer.CreateFormFile("file", "demo.xxtlca")
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	if _, err := fileWriter.Write(archive); err != nil {
		t.Fatalf("write form file failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer failed: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/server-files/upload", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	serverFilesUploadHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("upload expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dataDir, "scripts", "demo.xxtlca")); !os.IsNotExist(err) {
		t.Fatalf("archive should not be saved as a package file, stat err=%v", err)
	}
	assertLanControlArchiveFileContent(t, filepath.Join(dataDir, "scripts", "演示脚本", "lua", "scripts", "main.xxt"), "encrypted main")
}
