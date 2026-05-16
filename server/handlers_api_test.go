package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func performAPIHandlerGetRequest(t *testing.T, target string, handler func(*gin.Context)) *httptest.ResponseRecorder {
	t.Helper()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	c.Request.RemoteAddr = "127.0.0.1:12345"
	handler(c)
	return w
}

func decodeAPIJSONResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func withoutServerTime(resp map[string]any) map[string]any {
	clone := make(map[string]any, len(resp))
	for key, value := range resp {
		clone[key] = value
	}
	delete(clone, "serverTime")
	return clone
}

func mustBoolFeature(t *testing.T, resp map[string]any, name string) bool {
	t.Helper()

	features, ok := resp["features"].(map[string]any)
	if !ok {
		t.Fatalf("features should be an object, got %#v", resp["features"])
	}
	value, ok := features[name].(bool)
	if !ok {
		t.Fatalf("features.%s should be a bool, got %#v", name, features[name])
	}
	return value
}

func TestConfigJSONAndControlInfoResponsesStayConsistent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	prevPort := serverConfig.Port
	serverConfig.Port = 53123
	t.Cleanup(func() { serverConfig.Port = prevPort })

	configResp := decodeAPIJSONResponse(t, performAPIHandlerGetRequest(t, "/api/config?format=json", configHandler))
	controlResp := decodeAPIJSONResponse(t, performAPIHandlerGetRequest(t, "/api/control/info", controlInfoHandler))

	if _, ok := configResp["serverTime"].(float64); !ok {
		t.Fatalf("/api/config serverTime should be numeric, got %#v", configResp["serverTime"])
	}
	if _, ok := controlResp["serverTime"].(float64); !ok {
		t.Fatalf("/api/control/info serverTime should be numeric, got %#v", controlResp["serverTime"])
	}
	if !reflect.DeepEqual(withoutServerTime(configResp), withoutServerTime(controlResp)) {
		t.Fatalf("responses differ after removing serverTime\nconfig=%#v\ncontrol=%#v", configResp, controlResp)
	}
	if !mustBoolFeature(t, configResp, "deviceDebugTunnel") {
		t.Fatalf("/api/config should advertise deviceDebugTunnel")
	}
	if !mustBoolFeature(t, controlResp, "deviceDebugTunnel") {
		t.Fatalf("/api/control/info should advertise deviceDebugTunnel")
	}
}

func TestConfigHandlerDefaultReturnsWindowConfigJavaScript(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := performAPIHandlerGetRequest(t, "/api/config", configHandler)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Content-Type"), "application/javascript") {
		t.Fatalf("expected javascript content type, got %q", w.Header().Get("Content-Type"))
	}
	if !strings.Contains(w.Body.String(), "window.XXTConfig = ") {
		t.Fatalf("expected window.XXTConfig wrapper, got %s", w.Body.String())
	}
}
