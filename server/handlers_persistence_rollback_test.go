package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupPersistenceWritableDataDir(t *testing.T) string {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dataDir := t.TempDir()
	prevDataDir := serverConfig.DataDir
	serverConfig.DataDir = dataDir
	t.Cleanup(func() { serverConfig.DataDir = prevDataDir })

	return dataDir
}

func setupPersistenceBrokenDataDir(t *testing.T) string {
	t.Helper()

	baseDir := setupPersistenceWritableDataDir(t)
	brokenPath := filepath.Join(baseDir, "not-a-dir")
	if err := os.WriteFile(brokenPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("create broken data dir marker failed: %v", err)
	}

	serverConfig.DataDir = brokenPath
	return brokenPath
}

func performJSONRequestWithGroupID(t *testing.T, method, target, groupID string, payload any, handler func(*gin.Context)) *httptest.ResponseRecorder {
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
	c.Params = gin.Params{{Key: "id", Value: groupID}}
	c.Request = httptest.NewRequest(method, target, bytes.NewReader(reqBody))
	if payload != nil {
		c.Request.Header.Set("Content-Type", "application/json")
	}
	handler(c)
	return w
}

func TestGroupsCreateHandler_RollsBackMemoryWhenSaveFails(t *testing.T) {
	setupPersistenceBrokenDataDir(t)

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)
	deviceGroups = []GroupInfo{{ID: "g0", Name: "base", DeviceIDs: []string{"d1"}, SortOrder: 0}}
	expectedGroups := cloneGroupInfos(deviceGroups)
	deviceGroupsMu.Unlock()
	t.Cleanup(func() {
		deviceGroupsMu.Lock()
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
	})

	w := performJSONHandlerRequest(t, http.MethodPost, "/api/groups", map[string]any{"name": "new-group"}, groupsCreateHandler)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d body=%s", w.Code, w.Body.String())
	}

	deviceGroupsMu.RLock()
	gotGroups := cloneGroupInfos(deviceGroups)
	deviceGroupsMu.RUnlock()
	if !reflect.DeepEqual(gotGroups, expectedGroups) {
		t.Fatalf("deviceGroups changed after failed save, expected=%v got=%v", expectedGroups, gotGroups)
	}
}

func TestGroupsCreateHandler_SucceedsWhenSaveWorks(t *testing.T) {
	setupPersistenceWritableDataDir(t)

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)
	deviceGroups = nil
	deviceGroupsMu.Unlock()
	t.Cleanup(func() {
		deviceGroupsMu.Lock()
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
	})

	w := performJSONHandlerRequest(t, http.MethodPost, "/api/groups", map[string]any{"name": "new-group"}, groupsCreateHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}

	deviceGroupsMu.RLock()
	groupCount := len(deviceGroups)
	groupName := ""
	if groupCount > 0 {
		groupName = deviceGroups[0].Name
	}
	deviceGroupsMu.RUnlock()
	if groupCount != 1 || groupName != "new-group" {
		t.Fatalf("unexpected groups state, count=%d name=%q", groupCount, groupName)
	}

	if _, err := os.Stat(getGroupsFilePath()); err != nil {
		t.Fatalf("groups file not persisted: %v", err)
	}
}

func TestGroupsSetScriptConfigHandler_RollsBackMemoryWhenSaveFails(t *testing.T) {
	setupPersistenceBrokenDataDir(t)

	groupScriptConfigsMu.Lock()
	backupConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigs = map[string]map[string]map[string]interface{}{
		"g1": {"old.lua": {"k": "v"}},
	}
	expectedConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigsMu.Unlock()
	t.Cleanup(func() {
		groupScriptConfigsMu.Lock()
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
	})

	w := performJSONRequestWithGroupID(
		t,
		http.MethodPost,
		"/api/groups/g1/script-config",
		"g1",
		map[string]any{
			"scriptPath": "new.lua",
			"config":     map[string]any{"foo": "bar"},
		},
		groupsSetScriptConfigHandler,
	)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d body=%s", w.Code, w.Body.String())
	}

	groupScriptConfigsMu.RLock()
	gotConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigsMu.RUnlock()
	if !reflect.DeepEqual(gotConfigs, expectedConfigs) {
		t.Fatalf("groupScriptConfigs changed after failed save, expected=%v got=%v", expectedConfigs, gotConfigs)
	}
}

func TestGroupsDeleteScriptConfigHandler_RollsBackMemoryWhenSaveFails(t *testing.T) {
	setupPersistenceBrokenDataDir(t)

	groupScriptConfigsMu.Lock()
	backupConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigs = map[string]map[string]map[string]interface{}{
		"g1": {"old.lua": {"k": "v"}},
	}
	expectedConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigsMu.Unlock()
	t.Cleanup(func() {
		groupScriptConfigsMu.Lock()
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
	})

	w := performJSONRequestWithGroupID(
		t,
		http.MethodDelete,
		"/api/groups/g1/script-config?script=old.lua",
		"g1",
		nil,
		groupsDeleteScriptConfigHandler,
	)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d body=%s", w.Code, w.Body.String())
	}

	groupScriptConfigsMu.RLock()
	gotConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	groupScriptConfigsMu.RUnlock()
	if !reflect.DeepEqual(gotConfigs, expectedConfigs) {
		t.Fatalf("groupScriptConfigs changed after failed save, expected=%v got=%v", expectedConfigs, gotConfigs)
	}
}

func TestSetAppSettingsHandler_RollsBackMemoryWhenSaveFails(t *testing.T) {
	setupPersistenceBrokenDataDir(t)

	appSettingsMu.Lock()
	backupSettings := appSettings
	appSettings = AppSettings{
		SelectedScript:   "old.lua",
		GroupMultiSelect: true,
		GroupSortLocked:  true,
	}
	expectedSettings := appSettings
	appSettingsMu.Unlock()
	t.Cleanup(func() {
		appSettingsMu.Lock()
		appSettings = backupSettings
		appSettingsMu.Unlock()
	})

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/app-settings",
		map[string]any{
			"selectedScript":   "new.lua",
			"groupMultiSelect": false,
			"groupSortLocked":  false,
		},
		setAppSettingsHandler,
	)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d body=%s", w.Code, w.Body.String())
	}

	appSettingsMu.RLock()
	gotSettings := appSettings
	appSettingsMu.RUnlock()
	if !reflect.DeepEqual(gotSettings, expectedSettings) {
		t.Fatalf("appSettings changed after failed save, expected=%v got=%v", expectedSettings, gotSettings)
	}
}

func TestSetAppSettingsHandler_SucceedsWhenSaveWorks(t *testing.T) {
	setupPersistenceWritableDataDir(t)

	appSettingsMu.Lock()
	backupSettings := appSettings
	appSettings = AppSettings{}
	appSettingsMu.Unlock()
	t.Cleanup(func() {
		appSettingsMu.Lock()
		appSettings = backupSettings
		appSettingsMu.Unlock()
	})

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/app-settings",
		map[string]any{
			"selectedScript":   "new.lua",
			"groupMultiSelect": true,
			"groupSortLocked":  true,
		},
		setAppSettingsHandler,
	)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}

	appSettingsMu.RLock()
	gotSettings := appSettings
	appSettingsMu.RUnlock()
	if gotSettings.SelectedScript != "new.lua" || !gotSettings.GroupMultiSelect || !gotSettings.GroupSortLocked {
		t.Fatalf("unexpected app settings: %+v", gotSettings)
	}

	if _, err := os.Stat(getAppSettingsFilePath()); err != nil {
		t.Fatalf("app settings file not persisted: %v", err)
	}
}
