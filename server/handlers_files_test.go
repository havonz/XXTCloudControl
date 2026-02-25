package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func createSymlinkOrSkip(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink is not available in this environment: %v", err)
	}
}

func setupFileHandlersTestDataDir(t *testing.T) string {
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

func performJSONHandlerRequest(t *testing.T, method, target string, payload any, handler func(*gin.Context)) *httptest.ResponseRecorder {
	t.Helper()

	var reqBody []byte
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload failed: %v", err)
		}
		reqBody = data
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, target, bytes.NewReader(reqBody))
	if payload != nil {
		c.Request.Header.Set("Content-Type", "application/json")
	}
	handler(c)
	return w
}

func TestServerFilesListHandler_MetaParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		t.Fatalf("mkdir scripts dir: %v", err)
	}

	content := []byte("hello")
	filePath := filepath.Join(scriptsDir, "hello.txt")
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	// meta=0 should skip size/modTime
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=0", nil)
		serverFilesListHandler(c)

		if w.Code != http.StatusOK {
			t.Fatalf("unexpected status: %d", w.Code)
		}

		var resp struct {
			Files []ServerFileItem `json:"files"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(resp.Files) != 1 {
			t.Fatalf("expected 1 file, got %d", len(resp.Files))
		}
		if resp.Files[0].Size != 0 {
			t.Fatalf("expected size 0 when meta=0, got %d", resp.Files[0].Size)
		}
		if resp.Files[0].ModTime != "" {
			t.Fatalf("expected empty modTime when meta=0, got %q", resp.Files[0].ModTime)
		}
	}

	// meta=1 should include size/modTime
	{
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=1", nil)
		serverFilesListHandler(c)

		if w.Code != http.StatusOK {
			t.Fatalf("unexpected status: %d", w.Code)
		}

		var resp struct {
			Files []ServerFileItem `json:"files"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(resp.Files) != 1 {
			t.Fatalf("expected 1 file, got %d", len(resp.Files))
		}
		if resp.Files[0].Size != int64(len(content)) {
			t.Fatalf("expected size %d when meta=1, got %d", len(content), resp.Files[0].Size)
		}
		if resp.Files[0].ModTime == "" {
			t.Fatalf("expected modTime when meta=1")
		}
	}
}

