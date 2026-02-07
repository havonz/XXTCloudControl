package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
)

// getRequestSignature extracts signature from request headers or query params
func getRequestSignature(c *gin.Context) (int64, string, string, error) {
	ts := c.GetHeader("X-XXT-TS")
	nonce := c.GetHeader("X-XXT-Nonce")
	sign := c.GetHeader("X-XXT-Sign")
	if ts == "" || nonce == "" || sign == "" {
		ts = c.Query(authQueryTSKey)
		nonce = c.Query(authQueryNonceKey)
		sign = c.Query(authQuerySignKey)
	}
	if ts == "" || nonce == "" || sign == "" {
		return 0, "", "", fmt.Errorf("missing signature")
	}
	parsedTS, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return 0, "", "", fmt.Errorf("invalid timestamp")
	}
	return parsedTS, nonce, sign, nil
}

// isRequestAuthorized checks if the request has valid authorization
func isRequestAuthorized(c *gin.Context) bool {
	ts, nonce, sign, err := getRequestSignature(c)
	if err != nil {
		return false
	}
	var bodyBytes []byte
	contentType := c.GetHeader("Content-Type")
	shouldReadBody := !strings.HasPrefix(contentType, "multipart/form-data") &&
		(c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) > 0) &&
		c.Request.Method != http.MethodGet &&
		c.Request.Method != http.MethodHead
	if shouldReadBody {
		bodyBytes, c.Request.Body, err = readRequestBodyBytes(c.Request.Body)
		if err != nil {
			return false
		}
	}
	canonicalPath := canonicalRequestPath(c.Request.URL)
	return verifyHTTPRequestSignature(ts, nonce, sign, c.Request.Method, canonicalPath, bodyBytes)
}

// apiAuthMiddleware provides API authentication middleware
func apiAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if !strings.HasPrefix(path, "/api/") {
			c.Next()
			return
		}
		if path == "/api/download-bind-script" || path == "/api/ws" || path == "/api/config" || path == "/api/control/info" {
			c.Next()
			return
		}
		// Token-based transfer endpoints don't need auth (they use temporary tokens)
		if strings.HasPrefix(path, "/api/transfer/download/") || strings.HasPrefix(path, "/api/transfer/upload/") {
			c.Next()
			return
		}
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if !isRequestAuthorized(c) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// corsMiddleware provides CORS support
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-XXT-TS, X-XXT-Nonce, X-XXT-Sign")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	}
}

// isLocalRequest checks if the request is from localhost
func isLocalRequest(c *gin.Context) bool {
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		host = c.Request.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip.IsLoopback() || (ip.To4() != nil && ip.To4().IsLoopback())
}

func hasInvalidHostChars(host string) bool {
	for _, ch := range host {
		if ch <= 0x20 || ch == 0x7f {
			return true
		}
		switch ch {
		case '/', '\\':
			return true
		}
	}
	return false
}

func containsNonASCII(host string) bool {
	for _, ch := range host {
		if ch > 0x7f {
			return true
		}
	}
	return false
}

// isValidHostASCII checks a relaxed ASCII hostname (allows underscore).
func isValidHostASCII(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	for _, ch := range host {
		switch {
		case ch >= 'a' && ch <= 'z':
		case ch >= 'A' && ch <= 'Z':
		case ch >= '0' && ch <= '9':
		case ch == '-' || ch == '.' || ch == '_':
		default:
			return false
		}
	}
	return true
}

func isValidHostUnicode(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	for _, ch := range host {
		switch {
		case unicode.IsLetter(ch):
		case unicode.IsDigit(ch):
		case unicode.IsMark(ch):
		case ch == '-' || ch == '.' || ch == '_':
		default:
			return false
		}
	}
	return true
}

func isAttrChar(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z':
		return true
	case b >= 'A' && b <= 'Z':
		return true
	case b >= '0' && b <= '9':
		return true
	}
	switch b {
	case '!', '#', '$', '&', '+', '-', '.', '^', '_', '`', '|', '~':
		return true
	default:
		return false
	}
}

