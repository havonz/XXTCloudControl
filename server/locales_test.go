package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNormalizeLocaleAliases(t *testing.T) {
	tests := map[string]string{
		"zh":      "zh-CN",
		"zh_CN":   "zh-CN",
		"zh-Hans": "zh-CN",
		"en":      "en-US",
		"en_GB":   "en-US",
		"fr-FR":   "",
	}
	for input, expected := range tests {
		if got := NormalizeLocale(input); got != expected {
			t.Fatalf("NormalizeLocale(%q)=%q, expected %q", input, got, expected)
		}
	}
}

func TestParsePreferredLocale(t *testing.T) {
	if got := ParsePreferredLocale("en-US", "zh-CN;q=1"); got != "en-US" {
		t.Fatalf("explicit locale should win, got %q", got)
	}
	if got := ParsePreferredLocale("", "en-US;q=0.4, zh-CN;q=0.9"); got != "zh-CN" {
		t.Fatalf("q weight not respected, got %q", got)
	}
	if got := ParsePreferredLocale("", "fr-FR, de-DE"); got != defaultLocale {
		t.Fatalf("unsupported locales should fall back to default, got %q", got)
	}
}

func TestTranslatorFormatting(t *testing.T) {
	tr := NewTranslator("zh-CN")
	if got := tr.TRf("failed to open: %s", "demo.txt"); got != "打开失败: demo.txt" {
		t.Fatalf("TRf returned %q", got)
	}
	if got := tr.TRV("script root is not a directory: {path}", map[string]any{"path": "/tmp/demo"}); got != "脚本根路径不是目录: /tmp/demo" {
		t.Fatalf("TRV returned %q", got)
	}
	if got := NewTranslator("en-US").TR("Group name cannot be empty"); got != "Group name cannot be empty" {
		t.Fatalf("en-US should preserve English source text, got %q", got)
	}
}

func performLocalizedJSONRequest(t *testing.T, method, target string, payload any, acceptLanguage string, handler func(*gin.Context)) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	c.Request = req
	handler(c)
	return w
}

func TestGroupsCreateHandlerLocalizedEmptyName(t *testing.T) {
	setupPersistenceWritableDataDir(t)

	zh := performLocalizedJSONRequest(t, http.MethodPost, "/api/groups", map[string]any{}, "zh-CN", groupsCreateHandler)
	if zh.Code != http.StatusBadRequest {
		t.Fatalf("expected zh status 400, got %d body=%s", zh.Code, zh.Body.String())
	}
	if !bytes.Contains(zh.Body.Bytes(), []byte("分组名称不能为空")) {
		t.Fatalf("expected Chinese error, got %s", zh.Body.String())
	}

	en := performLocalizedJSONRequest(t, http.MethodPost, "/api/groups", map[string]any{}, "en-US", groupsCreateHandler)
	if en.Code != http.StatusBadRequest {
		t.Fatalf("expected en status 400, got %d body=%s", en.Code, en.Body.String())
	}
	if !bytes.Contains(en.Body.Bytes(), []byte("Group name cannot be empty")) {
		t.Fatalf("expected English error, got %s", en.Body.String())
	}
}

func TestUpdateStatusHandlerLocalizedNotInitialized(t *testing.T) {
	backup := updaterService
	updaterService = nil
	t.Cleanup(func() { updaterService = backup })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/api/update/status?locale=en-US", nil)
	c.Request = req
	updateStatusHandler(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d body=%s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("updater not initialized")) {
		t.Fatalf("expected English error, got %s", w.Body.String())
	}
}