func TestServerFilesListHandler_SymlinkDirectorySupport(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(outsideDir, "outside.txt"), []byte("external"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	createSymlinkOrSkip(t, outsideDir, filepath.Join(dataDir, "scripts", "linked-dir"))

	rootListW := httptest.NewRecorder()
	rootListC, _ := gin.CreateTestContext(rootListW)
	rootListC.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=1", nil)
	serverFilesListHandler(rootListC)

	if rootListW.Code != http.StatusOK {
		t.Fatalf("root list status=%d body=%s", rootListW.Code, rootListW.Body.String())
	}

	var rootResp struct {
		Files []ServerFileItem `json:"files"`
	}
	if err := json.NewDecoder(rootListW.Body).Decode(&rootResp); err != nil {
		t.Fatalf("decode root list response: %v", err)
	}

	var linkedItem *ServerFileItem
	for i := range rootResp.Files {
		if rootResp.Files[i].Name == "linked-dir" {
			linkedItem = &rootResp.Files[i]
			break
		}
	}
	if linkedItem == nil {
		t.Fatalf("linked-dir not found in list")
	}
	if linkedItem.Type != "dir" {
		t.Fatalf("expected linked-dir type=dir, got %s", linkedItem.Type)
	}
	if !linkedItem.IsSymlink {
		t.Fatalf("expected linked-dir isSymlink=true")
	}

	linkedListW := httptest.NewRecorder()
	linkedListC, _ := gin.CreateTestContext(linkedListW)
	linkedListC.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=linked-dir&meta=1", nil)
	serverFilesListHandler(linkedListC)

	if linkedListW.Code != http.StatusOK {
		t.Fatalf("linked dir list status=%d body=%s", linkedListW.Code, linkedListW.Body.String())
	}

	var linkedResp struct {
		Files []ServerFileItem `json:"files"`
	}
	if err := json.NewDecoder(linkedListW.Body).Decode(&linkedResp); err != nil {
		t.Fatalf("decode linked dir list response: %v", err)
	}
	if len(linkedResp.Files) != 1 || linkedResp.Files[0].Name != "outside.txt" {
		t.Fatalf("unexpected linked dir list result: %+v", linkedResp.Files)
	}
}

func TestServerFilesListHandler_SymlinkFileMarksAsSymlink(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "outside.lua")
	if err := os.WriteFile(outsideFile, []byte("print('outside')"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	createSymlinkOrSkip(t, outsideFile, filepath.Join(dataDir, "scripts", "linked.lua"))

	rootListW := httptest.NewRecorder()
	rootListC, _ := gin.CreateTestContext(rootListW)
	rootListC.Request = httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=&meta=1", nil)
	serverFilesListHandler(rootListC)

	if rootListW.Code != http.StatusOK {
		t.Fatalf("root list status=%d body=%s", rootListW.Code, rootListW.Body.String())
	}

	var rootResp struct {
		Files []ServerFileItem `json:"files"`
	}
	if err := json.NewDecoder(rootListW.Body).Decode(&rootResp); err != nil {
		t.Fatalf("decode root list response: %v", err)
	}

	var linkedItem *ServerFileItem
	for i := range rootResp.Files {
		if rootResp.Files[i].Name == "linked.lua" {
			linkedItem = &rootResp.Files[i]
			break
		}
	}
	if linkedItem == nil {
		t.Fatalf("linked.lua not found in list")
	}
	if linkedItem.Type != "file" {
		t.Fatalf("expected linked.lua type=file, got %s", linkedItem.Type)
	}
	if !linkedItem.IsSymlink {
		t.Fatalf("expected linked.lua isSymlink=true")
	}
}

func TestServerFilesReadAndSaveHandler_SymlinkFileSupport(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "outside.lua")
	if err := os.WriteFile(outsideFile, []byte("print('v1')"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	createSymlinkOrSkip(t, outsideFile, filepath.Join(dataDir, "scripts", "linked.lua"))

	readW := httptest.NewRecorder()
	readC, _ := gin.CreateTestContext(readW)
	readC.Request = httptest.NewRequest("GET", "/api/server-files/read?category=scripts&path=linked.lua", nil)
	serverFilesReadHandler(readC)

	if readW.Code != http.StatusOK {
		t.Fatalf("read status=%d body=%s", readW.Code, readW.Body.String())
	}

	var readResp struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(readW.Body).Decode(&readResp); err != nil {
		t.Fatalf("decode read response: %v", err)
	}
	if readResp.Content != "print('v1')" {
		t.Fatalf("unexpected read content: %q", readResp.Content)
	}

	savePayload := map[string]any{
		"category": "scripts",
		"path":     "linked.lua",
		"content":  "print('v2')",
	}
	saveW := performJSONHandlerRequest(t, "POST", "/api/server-files/save", savePayload, serverFilesSaveHandler)
	if saveW.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", saveW.Code, saveW.Body.String())
	}

	updated, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatalf("read outside file after save: %v", err)
	}
	if string(updated) != "print('v2')" {
		t.Fatalf("outside file not updated through symlink, got %q", string(updated))
	}
}

func TestServerFilesDeleteHandler_DeletesOnlySymlinkForExternalDirectory(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "keep.txt")
	if err := os.WriteFile(outsideFile, []byte("keep"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	symlinkPath := filepath.Join(dataDir, "scripts", "linked-dir")
	createSymlinkOrSkip(t, outsideDir, symlinkPath)

	deleteReq := httptest.NewRequest("DELETE", "/api/server-files/delete?category=scripts&path=linked-dir", nil)
	deleteW := httptest.NewRecorder()
	deleteC, _ := gin.CreateTestContext(deleteW)
	deleteC.Request = deleteReq
	serverFilesDeleteHandler(deleteC)

	if deleteW.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", deleteW.Code, deleteW.Body.String())
	}

	if _, err := os.Lstat(symlinkPath); !os.IsNotExist(err) {
		t.Fatalf("symlink should be removed, err=%v", err)
	}

	content, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatalf("outside target file should remain: %v", err)
	}
	if string(content) != "keep" {
		t.Fatalf("outside target file content changed unexpectedly: %q", string(content))
	}
}

