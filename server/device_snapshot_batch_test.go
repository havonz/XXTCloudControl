package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
	captureDeviceScreenshot = func(udid, requestLanguage string, timeout time.Duration) ([]byte, error) {
		if udid != "device-1" {
			t.Fatalf("unexpected udid: %s", udid)
		}
		if requestLanguage != "" {
			t.Fatalf("unexpected request language: %s", requestLanguage)
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
	captureDeviceScreenshot = func(udid, requestLanguage string, timeout time.Duration) ([]byte, error) {
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

	if got["device-online"].OK || got["device-online"].Error != "截图失败" || got["device-online"].ErrorCode != "error.snapshot.failed" || got["device-online"].Detail != "capture failed" {
		t.Fatalf("unexpected online result: %+v", got["device-online"])
	}
	if got["device-offline"].OK || got["device-offline"].Error != "设备离线" || got["device-offline"].ErrorCode != "error.device.offline" || got["device-offline"].Detail != "" {
		t.Fatalf("unexpected offline result: %+v", got["device-offline"])
	}
}

func TestSnapshotSaveBatchHandlerPreservesDeviceLanguageFallbackSemantics(t *testing.T) {
	gin.SetMode(gin.TestMode)

	conn := &SafeConn{}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{"device-language": conn},
		map[string]interface{}{
			"device-language": map[string]interface{}{
				"system": map[string]interface{}{
					"name": "Language Device",
					"ip":   "10.0.0.3",
				},
			},
		},
		map[*SafeConn]string{},
	)

	capturedLanguages := make(chan string, 1)
	originalCapture := captureDeviceScreenshot
	captureDeviceScreenshot = func(udid, requestLanguage string, timeout time.Duration) ([]byte, error) {
		capturedLanguages <- requestLanguage
		return nil, errors.New("capture failed")
	}
	t.Cleanup(func() {
		captureDeviceScreenshot = originalCapture
	})

	body, err := json.Marshal(map[string]any{"deviceIds": []string{"device-language"}})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	tests := []struct {
		name           string
		target         string
		acceptLanguage string
		wantLanguage   string
	}{
		{
			name:         "missing language uses device fallback",
			target:       "/api/devices/snapshot-save-batch",
			wantLanguage: "",
		},
		{
			name:           "unknown language remains device scoped",
			target:         "/api/devices/snapshot-save-batch",
			acceptLanguage: "xx-YY;q=1",
			wantLanguage:   "xx-YY;q=1",
		},
		{
			name:           "malformed quality remains device scoped",
			target:         "/api/devices/snapshot-save-batch",
			acceptLanguage: "fr-FR;q=bogus",
			wantLanguage:   "fr-FR;q=bogus",
		},
		{
			name:           "mixed language negotiation remains intact",
			target:         "/api/devices/snapshot-save-batch",
			acceptLanguage: "xx-YY;q=1, ko-KR;q=0.5",
			wantLanguage:   "xx-YY;q=1, ko-KR;q=0.5",
		},
		{
			name:           "supported query locale takes precedence",
			target:         "/api/devices/snapshot-save-batch?locale=ja-JP",
			acceptLanguage: "fr-FR",
			wantLanguage:   "ja-JP",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, tc.target, bytes.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			if tc.acceptLanguage != "" {
				c.Request.Header.Set("Accept-Language", tc.acceptLanguage)
			}
			snapshotSaveBatchHandler(c)
			if w.Code != http.StatusOK {
				t.Fatalf("unexpected status %d: %s", w.Code, w.Body.String())
			}

			select {
			case got := <-capturedLanguages:
				if got != tc.wantLanguage {
					t.Fatalf("request language %q, expected %q", got, tc.wantLanguage)
				}
			case <-time.After(time.Second):
				t.Fatalf("timed out waiting for screenshot capture")
			}
		})
	}
}

