package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeScriptMainJSONForValidationTest(t *testing.T, dataDir string, scriptName string, content string) {
	t.Helper()
	scriptDir := filepath.Join(dataDir, "scripts", scriptName, "lua", "scripts")
	if err := os.MkdirAll(scriptDir, 0o755); err != nil {
		t.Fatalf("mkdir script dir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scriptDir, "main.json"), []byte(content), 0o644); err != nil {
		t.Fatalf("write main.json failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(scriptDir, "main.lua"), []byte("-- test"), 0o644); err != nil {
		t.Fatalf("write main.lua failed: %v", err)
	}
}

func TestScriptsSendRejectsEmptyNonEmptyEditConfig(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	writeScriptMainJSONForValidationTest(t, dataDir, "demo", `{
		"UI":[{"type":"Edit","caption":"mode","nonEmpty":true}],
		"Config":{"mode":""}
	}`)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "demo",
		},
		scriptsSendHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "mode") {
		t.Fatalf("expected error to include field caption, got %s", w.Body.String())
	}
}

func TestScriptsSendAndStartRejectsGroupOverrideConfig(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	writeScriptMainJSONForValidationTest(t, dataDir, "demo", `{
		"UI":[{"type":"Edit","caption":"mode","nonEmpty":true}],
		"Config":{"mode":"global"}
	}`)

	deviceGroupsMu.Lock()
	groupScriptConfigsMu.Lock()
	backupGroups := cloneDeviceGroups(deviceGroups)
	backupConfigs := cloneGroupScriptConfigs(groupScriptConfigs)
	deviceGroups = []GroupInfo{{ID: "g1", Name: "group", DeviceIDs: []string{"device-1"}, SortOrder: 1}}
	groupScriptConfigs = map[string]map[string]map[string]interface{}{
		"g1": {"demo": {"mode": ""}},
	}
	groupScriptConfigsMu.Unlock()
	deviceGroupsMu.Unlock()
	t.Cleanup(func() {
		deviceGroupsMu.Lock()
		groupScriptConfigsMu.Lock()
		deviceGroups = backupGroups
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
		deviceGroupsMu.Unlock()
	})

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start",
		map[string]any{
			"devices":        []string{"device-1"},
			"name":           "demo",
			"selectedGroups": []string{"g1"},
		},
		scriptsSendAndStartHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptsSendAndStartFallsBackToEditDefaultText(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	writeScriptMainJSONForValidationTest(t, dataDir, "demo", `{
		"UI":[{"type":"Edit","caption":"mode","text":"abc","validationRegex":"[a-z]+"}],
		"Config":{}
	}`)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "demo",
		},
		scriptsSendAndStartHandler,
	)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptsSendAndStartValidatesEditableComboBoxText(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	writeScriptMainJSONForValidationTest(t, dataDir, "demo", `{
		"UI":[{"type":"ComboBox","caption":"mode","item":["123"],"canEdit":true,"validationRegex":"[0-9]+","patternMessage":"mode 必须是数字"}],
		"Config":{"mode":{"select":0,"text":"abc"}}
	}`)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "demo",
		},
		scriptsSendAndStartHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "mode 必须是数字") {
		t.Fatalf("expected custom pattern message, got %s", w.Body.String())
	}
}

func TestScriptsSendAndStartValidatesEditableComboBoxSelectedOption(t *testing.T) {
	dataDir := setupFileHandlersTestDataDir(t)
	writeScriptMainJSONForValidationTest(t, dataDir, "demo", `{
		"UI":[{"type":"ComboBox","caption":"mode","item":["abc","123"],"canEdit":true,"validationRegex":"[0-9]+"}],
		"Config":{"mode":2}
	}`)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "demo",
		},
		scriptsSendAndStartHandler,
	)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}
}