func rfc5987Encode(value string) string {
	var builder strings.Builder
	for i := 0; i < len(value); i++ {
		b := value[i]
		if isAttrChar(b) {
			builder.WriteByte(b)
		} else {
			builder.WriteString(fmt.Sprintf("%%%02X", b))
		}
	}
	return builder.String()
}

func quoteDispositionFilename(name string) (string, bool) {
	var builder strings.Builder
	for i := 0; i < len(name); i++ {
		b := name[i]
		if b < 0x20 || b == 0x7f {
			return "", false
		}
		if b >= 0x80 {
			return "", false
		}
		if b == '"' || b == '\\' {
			builder.WriteByte('\\')
		}
		builder.WriteByte(b)
	}
	return `"` + builder.String() + `"`, true
}

func buildContentDispositionFilename(name string) string {
	quoted, ok := quoteDispositionFilename(name)
	if !ok {
		quoted = `"bind.lua"`
	}
	encoded := rfc5987Encode(name)
	return fmt.Sprintf("attachment; filename=%s; filename*=UTF-8''%s", quoted, encoded)
}

// sanitizeBindHost validates and normalizes the bind host string.
func sanitizeBindHost(host string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", fmt.Errorf("host parameter is required")
	}
	if hasInvalidHostChars(host) {
		return "", fmt.Errorf("invalid host")
	}

	// Bracketed IPv6.
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		inner := host[1 : len(host)-1]
		ip := net.ParseIP(inner)
		if ip == nil || ip.To4() != nil {
			return "", fmt.Errorf("invalid host")
		}
		return "[" + inner + "]", nil
	}

	// Plain IP (IPv4 or IPv6).
	if ip := net.ParseIP(host); ip != nil {
		if ip.To4() == nil {
			return "[" + host + "]", nil
		}
		return host, nil
	}

	if strings.Contains(host, ":") {
		return "", fmt.Errorf("invalid host")
	}

	if containsNonASCII(host) {
		if !isValidHostUnicode(host) {
			return "", fmt.Errorf("invalid host")
		}
		return host, nil
	}

	if !isValidHostASCII(host) {
		return "", fmt.Errorf("invalid host")
	}
	return host, nil
}

// configHandler handles the /api/config endpoint
// This is the cloud control server's configuration API, returning server version, time, and WebSocket settings.
// Note: This is NOT the same as the device-side XXT service's /api/config endpoint (e.g., http://127.0.0.1:46952/api/config),
// which is used to configure device cloud control binding settings via PUT requests.
// This endpoint does not require authentication and is used by the frontend before login.
func configHandler(c *gin.Context) {
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	config := gin.H{
		"version":    Version,
		"serverTime": time.Now().Unix(),
		"websocket": gin.H{
			"port":              serverConfig.Port,
			"path":              "/api/ws",
			"autoReconnect":     true,
			"reconnectInterval": 3000,
		},
		"ui": gin.H{
			"screenCaptureScale":    30,
			"maxScreenshotWaitTime": 500,
			"fpsUpdateInterval":     1000,
			"isLocal":               isLocalRequest(c),
		},
	}

	if c.Query("format") == "json" || strings.Contains(c.GetHeader("Accept"), "application/json") {
		c.JSON(http.StatusOK, config)
		return
	}

	c.Header("Content-Type", "application/javascript")

	configBytes, err := json.Marshal(config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build config"})
		return
	}

	configJS := fmt.Sprintf(`// Dynamically generated configuration
window.XXTConfig = %s;

console.log('Server config loaded (port: %d):', window.XXTConfig);`, string(configBytes), serverConfig.Port)

	c.String(http.StatusOK, configJS)
}

