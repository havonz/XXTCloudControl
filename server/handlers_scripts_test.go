package main

import (
	"reflect"
	"testing"
)

func cloneDeviceGroups(src []GroupInfo) []GroupInfo {
	out := make([]GroupInfo, len(src))
	for i := range src {
		out[i] = src[i]
		out[i].DeviceIDs = append([]string(nil), src[i].DeviceIDs...)
	}
	return out
}

func cloneGroupScriptConfigs(src map[string]map[string]map[string]interface{}) map[string]map[string]map[string]interface{} {
	out := make(map[string]map[string]map[string]interface{}, len(src))
	for groupID, scripts := range src {
		scriptsCopy := make(map[string]map[string]interface{}, len(scripts))
		for scriptName, cfg := range scripts {
			cfgCopy := make(map[string]interface{}, len(cfg))
			for k, v := range cfg {
				cfgCopy[k] = v
			}
			scriptsCopy[scriptName] = cfgCopy
		}
		out[groupID] = scriptsCopy
	}
	return out
}

func TestBuildDeviceScriptConfigIndexMatchesResolve(t *testing.T) {
	deviceGroupsMu.Lock()
	groupScriptConfigsMu.Lock()
	backupGroups := cloneDeviceGroups(deviceGroups)
	backupConfigs := cloneGroupScriptConfigs(groupScriptConfigs)

	deviceGroups = []GroupInfo{
		{ID: "g1", DeviceIDs: []string{"d1", "d2"}, SortOrder: 1},
		{ID: "g2", DeviceIDs: []string{"d2", "d3"}, SortOrder: 2},
		{ID: "g3", DeviceIDs: []string{"d3"}, SortOrder: 3},
	}
	groupScriptConfigs = map[string]map[string]map[string]interface{}{
		"g1": {"scriptA": {"shared": "g1", "a": "1"}},
		"g2": {"scriptA": {"shared": "g2", "b": "2"}},
		"g3": {"scriptB": {"c": "3"}},
	}
	groupScriptConfigsMu.Unlock()
	deviceGroupsMu.Unlock()

	defer func() {
		deviceGroupsMu.Lock()
		groupScriptConfigsMu.Lock()
		deviceGroups = backupGroups
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
		deviceGroupsMu.Unlock()
	}()

	testCases := []struct {
		name          string
		scriptName    string
		selectedGroup []string
		devices       []string
	}{
		{
			name:          "normal multi-group selection",
			scriptName:    "scriptA",
			selectedGroup: []string{"g1", "g2"},
			devices:       []string{"d1", "d2", "d3", "d4"},
		},
		{
			name:          "selected group order does not affect result",
			scriptName:    "scriptA",
			selectedGroup: []string{"g2", "g1"},
			devices:       []string{"d1", "d2", "d3", "d4"},
		},
		{
			name:          "single group selection",
			scriptName:    "scriptA",
			selectedGroup: []string{"g2"},
			devices:       []string{"d1", "d2", "d3"},
		},
		{
			name:          "script missing in selected groups",
			scriptName:    "scriptA",
			selectedGroup: []string{"g3"},
			devices:       []string{"d1", "d2", "d3"},
		},
		{
			name:          "all groups mode bypasses group config",
			scriptName:    "scriptA",
			selectedGroup: []string{"__all__", "g1"},
			devices:       []string{"d1", "d2", "d3"},
		},
		{
			name:          "empty selected groups",
			scriptName:    "scriptA",
			selectedGroup: []string{},
			devices:       []string{"d1", "d2", "d3"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			index := buildDeviceScriptConfigIndex(tc.scriptName, tc.selectedGroup)

			for _, udid := range tc.devices {
				expected := resolveDeviceScriptConfig(udid, tc.scriptName, tc.selectedGroup)
				var actual map[string]interface{}
				if index != nil {
					actual = index[udid]
				}

				if !reflect.DeepEqual(expected, actual) {
					t.Fatalf("config mismatch for device %s, expected=%v actual=%v", udid, expected, actual)
				}
			}
		})
	}
}
