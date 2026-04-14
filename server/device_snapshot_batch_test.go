package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func setupSnapshotBatchDeviceState(t *testing.T, links map[string]*SafeConn, table map[string]interface{}, linkMap map[*SafeConn]string) {
	t.Helper()

	mu.Lock()
	linksBackup := deviceLinks
	tableBackup := deviceTable
	linkMapBackup := deviceLinksMap
	deviceLinks = links
	deviceTable = table
	deviceLinksMap = linkMap
	mu.Unlock()

	t.Cleanup(func() {
		mu.Lock()
		deviceLinks = linksBackup
		deviceTable = tableBackup
		deviceLinksMap = linkMapBackup
		mu.Unlock()
	})
}

func resetInternalHTTPBinState(t *testing.T) {
	t.Helper()

	internalHTTPBinMu.Lock()
	requestsBackup := internalHTTPBinRequests
	ignoredBackup := internalHTTPBinIgnored
	internalHTTPBinRequests = make(map[string]*internalHTTPBinRequestState)
	internalHTTPBinIgnored = make(map[string]time.Time)
	internalHTTPBinMu.Unlock()

	t.Cleanup(func() {
		internalHTTPBinMu.Lock()
		internalHTTPBinRequests = requestsBackup
		internalHTTPBinIgnored = ignoredBackup
		internalHTTPBinMu.Unlock()
	})
}

func TestSnapshotSaveBatchHandlerWritesScreenshotAndSanitizesPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupFileHandlersTestDataDir(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{"device-1": conn},
		map[string]interface{}{
			"device-1": map[string]interface{}{
				"system": map[string]interface{}{
					"name": "Alpha/Beta:One",
					"ip":   "10.0.0.1:46952",
				},
			},
		},
		map[*SafeConn]string{},
	)

	originalCapture := captureDeviceScreenshot
	captureDeviceScreenshot = func(udid string, timeout time.Duration) ([]byte, error) {
		if udid != "device-1" {
			t.Fatalf("unexpected udid: %s", udid)
		}
		return []byte("png-data"), nil
	}
	t.Cleanup(func() {
		captureDeviceScreenshot = originalCapture
	})

	w := performJSONHandlerRequest(t, http.MethodPost, "/api/devices/snapshot-save-batch", map[string]any{
		"deviceIds": []string{"device-1"},
	}, snapshotSaveBatchHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		OK      bool                      `json:"ok"`
		Results []snapshotSaveBatchResult `json:"results"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.OK || len(resp.Results) != 1 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if !resp.Results[0].OK {
		t.Fatalf("expected success result, got %+v", resp.Results[0])
	}
	expectedPrefix := "files/snapshots/Alpha_Beta_One-10.0.0.1_46952/"
	if !strings.HasPrefix(resp.Results[0].Path, expectedPrefix) {
		t.Fatalf("unexpected path: %s", resp.Results[0].Path)
	}

	data, err := os.ReadFile(filepath.Join(serverConfig.DataDir, filepath.FromSlash(resp.Results[0].Path)))
	if err != nil {
		t.Fatalf("read saved file: %v", err)
	}
	if !bytes.Equal(data, []byte("png-data")) {
		t.Fatalf("unexpected file content: %q", string(data))
	}
}

func TestSnapshotSaveBatchHandlerReturnsPerDeviceFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupFileHandlersTestDataDir(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{"device-online": conn},
		map[string]interface{}{
			"device-online": map[string]interface{}{
				"system": map[string]interface{}{
					"name": "Online",
					"ip":   "10.0.0.2",
				},
			},
		},
		map[*SafeConn]string{},
	)

	originalCapture := captureDeviceScreenshot
	captureDeviceScreenshot = func(udid string, timeout time.Duration) ([]byte, error) {
		if udid == "device-online" {
			return nil, errors.New("capture failed")
		}
		return []byte("png-data"), nil
	}
	t.Cleanup(func() {
		captureDeviceScreenshot = originalCapture
	})

	w := performJSONHandlerRequest(t, http.MethodPost, "/api/devices/snapshot-save-batch", map[string]any{
		"deviceIds": []string{"device-online", "device-offline"},
	}, snapshotSaveBatchHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Results []snapshotSaveBatchResult `json:"results"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("unexpected results length: %d", len(resp.Results))
	}

	got := make(map[string]snapshotSaveBatchResult, len(resp.Results))
	for _, item := range resp.Results {
		got[item.UDID] = item
	}

	if got["device-online"].OK || got["device-online"].Error != "capture failed" {
		t.Fatalf("unexpected online result: %+v", got["device-online"])
	}
	if got["device-offline"].OK || got["device-offline"].Error != "device is offline" {
		t.Fatalf("unexpected offline result: %+v", got["device-offline"])
	}
}