// controlInfoHandler handles the /api/control/info endpoint
// Returns the same configuration as /api/config, but always in JSON format.
// No authentication required.
func controlInfoHandler(c *gin.Context) {
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.JSON(http.StatusOK, gin.H{
		"version":    Version,
		"serverTime": time.Now().Unix(),
		"websocket": gin.H{
			"port":              serverConfig.Port,
			"path":              "/api/ws",
			"autoReconnect":     true,
			"reconnectInterval": 3000,
		},
		"ui": gin.H{
			"screenCaptureScale":    30,
			"maxScreenshotWaitTime": 500,
			"fpsUpdateInterval":     1000,
			"isLocal":               isLocalRequest(c),
		},
	})
}

// downloadBindScriptHandler handles the /api/download-bind-script endpoint
func downloadBindScriptHandler(c *gin.Context) {
	hostParam := c.Query("host")
	if hostParam == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "host parameter is required"})
		return
	}
	host, err := sanitizeBindHost(hostParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	port := serverConfig.Port
	if portParam := strings.TrimSpace(c.Query("port")); portParam != "" {
		p, err := strconv.Atoi(portParam)
		if err != nil || p < 1 || p > 65535 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid port"})
			return
		}
		port = p
	}

	// Detect WebSocket protocol based on request
	// Priority: 1. Explicit proto query param, 2. X-Forwarded-Proto header (reverse proxy), 3. Server TLS config, 4. Default to ws
	wsProto := "ws"
	proto := c.Query("proto")
	if proto == "" {
		proto = c.GetHeader("X-Forwarded-Proto")
	}
	if proto == "https" || proto == "wss" {
		wsProto = "wss"
	} else if proto == "" && serverConfig.TLSEnabled && serverConfig.TLSCertFile != "" && serverConfig.TLSKeyFile != "" {
		// Native TLS mode enabled
		wsProto = "wss"
	}

	quotedHost := strconv.Quote(host)
	luaScript := fmt.Sprintf(`local cloud_host = %s;local cloud_port = %d;local ws_proto = "%s";`, quotedHost, port, wsProto)

	luaScript += `

if sys.xtversion():compare_version("1.3.8-20260122000000") < 0 then
	sys.alert('该脚本仅支持 XXT 1.3.8-20260122000000 或更高版本')
	return
end

local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or "")
conf = type(conf) == 'table' and conf or {}
conf.open_cloud_control = conf.open_cloud_control or {}

local address = ws_proto .. "://" .. cloud_host .. ":" .. cloud_port .. "/api/ws"

local xxt_port = tonumber(type(sys.port) == "function" and sys.port() or 46952) or 46952

if conf.open_cloud_control.enable then
	if sys.alert("当前设备已被以下云控控制\nThis device is currently controlled by:\n\n"..tostring(conf.open_cloud_control.address).."\n\n你是否需要解除设备被控状态？\nDo you want to unbind from this cloud control?", 30, "是否解除被控 / Unbind?", "取消 / Cancel", "解除被控 / Unbind") == 1 then
		local c, h, r = http.put('http://127.0.0.1:'..xxt_port..'/api/config', 5, {}, json.encode{
			cloud = {
				enable = false,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已从云控解除被控状态\nSuccessfully unbound from cloud control.", 10)
		end
	end
else
	if sys.alert("你确认要将设备加入到以下云控并被其控制？\nAre you sure you want to bind this device to the following cloud control?\n\n"..address.."\n\n⚠️你必须确定该云控是可信的，否则设备将被恶意控制！\n⚠️ Make sure this cloud control is trusted, or your device may be maliciously controlled!", 30, "是否加入 / Bind?", "取消 / Cancel", "加入并被控 / Bind") == 1 then
		local c, h, r = http.put('http://127.0.0.1:'..xxt_port..'/api/config', 5, {}, json.encode{
			cloud = {
				enable = true,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已设置绑定到云控\nSuccessfully bound to cloud control.", 10)
		end
	end
end

os.exit()
`

	c.Header("Content-Type", "text/lua")
	c.Header("Content-Disposition", buildContentDispositionFilename("加入或退出云控["+host+"].lua"))
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	c.String(http.StatusOK, luaScript)
}