func TestServerFilesBatchCopyHandler_CopiesFileSymlinkItself(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideFile := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("outside"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	srcSymlink := filepath.Join(dataDir, "scripts", "linked.txt")
	createSymlinkOrSkip(t, outsideFile, srcSymlink)

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"linked.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	w := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-copy", payload, serverFilesBatchCopyHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("copy status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SuccessCount != 1 {
		t.Fatalf("expected 1 copied item, got %d, errors=%v", resp.SuccessCount, resp.Errors)
	}

	dstSymlink := filepath.Join(dataDir, "files", "linked.txt")
	dstInfo, err := os.Lstat(dstSymlink)
	if err != nil {
		t.Fatalf("destination symlink lstat failed: %v", err)
	}
	if dstInfo.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("expected destination to be symlink, mode=%v", dstInfo.Mode())
	}

	srcTarget, err := os.Readlink(srcSymlink)
	if err != nil {
		t.Fatalf("read source symlink failed: %v", err)
	}
	dstTarget, err := os.Readlink(dstSymlink)
	if err != nil {
		t.Fatalf("read destination symlink failed: %v", err)
	}
	if srcTarget != dstTarget {
		t.Fatalf("symlink target mismatch: src=%q dst=%q", srcTarget, dstTarget)
	}
}

func TestServerFilesBatchMoveHandler_MovesDirectorySymlinkItself(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("outside"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	srcSymlink := filepath.Join(dataDir, "scripts", "linked-dir")
	createSymlinkOrSkip(t, outsideDir, srcSymlink)
	srcTarget, err := os.Readlink(srcSymlink)
	if err != nil {
		t.Fatalf("read source symlink failed: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"linked-dir"},
		"srcPath":     "",
		"dstPath":     "",
	}
	w := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-move", payload, serverFilesBatchMoveHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("move status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SuccessCount != 1 {
		t.Fatalf("expected 1 moved item, got %d, errors=%v", resp.SuccessCount, resp.Errors)
	}

	if _, err := os.Lstat(srcSymlink); !os.IsNotExist(err) {
		t.Fatalf("source symlink should be removed, err=%v", err)
	}

	dstSymlink := filepath.Join(dataDir, "files", "linked-dir")
	dstInfo, err := os.Lstat(dstSymlink)
	if err != nil {
		t.Fatalf("destination symlink lstat failed: %v", err)
	}
	if dstInfo.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("expected destination to be symlink, mode=%v", dstInfo.Mode())
	}

	dstTarget, err := os.Readlink(dstSymlink)
	if err != nil {
		t.Fatalf("read destination symlink failed: %v", err)
	}
	if srcTarget != dstTarget {
		t.Fatalf("symlink target mismatch: src=%q dst=%q", srcTarget, dstTarget)
	}

	after, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatalf("outside target content should remain: %v", err)
	}
	if string(after) != "outside" {
		t.Fatalf("outside target file content changed unexpectedly: %q", string(after))
	}
}

func TestServerFilesBatchCopyHandler_CopiesFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	srcDir := filepath.Join(dataDir, "scripts")
	dstDir := filepath.Join(dataDir, "files")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir src dir: %v", err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatalf("mkdir dst dir: %v", err)
	}

	srcFile := filepath.Join(srcDir, "foo.txt")
	content := []byte("copy me")
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("write src file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"foo.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-copy", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchCopyHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	dstFile := filepath.Join(dstDir, "foo.txt")
	copied, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if !bytes.Equal(copied, content) {
		t.Fatalf("copied content mismatch")
	}
}

func TestServerFilesBatchMoveHandler_MovesFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	srcDir := filepath.Join(dataDir, "scripts")
	dstDir := filepath.Join(dataDir, "files")
	if err := os.MkdirAll(srcDir, 0755); err != nil {
		t.Fatalf("mkdir src dir: %v", err)
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		t.Fatalf("mkdir dst dir: %v", err)
	}

	srcFile := filepath.Join(srcDir, "move.txt")
	content := []byte("move me")
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("write src file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"move.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-move", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchMoveHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	if _, err := os.Stat(srcFile); !os.IsNotExist(err) {
		t.Fatalf("expected source file to be removed")
	}

	dstFile := filepath.Join(dstDir, "move.txt")
	moved, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("read moved file: %v", err)
	}
	if !bytes.Equal(moved, content) {
		t.Fatalf("moved content mismatch")
	}
}

