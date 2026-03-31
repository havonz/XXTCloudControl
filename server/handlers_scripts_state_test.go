package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestScriptsStartStateHandlerReturnsOnlyActiveSessions(t *testing.T) {
	resetScriptStartSessionsForTest()
	defer resetScriptStartSessionsForTest()

	if _, ok := createScriptStartSession("device-a", []byte("x"), true, "main.lua", scriptStartPhasePreparing, nil); !ok {
		t.Fatalf("session create should succeed")
	}

	w := performJSONHandlerRequest(t, http.MethodGet, "/api/scripts/start-state", nil, scriptsStartStateHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		States map[string]scriptStartState `json:"states"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}

	if len(resp.States) != 1 {
		t.Fatalf("expected exactly one active session, got %+v", resp.States)
	}
	state, ok := resp.States["device-a"]
	if !ok {
		t.Fatalf("expected device-a in response")
	}
	if !state.Active || !state.Cancelable || state.Phase != scriptStartPhasePreparing {
		t.Fatalf("unexpected state: %+v", state)
	}
}

func TestScriptsSendAndStartCancelHandlerReturnsCanceledAndIgnored(t *testing.T) {
	resetScriptStartSessionsForTest()
	defer resetScriptStartSessionsForTest()

	if _, ok := createScriptStartSession("device-cancel", []byte("x"), true, "main.lua", scriptStartPhasePreparing, nil); !ok {
		t.Fatalf("session create should succeed")
	}

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start/cancel",
		map[string]any{
			"devices": []string{"device-cancel", "device-missing"},
		},
		scriptsSendAndStartCancelHandler,
	)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Success  bool `json:"success"`
		Canceled []string
		Ignored  []struct {
			UDID   string `json:"udid"`
			Reason string `json:"reason"`
		} `json:"ignored"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}

	if !resp.Success {
		t.Fatalf("expected success response")
	}
	if len(resp.Canceled) != 1 || resp.Canceled[0] != "device-cancel" {
		t.Fatalf("unexpected canceled payload: %+v", resp.Canceled)
	}
	if len(resp.Ignored) != 1 || resp.Ignored[0].UDID != "device-missing" || resp.Ignored[0].Reason != scriptStartCancelReasonNoActive {
		t.Fatalf("unexpected ignored payload: %+v", resp.Ignored)
	}
	if _, exists := scriptStartStateForTest("device-cancel"); exists {
		t.Fatalf("canceled session should be cleared")
	}
}
