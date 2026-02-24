package main

import (
	"net/http"
	"reflect"
	"testing"
)

func setupGroupsReorderFixture(t *testing.T) []GroupInfo {
	t.Helper()
	setupPersistenceWritableDataDir(t)

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)
	deviceGroups = []GroupInfo{
		{ID: "g1", Name: "Group 1", DeviceIDs: []string{"d1"}, SortOrder: 0, ScriptPath: "a.lua"},
		{ID: "g2", Name: "Group 2", DeviceIDs: []string{"d2"}, SortOrder: 1, ScriptPath: "b.lua"},
		{ID: "g3", Name: "Group 3", DeviceIDs: []string{"d3"}, SortOrder: 2, ScriptPath: "c.lua"},
	}
	initial := cloneGroupInfos(deviceGroups)
	deviceGroupsMu.Unlock()

	t.Cleanup(func() {
		deviceGroupsMu.Lock()
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
	})

	return initial
}

func TestGroupsReorderHandler_ReordersWithCompleteUniqueOrder(t *testing.T) {
	initial := setupGroupsReorderFixture(t)

	w := performJSONHandlerRequest(
		t,
		http.MethodPut,
		"/api/groups/reorder",
		map[string]any{"order": []string{"g3", "g1", "g2"}},
		groupsReorderHandler,
	)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}

	deviceGroupsMu.RLock()
	got := cloneGroupInfos(deviceGroups)
	deviceGroupsMu.RUnlock()

	expectedOrder := []string{"g3", "g1", "g2"}
	if len(got) != len(expectedOrder) {
		t.Fatalf("expected %d groups, got %d", len(expectedOrder), len(got))
	}

	initialByID := make(map[string]GroupInfo, len(initial))
	for _, group := range initial {
		initialByID[group.ID] = group
	}

	for i, group := range got {
		if group.ID != expectedOrder[i] {
			t.Fatalf("unexpected group order at index %d: expected %s, got %s", i, expectedOrder[i], group.ID)
		}
		if group.SortOrder != i {
			t.Fatalf("unexpected sort order for %s: expected %d, got %d", group.ID, i, group.SortOrder)
		}
		original := initialByID[group.ID]
		if group.Name != original.Name || !reflect.DeepEqual(group.DeviceIDs, original.DeviceIDs) || group.ScriptPath != original.ScriptPath {
			t.Fatalf("group data changed unexpectedly for %s", group.ID)
		}
	}
}

func TestGroupsReorderHandler_RejectsIncompleteOrInvalidOrder(t *testing.T) {
	testCases := []struct {
		name  string
		order []string
	}{
		{name: "missing group", order: []string{"g3", "g1"}},
		{name: "duplicate group id", order: []string{"g3", "g1", "g1"}},
		{name: "unknown group id", order: []string{"g3", "g1", "g9"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			initial := setupGroupsReorderFixture(t)

			w := performJSONHandlerRequest(
				t,
				http.MethodPut,
				"/api/groups/reorder",
				map[string]any{"order": tc.order},
				groupsReorderHandler,
			)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
			}

			deviceGroupsMu.RLock()
			got := cloneGroupInfos(deviceGroups)
			deviceGroupsMu.RUnlock()
			if !reflect.DeepEqual(got, initial) {
				t.Fatalf("deviceGroups changed after invalid reorder, expected=%v got=%v", initial, got)
			}
		})
	}
}