func TestServerFilesCreateHandler_RejectsTraversalName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	if err := os.MkdirAll(filepath.Join(dataDir, "scripts"), 0o755); err != nil {
		t.Fatalf("mkdir scripts dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "scripts2"), 0o755); err != nil {
		t.Fatalf("mkdir sibling dir: %v", err)
	}

	payload := map[string]any{
		"category": "scripts",
		"path":     "",
		"name":     "../scripts2/poc.txt",
		"type":     "file",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/create", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesCreateHandler(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	escapedPath := filepath.Join(dataDir, "scripts2", "poc.txt")
	if _, err := os.Stat(escapedPath); !os.IsNotExist(err) {
		t.Fatalf("expected traversal target to not be created: %s", escapedPath)
	}
}

func TestServerFilesBatchCopyHandler_RejectsTraversalItem(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	if err := os.MkdirAll(filepath.Join(dataDir, "scripts"), 0o755); err != nil {
		t.Fatalf("mkdir scripts dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "files", "nested"), 0o755); err != nil {
		t.Fatalf("mkdir files dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "scripts2"), 0o755); err != nil {
		t.Fatalf("mkdir sibling dir: %v", err)
	}

	leakPath := filepath.Join(dataDir, "scripts2", "leak.txt")
	if err := os.WriteFile(leakPath, []byte("sensitive"), 0o644); err != nil {
		t.Fatalf("write leak file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"../scripts2/leak.txt"},
		"srcPath":     "",
		"dstPath":     "nested",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-copy", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchCopyHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	var resp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SuccessCount != 0 {
		t.Fatalf("expected no copied files, got %d", resp.SuccessCount)
	}
	if len(resp.Errors) == 0 {
		t.Fatalf("expected traversal errors")
	}

	dstPath := filepath.Join(dataDir, "files", "scripts2", "leak.txt")
	if _, err := os.Stat(dstPath); !os.IsNotExist(err) {
		t.Fatalf("expected destination file to not be created: %s", dstPath)
	}
}

func TestServerFilesBatchMoveHandler_RejectsTraversalItem(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	if err := os.MkdirAll(filepath.Join(dataDir, "scripts"), 0o755); err != nil {
		t.Fatalf("mkdir scripts dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "files", "nested"), 0o755); err != nil {
		t.Fatalf("mkdir files dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "scripts2"), 0o755); err != nil {
		t.Fatalf("mkdir sibling dir: %v", err)
	}

	leakPath := filepath.Join(dataDir, "scripts2", "leak-move.txt")
	original := []byte("sensitive-move")
	if err := os.WriteFile(leakPath, original, 0o644); err != nil {
		t.Fatalf("write leak file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"../scripts2/leak-move.txt"},
		"srcPath":     "",
		"dstPath":     "nested",
	}
	body, _ := json.Marshal(payload)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/batch-move", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	serverFilesBatchMoveHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", w.Code)
	}

	var resp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SuccessCount != 0 {
		t.Fatalf("expected no moved files, got %d", resp.SuccessCount)
	}
	if len(resp.Errors) == 0 {
		t.Fatalf("expected traversal errors")
	}

	after, err := os.ReadFile(leakPath)
	if err != nil {
		t.Fatalf("source file should remain: %v", err)
	}
	if !bytes.Equal(after, original) {
		t.Fatalf("source file content changed unexpectedly")
	}
}

func TestServerFilesHandlers_CRUDFlow(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	createPayload := map[string]any{
		"category": "scripts",
		"path":     "",
		"name":     "flow.txt",
		"type":     "file",
		"content":  "v1",
	}
	if w := performJSONHandlerRequest(t, "POST", "/api/server-files/create", createPayload, serverFilesCreateHandler); w.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", w.Code, w.Body.String())
	}

	readReq := httptest.NewRequest("GET", "/api/server-files/read?category=scripts&path=flow.txt", nil)
	readW := httptest.NewRecorder()
	readC, _ := gin.CreateTestContext(readW)
	readC.Request = readReq
	serverFilesReadHandler(readC)
	if readW.Code != http.StatusOK {
		t.Fatalf("read status=%d body=%s", readW.Code, readW.Body.String())
	}
	var readResp struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(readW.Body).Decode(&readResp); err != nil {
		t.Fatalf("decode read response: %v", err)
	}
	if readResp.Content != "v1" {
		t.Fatalf("unexpected read content: %q", readResp.Content)
	}

	savePayload := map[string]any{
		"category": "scripts",
		"path":     "flow.txt",
		"content":  "v2",
	}
	if w := performJSONHandlerRequest(t, "POST", "/api/server-files/save", savePayload, serverFilesSaveHandler); w.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", w.Code, w.Body.String())
	}

	renamePayload := map[string]any{
		"category": "scripts",
		"path":     "",
		"oldName":  "flow.txt",
		"newName":  "flow-renamed.txt",
	}
	if w := performJSONHandlerRequest(t, "POST", "/api/server-files/rename", renamePayload, serverFilesRenameHandler); w.Code != http.StatusOK {
		t.Fatalf("rename status=%d body=%s", w.Code, w.Body.String())
	}

	downloadW := httptest.NewRecorder()
	downloadC, _ := gin.CreateTestContext(downloadW)
	downloadC.Request = httptest.NewRequest("GET", "/api/server-files/download/scripts/flow-renamed.txt", nil)
	downloadC.Params = gin.Params{
		{Key: "path", Value: "/scripts/flow-renamed.txt"},
	}
	serverFilesDownloadHandler(downloadC)
	if downloadW.Code != http.StatusOK {
		t.Fatalf("download status=%d body=%s", downloadW.Code, downloadW.Body.String())
	}
	if got := downloadW.Body.String(); got != "v2" {
		t.Fatalf("unexpected download body: %q", got)
	}

	deleteReq := httptest.NewRequest("DELETE", "/api/server-files/delete?category=scripts&path=flow-renamed.txt", nil)
	deleteW := httptest.NewRecorder()
	deleteC, _ := gin.CreateTestContext(deleteW)
	deleteC.Request = deleteReq
	serverFilesDeleteHandler(deleteC)
	if deleteW.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", deleteW.Code, deleteW.Body.String())
	}

	listReq := httptest.NewRequest("GET", "/api/server-files/list?category=scripts&path=", nil)
	listW := httptest.NewRecorder()
	listC, _ := gin.CreateTestContext(listW)
	listC.Request = listReq
	serverFilesListHandler(listC)
	if listW.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listW.Code, listW.Body.String())
	}
	var listResp struct {
		Files []ServerFileItem `json:"files"`
	}
	if err := json.NewDecoder(listW.Body).Decode(&listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	for _, item := range listResp.Files {
		if item.Name == "flow-renamed.txt" {
			t.Fatalf("deleted file still appears in list")
		}
	}
}

func TestServerFilesBatchHandlers_SupportNestedRelativePath(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	srcFile := filepath.Join(dataDir, "scripts", "a", "b.txt")
	if err := os.MkdirAll(filepath.Dir(srcFile), 0o755); err != nil {
		t.Fatalf("mkdir source nested dir: %v", err)
	}
	content := []byte("nested")
	if err := os.WriteFile(srcFile, content, 0o644); err != nil {
		t.Fatalf("write source file: %v", err)
	}

	copyPayload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"a"},
		"srcPath":     "",
		"dstPath":     "stage",
	}
	copyW := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-copy", copyPayload, serverFilesBatchCopyHandler)
	if copyW.Code != http.StatusOK {
		t.Fatalf("copy status=%d body=%s", copyW.Code, copyW.Body.String())
	}
	var copyResp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(copyW.Body).Decode(&copyResp); err != nil {
		t.Fatalf("decode copy response: %v", err)
	}
	if copyResp.SuccessCount != 1 {
		t.Fatalf("expected 1 copied item, got %d, errors=%v", copyResp.SuccessCount, copyResp.Errors)
	}

	copiedPath := filepath.Join(dataDir, "files", "stage", "a", "b.txt")
	gotCopied, err := os.ReadFile(copiedPath)
	if err != nil {
		t.Fatalf("read copied nested file: %v", err)
	}
	if !bytes.Equal(gotCopied, content) {
		t.Fatalf("copied nested content mismatch")
	}

	movePayload := map[string]any{
		"srcCategory": "files",
		"dstCategory": "reports",
		"items":       []string{"a"},
		"srcPath":     "stage",
		"dstPath":     "final",
	}
	moveW := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-move", movePayload, serverFilesBatchMoveHandler)
	if moveW.Code != http.StatusOK {
		t.Fatalf("move status=%d body=%s", moveW.Code, moveW.Body.String())
	}
	var moveResp struct {
		SuccessCount int      `json:"successCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(moveW.Body).Decode(&moveResp); err != nil {
		t.Fatalf("decode move response: %v", err)
	}
	if moveResp.SuccessCount != 1 {
		t.Fatalf("expected 1 moved item, got %d, errors=%v", moveResp.SuccessCount, moveResp.Errors)
	}

	if _, err := os.Stat(copiedPath); !os.IsNotExist(err) {
		t.Fatalf("expected moved source to be removed")
	}
	movedPath := filepath.Join(dataDir, "reports", "final", "a", "b.txt")
	gotMoved, err := os.ReadFile(movedPath)
	if err != nil {
		t.Fatalf("read moved nested file: %v", err)
	}
	if !bytes.Equal(gotMoved, content) {
		t.Fatalf("moved nested content mismatch")
	}
}

func TestServerFilesBatchCopyHandler_SupportsLegacyCategoryField(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	srcFile := filepath.Join(dataDir, "scripts", "legacy.txt")
	if err := os.WriteFile(srcFile, []byte("legacy"), 0o644); err != nil {
		t.Fatalf("write source file: %v", err)
	}

	payload := map[string]any{
		"category": "scripts",
		"items":    []string{"legacy.txt"},
		"srcPath":  "",
		"dstPath":  "copied",
	}
	w := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-copy", payload, serverFilesBatchCopyHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("copy status=%d body=%s", w.Code, w.Body.String())
	}

	dstFile := filepath.Join(dataDir, "scripts", "copied", "legacy.txt")
	if _, err := os.Stat(dstFile); err != nil {
		t.Fatalf("legacy mode copy failed: %v", err)
	}
}

func TestServerFilesBatchCopyHandler_PartialSuccess(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	okFile := filepath.Join(dataDir, "scripts", "ok.txt")
	if err := os.WriteFile(okFile, []byte("ok"), 0o644); err != nil {
		t.Fatalf("write ok file: %v", err)
	}

	payload := map[string]any{
		"srcCategory": "scripts",
		"dstCategory": "files",
		"items":       []string{"ok.txt", "missing.txt", "../scripts2/evil.txt"},
		"srcPath":     "",
		"dstPath":     "",
	}
	w := performJSONHandlerRequest(t, "POST", "/api/server-files/batch-copy", payload, serverFilesBatchCopyHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("copy status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Success      bool     `json:"success"`
		SuccessCount int      `json:"successCount"`
		TotalCount   int      `json:"totalCount"`
		Errors       []string `json:"errors"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Success {
		t.Fatalf("expected partial failure")
	}
	if resp.SuccessCount != 1 || resp.TotalCount != 3 {
		t.Fatalf("unexpected counts: success=%d total=%d", resp.SuccessCount, resp.TotalCount)
	}
	if len(resp.Errors) != 2 {
		t.Fatalf("expected 2 errors, got %d (%v)", len(resp.Errors), resp.Errors)
	}

	copiedOk := filepath.Join(dataDir, "files", "ok.txt")
	if _, err := os.Stat(copiedOk); err != nil {
		t.Fatalf("expected ok item to be copied: %v", err)
	}
}

