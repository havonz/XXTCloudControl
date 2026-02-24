package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func performGETScriptHandlerRequest(t *testing.T, target string, handler func(*gin.Context)) *httptest.ResponseRecorder {
	t.Helper()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	handler(c)
	return w
}

func TestScriptsSendHandlerRejectsTraversalName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "../../etc/passwd",
		},
		scriptsSendHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptsSendAndStartHandlerRejectsTraversalName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/send-and-start",
		map[string]any{
			"devices": []string{"device-1"},
			"name":    "..\\..\\etc\\passwd",
		},
		scriptsSendAndStartHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptConfigStatusHandlerRejectsTraversalName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	w := performGETScriptHandlerRequest(t, "/api/scripts/config-status?name=../../etc", scriptConfigStatusHandler)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptConfigGetHandlerRejectsTraversalName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	w := performGETScriptHandlerRequest(t, "/api/scripts/config?name=../../etc", scriptConfigGetHandler)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestScriptConfigSaveHandlerRejectsTraversalName(t *testing.T) {
	setupFileHandlersTestDataDir(t)

	w := performJSONHandlerRequest(
		t,
		http.MethodPost,
		"/api/scripts/config",
		map[string]any{
			"name":   "../../etc",
			"config": map[string]any{"k": "v"},
		},
		scriptConfigSaveHandler,
	)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", w.Code, w.Body.String())
	}
}
