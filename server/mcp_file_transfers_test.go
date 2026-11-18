package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPFileTransfersOverHTTP(t *testing.T) {
	dir := setupTempTransferCleanupTest(t)
	writes := make(chan recordedWebSocketWrite, 2)
	device := &SafeConn{writeMessageHook: func(kind int, data []byte) error {
		writes <- recordedWebSocketWrite{messageType: kind, data: data}
		return nil
	}}
	setupHTTPBinProxyTestState(t, nil, device)
	t.Cleanup(func() { _ = device.Close() })

	const bearer = "local-file-transfer-test"
	digest := sha256.Sum256([]byte(bearer))
	if err := os.WriteFile(filepath.Join(dir, "mcp-token.sha256"), []byte(hex.EncodeToString(digest[:])), 0600); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(corsMiddleware(), apiAuthMiddleware())
	if err := registerMCP(router); err != nil {
		t.Fatal(err)
	}
	router.PUT("/api/transfer/upload/:token", transferUploadHandler)
	router.GET("/api/transfer/download/:token", transferDownloadHandler)
	server := httptest.NewServer(router)
	defer server.Close()
	ctx := t.Context()
	client := mcp.NewClient(&mcp.Implementation{Name: "file-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTestTransport(bearer)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	link := func(tool string, args fields) fields {
		t.Helper()
		reply, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tool_call", Arguments: fields{"tool": tool, "args": args}})
		if err != nil || reply.IsError || len(reply.Content) != 1 {
			t.Fatalf("%s failed: %v", tool, err)
		}
		var result struct {
			OK   bool
			Data fields
		}
		if err := json.Unmarshal([]byte(reply.Content[0].(*mcp.TextContent).Text), &result); err != nil || !result.OK {
			t.Fatalf("%s returned an invalid result", tool)
		}
		raw, _ := result.Data["url"].(string)
		if !strings.HasPrefix(raw, server.URL+"/api/transfer/") || result.Data["expiresAt"] == nil {
			t.Fatalf("%s did not issue a link on the client origin", tool)
		}
		return result.Data
	}
	transfer := func(method, rawURL string, body io.Reader, status int) []byte {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil || resp.StatusCode != status {
			t.Fatalf("%s received HTTP %d, wanted %d: %v", method, resp.StatusCode, status, err)
		}
		return data
	}

	// 超过 MCP 请求体上限，确保调用方始终能从返回的地址直接传原始字节。
	payload := bytes.Repeat([]byte{0xff, 0x00, 0xa5, 0x1b}, 2<<20)
	name := fields{"root": "files", "path": "bin/roundtrip.dat"}
	up := link("backend_file_upload_url", name)
	if up["method"] != http.MethodPut {
		t.Fatal("expected PUT")
	}
	transfer(http.MethodPut, up["url"].(string), bytes.NewReader(payload), http.StatusOK)
	transfer(http.MethodPut, up["url"].(string), nil, http.StatusNotFound)
	down := link("backend_file_download_url", name)
	if down["method"] != http.MethodGet || !bytes.Equal(transfer(http.MethodGet, down["url"].(string), nil, http.StatusOK), payload) {
		t.Fatal("cloud file differs after round trip")
	}
	transfer(http.MethodGet, down["url"].(string), nil, http.StatusNotFound)

	target := filepath.Join(dir, "reports", "device.dat")
	if err := os.WriteFile(target, []byte("previous report"), 0644); err != nil {
		t.Fatal(err)
	}
	pullArgs := fields{"udid": "device-http-bin", "sourcePath": "/res/report.dat", "root": "reports", "targetPath": "device.dat"}
	pull := link("backend_pull_file_from_device", pullArgs)
	if pull["state"] != "queued" || pull["method"] != http.MethodGet || pull["token"] != nil {
		t.Fatal("device pull must return only the client download grant and its metadata")
	}
	var command struct {
		Type string
		Body struct{ URL, SourcePath, SavePath, RequestID string }
	}
	if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &command); err != nil || command.Type != "transfer/send" || command.Body.SourcePath != "res/report.dat" || command.Body.SavePath != "device.dat" {
		t.Fatal("device did not receive the file request")
	}
	deviceURL, err := url.Parse(command.Body.URL)
	if err != nil || !strings.HasPrefix(deviceURL.Path, "/api/transfer/upload/") {
		t.Fatal("device did not receive a separate upload grant")
	}
	get := pull["url"].(string)
	transfer(http.MethodGet, get, nil, http.StatusConflict)
	// 模拟设备经自身网络到达云控，测试监听器仅绑定本机回环地址。
	transfer(http.MethodPut, server.URL+deviceURL.Path, bytes.NewReader(payload), http.StatusOK)
	if !bytes.Equal(transfer(http.MethodGet, get, nil, http.StatusOK), payload) {
		t.Fatal("device download differs from its upload")
	}
	if info, err := os.Stat(target); err != nil || info.Size() != int64(len(payload)) {
		t.Fatal("device file was not retained at the requested destination")
	}

	pull = link("backend_pull_file_from_device", pullArgs)
	if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &command); err != nil {
		t.Fatal(err)
	}
	completeDeviceFileTransfer("device-http-bin", "upload", fields{"requestId": command.Body.RequestID, "success": false})
	transfer(http.MethodGet, pull["url"].(string), nil, http.StatusGone)
}

func TestMCPFileGrantLifetimeAndRoot(t *testing.T) {
	dir := setupTempTransferCleanupTest(t)
	origin := mcpRequestInfo{clientBaseURL: "http://localhost", fileLinks: t.Context()}
	issue := func(kind string) string {
		t.Helper()
		file, err := prepareMCPFileTransfer(origin, kind, "files", "sub/data.bin")
		if err != nil {
			t.Fatal(err)
		}
		transferTokensMu.Lock()
		transferTokens[kind] = file
		transferTokensMu.Unlock()
		return kind
	}
	sub := filepath.Join(dir, "files", "sub")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "data.bin"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	up, down := issue("upload"), issue("download")
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "data.bin")
	if err := os.WriteFile(outsideFile, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(sub, filepath.Join(dir, "files", "old")); err != nil {
		t.Fatal(err)
	}
	createSymlinkOrSkip(t, outside, sub)
	response := httptest.NewRecorder()
	requestTransferDownload(down, response)
	if response.Code == http.StatusOK || requestTransferUpload(up, strings.NewReader("data"), 4).Code == http.StatusOK {
		t.Fatal("a link accepted a path outside the managed root")
	}
	if contents, err := os.ReadFile(outsideFile); err != nil || string(contents) != "outside" {
		t.Fatal("upload changed the file outside the managed root")
	}
	if err := os.Remove(sub); err != nil {
		t.Fatal(err)
	}
	up = issue("upload")
	transferTokensMu.Lock()
	transferTokens[up].ExpiresAt = time.Now().Add(-time.Second)
	transferTokensMu.Unlock()
	if w := requestTransferUpload(up, nil, 0); w.Code != http.StatusGone {
		t.Fatal("expired file link accepted a request")
	}
}