func TestServerFilesUploadHandler_AcceptsFakepathFilename(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("category", "scripts"); err != nil {
		t.Fatalf("write category field: %v", err)
	}
	if err := writer.WriteField("path", "nested"); err != nil {
		t.Fatalf("write path field: %v", err)
	}
	part, err := writer.CreateFormFile("file", "C:\\fakepath\\abc.lua")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("print('ok')")); err != nil {
		t.Fatalf("write form file content: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/server-files/upload", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	serverFilesUploadHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("upload status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Filename string `json:"filename"`
		Path     string `json:"path"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if resp.Filename != "abc.lua" {
		t.Fatalf("unexpected filename: %q", resp.Filename)
	}
	if resp.Path != filepath.Join("nested", "abc.lua") {
		t.Fatalf("unexpected path: %q", resp.Path)
	}

	savedPath := filepath.Join(dataDir, "scripts", "nested", "abc.lua")
	data, err := os.ReadFile(savedPath)
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(data) != "print('ok')" {
		t.Fatalf("unexpected uploaded content: %q", string(data))
	}
}

func TestServerFilesCreateHandler_AllowsUnicodeAndSpaceName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	name := "测试 文件(1).lua"
	content := "print('unicode')"
	payload := map[string]any{
		"category": "scripts",
		"path":     "",
		"name":     name,
		"type":     "file",
		"content":  content,
	}
	if w := performJSONHandlerRequest(t, "POST", "/api/server-files/create", payload, serverFilesCreateHandler); w.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", w.Code, w.Body.String())
	}

	readURL := "/api/server-files/read?category=scripts&path=" + url.QueryEscape(name)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", readURL, nil)
	serverFilesReadHandler(c)

	if w.Code != http.StatusOK {
		t.Fatalf("read status=%d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode read response: %v", err)
	}
	if resp.Content != content {
		t.Fatalf("unexpected content: %q", resp.Content)
	}
}
