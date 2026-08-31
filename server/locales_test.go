package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNormalizeLocaleAliases(t *testing.T) {
	tests := map[string]string{
		"zh":         "zh-CN",
		"zh_CN":      "zh-CN",
		"zh-Hans":    "zh-CN",
		"zh-CHS":     "zh-CN",
		"zh-Hant-TW": "zh-TW",
		"zh-CHT":     "zh-TW",
		"zh-HK":      "zh-TW",
		"en":         "en-US",
		"en_GB":      "en-US",
		"ja":         "ja-JP",
		"ko-KR":      "ko-KR",
		"vi":         "vi-VN",
		"vn":         "vi-VN",
		"es-MX":      "es-ES",
		"pt-PT":      "pt-BR",
		"br":         "pt-BR",
		"ru-KZ":      "ru-RU",
		"fr-CA":      "fr-FR",
		"de-AT":      "de-DE",
		"it-IT":      "",
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
	if got := ParsePreferredLocale("", "it-IT, nl-NL"); got != defaultLocale {
		t.Fatalf("unsupported locales should fall back to default, got %q", got)
	}
	if got := ParsePreferredLocale("", "de-AT;q=0.4, fr-CA;q=0.9"); got != "fr-FR" {
		t.Fatalf("regional fallback or q weight not respected, got %q", got)
	}
	if got := ParsePreferredLocale("", "fr-FR;q=invalid, de-DE;q=0.5"); got != "de-DE" {
		t.Fatalf("invalid q value should discard the candidate, got %q", got)
	}
	if got := ParsePreferredLocale("", "ja-JP;Q = 0.8, ko-KR;q=0.7"); got != "ja-JP" {
		t.Fatalf("quality parameter should be case-insensitive and allow whitespace, got %q", got)
	}
	if got := ParsePreferredLocale("", "fr-FR;q=1.1, vi-VN;q=0.6"); got != "vi-VN" {
		t.Fatalf("out-of-range q value should discard the candidate, got %q", got)
	}
	if got := ParsePreferredLocale("", "ru-RU;q=NaN, ko-KR;q=0.4"); got != "ko-KR" {
		t.Fatalf("non-finite q value should discard the candidate, got %q", got)
	}
}

func TestTranslationCatalogCoversEveryLocaleAndPlaceholder(t *testing.T) {
	placeholderPattern := regexp.MustCompile(`\{[A-Za-z0-9_]+\}`)
	for code, values := range translationCatalog {
		if len(values) != len(supportedLocales) {
			t.Fatalf("%s has %d translations, expected %d", code, len(values), len(supportedLocales))
		}
		var expected []string
		for index, value := range values {
			if strings.TrimSpace(value) == "" {
				t.Fatalf("%s is missing %s translation", code, supportedLocales[index])
			}
			placeholders := placeholderPattern.FindAllString(value, -1)
			sort.Strings(placeholders)
			if index == 0 {
				expected = placeholders
				continue
			}
			if strings.Join(placeholders, ",") != strings.Join(expected, ",") {
				t.Fatalf("%s placeholder mismatch for %s: %v, expected %v", code, supportedLocales[index], placeholders, expected)
			}
		}
	}
}

func TestJSONErrorReturnsStableCodeAndSeparatesDetail(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test?locale=de-DE", nil)
	jsonError(c, http.StatusInternalServerError, "failed to open: permission denied")

	var payload struct {
		Error     string `json:"error"`
		ErrorCode string `json:"errorCode"`
		Detail    string `json:"detail"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ErrorCode != "error.entry.open_failed" {
		t.Fatalf("unexpected error code: %q", payload.ErrorCode)
	}
	if payload.Detail != "permission denied" {
		t.Fatalf("unexpected detail: %q", payload.Detail)
	}
	if strings.Contains(payload.Error, payload.Detail) {
		t.Fatalf("localized error must not interpolate raw detail: %q", payload.Error)
	}
}

func TestJSONErrorReturnsDynamicParams(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test?locale=es-ES", nil)
	jsonError(c, http.StatusBadRequest, "invalid category: custom")

	var payload struct {
		Error       string         `json:"error"`
		ErrorCode   string         `json:"errorCode"`
		ErrorParams map[string]any `json:"errorParams"`
		Detail      string         `json:"detail"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ErrorCode != "error.category.invalid_value" || payload.ErrorParams["category"] != "custom" {
		t.Fatalf("unexpected structured error: %+v", payload)
	}
	if payload.Detail != "" || !strings.Contains(payload.Error, "custom") {
		t.Fatalf("dynamic value should be a parameter, not detail: %+v", payload)
	}
}

func TestJSONMessageReturnsStableCodeAndParams(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/test?locale=pt-BR", nil)
	jsonMessageWithParams(c, http.StatusOK, "message.update.apply_started", map[string]any{"unused": 1}, gin.H{"success": true})

	var payload struct {
		Success       bool           `json:"success"`
		Message       string         `json:"message"`
		MessageCode   string         `json:"messageCode"`
		MessageParams map[string]any `json:"messageParams"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Success || payload.MessageCode != "message.update.apply_started" || payload.Message == "" {
		t.Fatalf("unexpected message payload: %+v", payload)
	}
	if payload.MessageParams["unused"] != float64(1) {
		t.Fatalf("message params missing: %+v", payload.MessageParams)
	}
	if got := w.Header().Get("Content-Language"); got != "pt-BR" {
		t.Fatalf("Content-Language=%q", got)
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
	if got := interpolateMessage("{first} {second}", map[string]any{"first": "{second}", "second": "done"}); got != "{second} done" {
		t.Fatalf("parameter values must not be interpolated recursively, got %q", got)
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
	var payload struct {
		ErrorCode string `json:"errorCode"`
	}
	if err := json.Unmarshal(en.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.ErrorCode != "error.group.name_required" {
		t.Fatalf("unexpected error code: %q", payload.ErrorCode)
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

func TestUpdateStatusLocalizesStructuredStateWithoutChangingDetail(t *testing.T) {
	backup := updaterService
	updaterService = &UpdaterService{state: UpdaterState{
		Stage:           updateStageFailed,
		LastError:       "下载更新失败",
		LastErrorCode:   "error.update.download_failed",
		LastErrorDetail: "connection reset by peer",
	}}
	t.Cleanup(func() { updaterService = backup })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/update/status?locale=fr-FR", nil)
	updateStatusHandler(c)

	var payload UpdateStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if payload.State.LastError != NewTranslator("fr-FR").TR("error.update.download_failed") {
		t.Fatalf("unexpected localized lastError: %q", payload.State.LastError)
	}
	if payload.State.LastErrorCode != "error.update.download_failed" || payload.State.LastErrorDetail != "connection reset by peer" {
		t.Fatalf("structured state changed unexpectedly: %+v", payload.State)
	}
}
