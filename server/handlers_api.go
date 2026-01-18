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

	"github.com/gin-gonic/gin"
)

// getRequestSignature extracts signature from request headers or query params
func getRequestSignature(c *gin.Context) (int64, string, error) {
	ts := c.GetHeader("X-XXT-TS")
	sign := c.GetHeader("X-XXT-Sign")
	if ts == "" || sign == "" {
		ts = c.Query("ts")
		sign = c.Query("sign")
	}
	if ts == "" || sign == "" {
		return 0, "", fmt.Errorf("missing signature")
	}
	parsedTS, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid timestamp")
	}
	return parsedTS, sign, nil
}

// isRequestAuthorized checks if the request has valid authorization
func isRequestAuthorized(c *gin.Context) bool {
	ts, sign, err := getRequestSignature(c)
	if err != nil {
		return false
	}
	return isSignatureValid(ts, sign)
}

// apiAuthMiddleware provides API authentication middleware
func apiAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if !strings.HasPrefix(path, "/api/") {
			c.Next()
			return
		}
		if path == "/api/download-bind-script" || path == "/api/ws" || path == "/api/config" {
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
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-XXT-TS, X-XXT-Sign")

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

// configHandler handles the /api/config endpoint
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

// downloadBindScriptHandler handles the /api/download-bind-script endpoint
func downloadBindScriptHandler(c *gin.Context) {
	host := c.Query("host")
	port := c.Query("port")

	if host == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "host parameter is required"})
		return
	}
	if port == "" {
		port = fmt.Sprintf("%d", serverConfig.Port)
	}

	luaScript := fmt.Sprintf(`local cloud_host = "%s";local cloud_port = %s;`, host, port)

	luaScript += `

if sys.xtversion():compare_version("1.3.8") < 0 then
	sys.alert('该脚本仅支持 XXT 1.3.8 或更高版本')
	return
end

local conf = json.decode(file.reads(XXT_CONF_FILE_NAME) or "")
conf = type(conf) == 'table' and conf or {}
conf.open_cloud_control = conf.open_cloud_control or {}

local address = "ws://" .. cloud_host .. ":" .. cloud_port .. "/api/ws"

local xxt_port = tonumber(type(sys.port) == "function" and sys.port() or 46952) or 46952

if conf.open_cloud_control.enable then
	if sys.alert("当前设备已被以下云控控制\n\n"..tostring(conf.open_cloud_control.address).."\n\n你是否需要解除设备被控状态？", 10, "是否解除被控", "取消", "解除被控") == 1 then
		local c, h, r = http.put('http://127.0.0.1:'..xxt_port..'/api/config', 5, {}, json.encode{
			cloud = {
				enable = false,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已从云控解除被控状态", 10)
		end
	end
else
	if sys.alert("你确认要将设备加入到以下云控的并被其控制？\n\n"..address.."\n\n⚠️你必须确定该云控是可信的，否则设备将被恶意控制！", 10, "是否加入", "取消", "加入并被控") == 1 then
		local c, h, r = http.put('http://127.0.0.1:'..xxt_port..'/api/config', 5, {}, json.encode{
			cloud = {
				enable = true,
				address = address,
			}
		})
		if c < 300 then
			sys.alert("已设置绑定到云控", 10)
		end
	end
end
`

	c.Header("Content-Type", "text/lua")
	c.Header("Content-Disposition", "attachment; filename=加入或退出云控["+host+"].lua")
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
func printNetworkEndpoints(port int) {
	interfaces, err := net.Interfaces()
	if err != nil {
		fmt.Printf("Failed to get network interfaces: %v\n", err)
		return
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
				fmt.Printf("  Frontend:    http://%s:%d/\n", ip.String(), port)
				fmt.Printf("  WebSocket:   ws://%s:%d/api/ws\n", ip.String(), port)
				fmt.Println()
			}
		}
	}

	fmt.Printf("Local access:\n")
	fmt.Printf("  Frontend:    http://localhost:%d/\n", port)
	fmt.Printf("  WebSocket:   ws://localhost:%d/api/ws\n", port)
	fmt.Println("===================================")
}