func TestInternalHTTPBinRequestCollectsChunksAndCompletes(t *testing.T) {
	resetInternalHTTPBinState(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-1"},
	)

	requestID := "00112233445566778899aabbccddeeff"
	req := registerInternalHTTPBinRequest(requestID, "device-1")
	firstChunk := bytes.Repeat([]byte("a"), internalHTTPBinChunkSize)
	secondChunk := []byte("bc")

	if !handleInternalHTTPResponseBinChunk(conn, requestID, 0, 2, firstChunk) {
		t.Fatalf("expected first chunk to be consumed")
	}
	if !handleInternalHTTPResponseBinChunk(conn, requestID, 1, 2, secondChunk) {
		t.Fatalf("expected second chunk to be consumed")
	}

	select {
	case <-req.Done:
		t.Fatalf("request should wait for metadata before completion")
	default:
	}

	if !handleInternalHTTPResponseBinMeta(conn, Message{
		Type: "http/response-bin",
		Body: map[string]interface{}{
			"requestId":  requestID,
			"statusCode": 200,
			"bodySize":   internalHTTPBinChunkSize + len(secondChunk),
		},
	}) {
		t.Fatalf("expected metadata to be consumed")
	}

	select {
	case <-req.Done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for internal request completion")
	}

	if req.Result.StatusCode != 200 {
		t.Fatalf("unexpected status code: %d", req.Result.StatusCode)
	}
	expectedBody := append(append([]byte(nil), firstChunk...), secondChunk...)
	if !bytes.Equal(req.Result.Body, expectedBody) {
		t.Fatalf("unexpected body length: got=%d want=%d", len(req.Result.Body), len(expectedBody))
	}

	internalHTTPBinMu.Lock()
	_, active := internalHTTPBinRequests[requestID]
	_, ignored := internalHTTPBinIgnored[requestID]
	internalHTTPBinMu.Unlock()
	if active {
		t.Fatalf("request should be removed after completion")
	}
	if !ignored {
		t.Fatalf("request should leave an ignore tombstone after completion")
	}
}

func TestAbortInternalHTTPBinRequestsForDevice(t *testing.T) {
	resetInternalHTTPBinState(t)

	requestID := "ffeeddccbbaa99887766554433221100"
	req := registerInternalHTTPBinRequest(requestID, "device-2")

	abortInternalHTTPBinRequestsForDevice("device-2", "device disconnected")

	select {
	case <-req.Done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for request abort")
	}

	if req.Result.Error != "device disconnected" {
		t.Fatalf("unexpected abort error: %q", req.Result.Error)
	}

	internalHTTPBinMu.Lock()
	_, active := internalHTTPBinRequests[requestID]
	internalHTTPBinMu.Unlock()
	if active {
		t.Fatalf("request should be removed after abort")
	}
}

func TestHandleInternalHTTPResponseBinChunkIgnoresUnknownRequest(t *testing.T) {
	resetInternalHTTPBinState(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-3"},
	)

	requestID := "abcdefabcdefabcdefabcdefabcdefab"
	frame := buildInternalHTTPBinTestFrame(t, requestID, 0, 1, []byte("data"))
	gotReqID, seq, total, ok := parseBinaryHeader(frame)
	if !ok {
		t.Fatalf("expected valid test frame")
	}
	if gotReqID != requestID {
		t.Fatalf("unexpected request id: %s", gotReqID)
	}
	if handleInternalHTTPResponseBinChunk(conn, gotReqID, seq, total, frame[binaryHeaderSize:]) {
		t.Fatalf("unknown request should not be consumed")
	}
}

func TestInternalHTTPBinRequestRejectsOversizedBodyMeta(t *testing.T) {
	resetInternalHTTPBinState(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-4"},
	)

	requestID := "1234567890abcdef1234567890abcdef"
	req := registerInternalHTTPBinRequest(requestID, "device-4")

	if !handleInternalHTTPResponseBinMeta(conn, Message{
		Type: "http/response-bin",
		Body: map[string]interface{}{
			"requestId":  requestID,
			"statusCode": 200,
			"bodySize":   internalHTTPBinMaxBodySize + 1,
		},
	}) {
		t.Fatalf("expected oversized metadata to be consumed")
	}

	select {
	case <-req.Done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for oversized metadata rejection")
	}

	if req.Result.Error != "response body too large" {
		t.Fatalf("unexpected error: %q", req.Result.Error)
	}
}

func TestInternalHTTPBinRequestRejectsExcessiveChunkCount(t *testing.T) {
	resetInternalHTTPBinState(t)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-5"},
	)

	requestID := "fedcba0987654321fedcba0987654321"
	req := registerInternalHTTPBinRequest(requestID, "device-5")

	if !handleInternalHTTPResponseBinChunk(conn, requestID, 0, maxInternalHTTPBinChunksForBody(internalHTTPBinMaxBodySize)+1, []byte("boom")) {
		t.Fatalf("expected invalid chunk count to be consumed")
	}

	select {
	case <-req.Done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for invalid chunk count rejection")
	}

	if req.Result.Error != "response chunk count invalid" {
		t.Fatalf("unexpected error: %q", req.Result.Error)
	}
}

func buildInternalHTTPBinTestFrame(t *testing.T, requestID string, seq, total uint32, payload []byte) []byte {
	t.Helper()

	idBytes, err := hex.DecodeString(requestID)
	if err != nil {
		t.Fatalf("decode request id: %v", err)
	}
	if len(idBytes) != 16 {
		t.Fatalf("request id must be 16 bytes, got %d", len(idBytes))
	}

	frame := make([]byte, binaryHeaderSize+len(payload))
	copy(frame[:16], idBytes)
	binary.BigEndian.PutUint32(frame[16:20], seq)
	binary.BigEndian.PutUint32(frame[20:24], total)
	copy(frame[binaryHeaderSize:], payload)
	return frame
}