func TestSnapshotSaveBatchHandlerKeepsLocalesRequestScoped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupFileHandlersTestDataDir(t)

	deviceIDs := []string{"fr-device-1", "fr-device-2", "de-device-1", "de-device-2"}
	links := make(map[string]*SafeConn, len(deviceIDs))
	table := make(map[string]interface{}, len(deviceIDs))
	for _, udid := range deviceIDs {
		links[udid] = &SafeConn{}
		table[udid] = map[string]interface{}{
			"system": map[string]interface{}{
				"name": udid,
				"ip":   "10.0.0.1",
			},
		}
	}
	setupSnapshotBatchDeviceState(t, links, table, map[*SafeConn]string{})

	type captureCall struct {
		udid   string
		locale string
	}
	captures := make(chan captureCall, len(deviceIDs))
	releaseCaptures := make(chan struct{})
	originalCapture := captureDeviceScreenshot
	captureDeviceScreenshot = func(udid, requestLanguage string, timeout time.Duration) ([]byte, error) {
		captures <- captureCall{udid: udid, locale: requestLanguage}
		<-releaseCaptures
		return []byte("png-data"), nil
	}
	t.Cleanup(func() {
		captureDeviceScreenshot = originalCapture
	})

	requestBodies := map[string][]byte{}
	for locale, ids := range map[string][]string{
		"fr-FR": {"fr-device-1", "fr-device-2"},
		"de-DE": {"de-device-1", "de-device-2"},
	} {
		body, err := json.Marshal(map[string]any{"deviceIds": ids})
		if err != nil {
			t.Fatalf("marshal %s request: %v", locale, err)
		}
		requestBodies[locale] = body
	}

	type handlerResult struct {
		locale string
		w      *httptest.ResponseRecorder
	}
	results := make(chan handlerResult, len(requestBodies))
	for locale, body := range requestBodies {
		locale := locale
		body := append([]byte(nil), body...)
		go func() {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/devices/snapshot-save-batch", bytes.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("Accept-Language", locale)
			snapshotSaveBatchHandler(c)
			results <- handlerResult{locale: locale, w: w}
		}()
	}

	calls := make([]captureCall, 0, len(deviceIDs))
	startedLocales := map[string]bool{}
	deadline := time.After(time.Second)
	for !startedLocales["fr-FR"] || !startedLocales["de-DE"] {
		select {
		case call := <-captures:
			calls = append(calls, call)
			startedLocales[call.locale] = true
		case <-deadline:
			t.Fatalf("timed out waiting for concurrent localized captures: %+v", calls)
		}
	}
	close(releaseCaptures)

	for i := 0; i < len(requestBodies); i++ {
		select {
		case result := <-results:
			if result.w.Code != http.StatusOK {
				t.Fatalf("%s request returned %d: %s", result.locale, result.w.Code, result.w.Body.String())
			}
			if got := result.w.Header().Get("Content-Language"); got != result.locale {
				t.Fatalf("%s request returned Content-Language %q", result.locale, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for localized batch response")
		}
	}

	for len(calls) < len(deviceIDs) {
		select {
		case call := <-captures:
			calls = append(calls, call)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for all localized captures: %+v", calls)
		}
	}
	for _, call := range calls {
		expectedLocale := "de-DE"
		if strings.HasPrefix(call.udid, "fr-") {
			expectedLocale = "fr-FR"
		}
		if call.locale != expectedLocale {
			t.Fatalf("device %s received locale %q, expected %q", call.udid, call.locale, expectedLocale)
		}
	}
}

func TestRequestDeviceHTTPBinForwardsHeadersUnchanged(t *testing.T) {
	resetInternalHTTPBinState(t)

	var forwardedHeaders map[string]string
	var conn *SafeConn
	conn = &SafeConn{writeMessageHook: func(_ int, payload []byte) error {
		var forwarded Message
		if err := json.Unmarshal(payload, &forwarded); err != nil {
			return err
		}
		body, err := decodeBodyMap(forwarded.Body)
		if err != nil {
			return err
		}
		requestID, ok := toString(body["requestId"])
		if !ok {
			return errors.New("forwarded request is missing requestId")
		}
		forwardedHeaders, ok = toMapStringString(body["headers"])
		if !ok {
			return errors.New("forwarded request has invalid headers")
		}
		if !handleInternalHTTPResponseBinMeta(conn, Message{
			Type: "http/response-bin",
			Body: map[string]interface{}{
				"requestId":  requestID,
				"statusCode": http.StatusNoContent,
				"bodySize":   0,
			},
		}) {
			return errors.New("forwarded response metadata was not consumed")
		}
		return nil
	}}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{"device-headers": conn},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-headers"},
	)

	response, err := requestDeviceHTTPBin(
		"device-headers",
		"GET",
		"/api/screen/snapshot",
		map[string]interface{}{"format": "png"},
		map[string]string{
			"Accept-Language": "pt-BR",
			"X-Test":          "preserved",
		},
		time.Second,
	)
	if err != nil {
		t.Fatalf("requestDeviceHTTPBin returned error: %v", err)
	}
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected response status: %d", response.StatusCode)
	}
	if forwardedHeaders["Accept-Language"] != "pt-BR" || forwardedHeaders["X-Test"] != "preserved" {
		t.Fatalf("headers were changed during forwarding: %+v", forwardedHeaders)
	}
}

func TestRequestDeviceScreenshotOmitsAcceptLanguageWhenUnspecified(t *testing.T) {
	resetInternalHTTPBinState(t)

	var forwardedHeaders map[string]string
	var conn *SafeConn
	conn = &SafeConn{writeMessageHook: func(_ int, payload []byte) error {
		var forwarded Message
		if err := json.Unmarshal(payload, &forwarded); err != nil {
			return err
		}
		body, err := decodeBodyMap(forwarded.Body)
		if err != nil {
			return err
		}
		requestID, ok := toString(body["requestId"])
		if !ok {
			return errors.New("forwarded request is missing requestId")
		}
		forwardedHeaders, ok = toMapStringString(body["headers"])
		if !ok {
			return errors.New("forwarded request has invalid headers")
		}
		chunk := []byte("png-data")
		if !handleInternalHTTPResponseBinChunk(conn, requestID, 0, 1, chunk) {
			return errors.New("forwarded response chunk was not consumed")
		}
		if !handleInternalHTTPResponseBinMeta(conn, Message{
			Type: "http/response-bin",
			Body: map[string]interface{}{
				"requestId":  requestID,
				"statusCode": http.StatusOK,
				"bodySize":   len(chunk),
			},
		}) {
			return errors.New("forwarded response metadata was not consumed")
		}
		return nil
	}}
	setupSnapshotBatchDeviceState(t,
		map[string]*SafeConn{"device-fallback": conn},
		map[string]interface{}{},
		map[*SafeConn]string{conn: "device-fallback"},
	)

	data, err := requestDeviceScreenshotViaHTTPBin("device-fallback", "  ", time.Second)
	if err != nil {
		t.Fatalf("requestDeviceScreenshotViaHTTPBin returned error: %v", err)
	}
	if !bytes.Equal(data, []byte("png-data")) {
		t.Fatalf("unexpected screenshot data: %q", data)
	}
	if _, exists := forwardedHeaders["Accept-Language"]; exists {
		t.Fatalf("unspecified language should not send Accept-Language: %+v", forwardedHeaders)
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
