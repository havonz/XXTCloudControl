package main

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDownloadBindScriptUsesRequestedLocaleAndASCIIFilename(t *testing.T) {
	for _, locale := range supportedLocales {
		t.Run(locale, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/download-bind-script?host=example.com&locale="+locale, nil)

			downloadBindScriptHandler(c)

			if w.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if got := w.Header().Get("Content-Language"); got != locale {
				t.Fatalf("Content-Language=%q, expected %q", got, locale)
			}
			disposition := w.Header().Get("Content-Disposition")
			if !strings.Contains(disposition, "XXTCloudControl-bind-example.com.lua") {
				t.Fatalf("unexpected Content-Disposition: %q", disposition)
			}
			for _, r := range disposition {
				if r > 0x7f {
					t.Fatalf("Content-Disposition must be ASCII: %q", disposition)
				}
			}

			translator := NewTranslator(locale)
			if !strings.Contains(w.Body.String(), "bind_title = "+strconv.Quote(translator.TR("bind.bind_title"))) {
				t.Fatalf("localized bind title missing from script: %s", w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "version_unsupported = "+strconv.Quote(translator.TRV("bind.version_unsupported", map[string]any{"version": "1.3.8-20260122000000"}))) {
				t.Fatalf("localized version warning missing from script")
			}
		})
	}
}

func TestBuildBindScriptFilenameUsesASCIISafeHost(t *testing.T) {
	tests := map[string]string{
		"example.com":   "XXTCloudControl-bind-example.com.lua",
		"[2001:db8::1]": "XXTCloudControl-bind-2001_db8__1.lua",
		"云控.example":    "XXTCloudControl-bind-__.example.lua",
	}
	for host, expected := range tests {
		if got := buildBindScriptFilename(host); got != expected {
			t.Errorf("buildBindScriptFilename(%q)=%q, expected %q", host, got, expected)
		}
	}
}

func TestDownloadBindScriptIsSingleLanguage(t *testing.T) {
	tests := []struct {
		locale string
		want   string
		reject string
	}{
		{locale: "zh-CN", want: "加入云控", reject: "Bind cloud control"},
		{locale: "en-US", want: "Bind cloud control", reject: "加入云控"},
		{locale: "es-MX", want: "Vincular control en la nube", reject: "Bind cloud control"},
	}
	for _, test := range tests {
		t.Run(test.locale, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/download-bind-script?host=example.com&locale="+test.locale, nil)
			downloadBindScriptHandler(c)

			if !strings.Contains(w.Body.String(), test.want) {
				t.Fatalf("expected %q in localized script", test.want)
			}
			if strings.Contains(w.Body.String(), test.reject) {
				t.Fatalf("unexpected second-language text %q", test.reject)
			}
		})
	}
}