// staticFileHandler handles static file serving
func staticFileHandler(c *gin.Context) {
	path := filepath.Clean(c.Request.URL.Path)

	if path == "/" || path == "." {
		path = "/index.html"
	}

	fullPath := filepath.Join(serverConfig.FrontendDir, path)

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		if path != "/" {
			fullPath = filepath.Join(serverConfig.FrontendDir, "index.html")
		} else {
			c.Status(http.StatusNotFound)
			return
		}
	}

	setContentTypeAndCache(c, fullPath)
	c.File(fullPath)
}

// setContentTypeAndCache sets appropriate Content-Type and cache headers
func setContentTypeAndCache(c *gin.Context, filePath string) {
	ext := strings.ToLower(filepath.Ext(filePath))

	switch ext {
	case ".html":
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
	case ".css":
		c.Header("Content-Type", "text/css; charset=utf-8")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", DefaultCacheMaxAge))
	case ".js":
		c.Header("Content-Type", "application/javascript; charset=utf-8")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", DefaultCacheMaxAge))
	case ".json":
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", DefaultCacheMaxAge))
	case ".png":
		c.Header("Content-Type", "image/png")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", ImageCacheMaxAge))
	case ".jpg", ".jpeg":
		c.Header("Content-Type", "image/jpeg")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", ImageCacheMaxAge))
	case ".gif":
		c.Header("Content-Type", "image/gif")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", ImageCacheMaxAge))
	case ".svg":
		c.Header("Content-Type", "image/svg+xml")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", ImageCacheMaxAge))
	case ".ico":
		c.Header("Content-Type", "image/x-icon")
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", ImageCacheMaxAge))
	default:
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", DefaultCacheMaxAge))
	}
}

// getAppSettingsHandler handles GET /api/app-settings
func getAppSettingsHandler(c *gin.Context) {
	appSettingsMu.RLock()
	defer appSettingsMu.RUnlock()
	c.JSON(http.StatusOK, appSettings)
}

// setAppSettingsHandler handles POST /api/app-settings
func setAppSettingsHandler(c *gin.Context) {
	var req struct {
		SelectedScript   *string `json:"selectedScript"`
		GroupMultiSelect *bool   `json:"groupMultiSelect"`
		GroupSortLocked  *bool   `json:"groupSortLocked"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	appSettingsMu.Lock()
	if req.SelectedScript != nil {
		appSettings.SelectedScript = *req.SelectedScript
	}
	if req.GroupMultiSelect != nil {
		appSettings.GroupMultiSelect = *req.GroupMultiSelect
	}
	if req.GroupSortLocked != nil {
		appSettings.GroupSortLocked = *req.GroupSortLocked
	}
	appSettingsMu.Unlock()

	if err := saveAppSettings(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// printNetworkEndpoints prints available network endpoints
func printNetworkEndpoints(port int, tlsEnabled bool) {
	interfaces, err := net.Interfaces()
	if err != nil {
		fmt.Printf("Failed to get network interfaces: %v\n", err)
		return
	}

	httpScheme := "http"
	wsScheme := "ws"
	if tlsEnabled {
		httpScheme = "https"
		wsScheme = "wss"
	}

	fmt.Println("\n=== Available Network Endpoints ===")

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() {
				continue
			}

			if ip.To4() != nil {
				if ip.To4()[0] == 169 && ip.To4()[1] == 254 {
					continue
				}
				fmt.Printf("Interface: %-15s IP: %-15s\n", iface.Name, ip.String())
				fmt.Printf("  Frontend:    %s://%s:%d/\n", httpScheme, ip.String(), port)
				fmt.Printf("  WebSocket:   %s://%s:%d/api/ws\n", wsScheme, ip.String(), port)
				fmt.Println()
			}
		}
	}

	fmt.Printf("Local access:\n")
	fmt.Printf("  Frontend:    %s://localhost:%d/\n", httpScheme, port)
	fmt.Printf("  WebSocket:   %s://localhost:%d/api/ws\n", wsScheme, port)
	fmt.Println("===================================")
}
