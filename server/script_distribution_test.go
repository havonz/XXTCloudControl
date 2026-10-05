package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestScriptDistributionPreservesConfigurationAndTransferBeforeStart(t *testing.T) {
	for _, test := range []struct {
		name    string
		handler func(*gin.Context)
		starts  bool
	}{
		{name: "send", handler: scriptsSendHandler},
		{name: "send-and-start", handler: scriptsSendAndStartHandler, starts: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			dataDir := setupFileHandlersTestDataDir(t)
			resetScriptPackageCacheForTest()
			resetScriptStartSessionsForTest()
			resetTransferTokensForTest()
			previousTimeout := scriptStartWaitTimeout
			scriptStartWaitTimeout = 0
			t.Cleanup(func() {
				scriptStartWaitTimeout = previousTimeout
				resetScriptPackageCacheForTest()
				resetScriptStartSessionsForTest()
				resetTransferTokensForTest()
			})
			writeScriptMainJSONForValidationTest(t, dataDir, "bundle", `{
				"UI":[{"type":"Edit","caption":"mode","nonEmpty":true}],
				"Config":{"mode":"global"}
			}`)
			largePath := filepath.Join(dataDir, "scripts", "bundle", "asset.bin")
			if err := os.WriteFile(largePath, make([]byte, scriptLargeFileThreshold), 0600); err != nil {
				t.Fatal(err)
			}
			deviceGroupsMu.Lock()
			previousGroups := deviceGroups
			deviceGroups = []GroupInfo{{ID: "group", DeviceIDs: []string{"device-http-bin"}}}
			deviceGroupsMu.Unlock()
			groupScriptConfigsMu.Lock()
			previousConfigs := groupScriptConfigs
			groupScriptConfigs = map[string]map[string]map[string]interface{}{"group": {"bundle": {"mode": "group override"}}}
			groupScriptConfigsMu.Unlock()
			t.Cleanup(func() {
				deviceGroupsMu.Lock()
				deviceGroups = previousGroups
				deviceGroupsMu.Unlock()
				groupScriptConfigsMu.Lock()
				groupScriptConfigs = previousConfigs
				groupScriptConfigsMu.Unlock()
			})
			writes := make(chan recordedWebSocketWrite, 4)
			conn := &SafeConn{writeMessageHook: func(typ int, payload []byte) error {
				writes <- recordedWebSocketWrite{messageType: typ, data: payload}
				return nil
			}}
			setupHTTPBinProxyTestState(t, nil, conn)
			response := performJSONHandlerRequest(t, http.MethodPost, "/api/scripts/"+test.name, map[string]any{
				"devices": []string{"device-http-bin"}, "name": "bundle", "selectedGroups": []string{"group"},
				"serverBaseUrl": "http://example.test",
			}, test.handler)
			if response.Code != http.StatusOK {
				t.Fatalf("distribution failed: %d %s", response.Code, response.Body.String())
			}
			var responseBody struct {
				FilesSent int `json:"files_sent"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &responseBody); err != nil || responseBody.FilesSent != 3 {
				t.Fatalf("file count changed: %+v, %v", responseBody, err)
			}
			var fetch map[string]interface{}
			configSeen := false
			for i := 0; i < 3; i++ {
				var message Message
				if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &message); err != nil {
					t.Fatal(err)
				}
				body := message.Body.(map[string]interface{})
				if i == 2 {
					if message.Type != "transfer/fetch" || body["targetPath"] != "asset.bin" {
						t.Fatalf("large file transfer changed: %+v", message)
					}
					fetch = body
					continue
				}
				if message.Type != "file/put" {
					t.Fatalf("small file was not sent before transfer: %+v", message)
				}
				if body["path"] == "lua/scripts/main.json" {
					data, err := base64.StdEncoding.DecodeString(body["data"].(string))
					if err != nil {
						t.Fatal(err)
					}
					var main map[string]interface{}
					if err := json.Unmarshal(data, &main); err != nil {
						t.Fatal(err)
					}
					if main["Config"].(map[string]interface{})["mode"] != "group override" {
						t.Fatalf("group config was not applied: %s", data)
					}
					configSeen = true
				}
			}
			if !configSeen || fetch["totalBytes"] != float64(scriptLargeFileThreshold) || fetch["timeout"] != float64(defaultTransferTimeoutSec) {
				t.Fatalf("distribution metadata changed: config=%t fetch=%v", configSeen, fetch)
			}
			transferURL, err := url.Parse(fetch["url"].(string))
			if err != nil {
				t.Fatal(err)
			}
			transferTokensMu.RLock()
			token := transferTokens[filepath.Base(transferURL.Path)]
			transferTokensMu.RUnlock()
			hash, err := calculateFileMD5(largePath)
			if err != nil || token == nil || token.FilePath != largePath || token.MD5 != hash || fetch["md5"] != hash || !token.OneTime {
				t.Fatalf("download token changed: %+v, %v", token, err)
			}
			if !test.starts {
				if hasPendingScriptStart("device-http-bin") {
					t.Fatal("send-only operation created a script start session")
				}
				if requestID, _ := fetch["requestId"].(string); requestID == "" {
					t.Fatal("send-only transfer has no completion correlation ID")
				}
				return
			}
			requestID, _ := fetch["requestId"].(string)
			if requestID == "" || !hasPendingScriptStart("device-http-bin") {
				t.Fatal("script did not wait for the large transfer")
			}
			handleTransferFetchCompletionForScriptStart("device-http-bin", map[string]interface{}{
				"requestId": requestID, "success": true,
			})
			var run Message
			if err := json.Unmarshal(receiveWebSocketWrite(t, writes).data, &run); err != nil || run.Type != "script/run" || run.Body.(map[string]interface{})["name"] != "main.lua" {
				t.Fatalf("script start changed: %+v, %v", run, err)
			}
			if !waitUntil(time.Second, time.Millisecond, func() bool {
				return len(snapshotScriptStartStates([]string{"device-http-bin"})) == 0
			}) {
				t.Fatal("completed script start session was retained")
			}
		})
	}
}
