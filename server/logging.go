package main

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func requestLogger() gin.HandlerFunc {
	logger := gin.Logger()
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/transfer/download/") || strings.HasPrefix(path, "/api/transfer/upload/") {
			// 设备尚未传完时，轮询用的下载链接仍有效，访问日志只记录路由模板。
			start := time.Now()
			c.Next()
			log.Printf("[transfer] %s %s %d (%s)", c.Request.Method, c.FullPath(), c.Writer.Status(), time.Since(start))
			return
		}
		logger(c)
	}
}

var (
	debugLogsEnabled     = envDebugEnabled("XXT_DEBUG_LOG")
	wsDebugLogsEnabled   = envDebugEnabled("XXT_WS_DEBUG")
	httpDebugLogsEnabled = envDebugEnabled("XXT_HTTP_DEBUG")
	authDebugLogsEnabled = envDebugEnabled("XXT_AUTH_DEBUG")
)

func envDebugEnabled(key string) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return false
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if parsed, err := strconv.ParseBool(value); err == nil {
		return parsed
	}
	// Keep compatibility with previous behavior where any non-empty value enabled debug logging.
	return true
}

func debugLogf(format string, args ...interface{}) {
	if debugLogsEnabled {
		log.Printf(format, args...)
	}
}

func wsDebugf(format string, args ...interface{}) {
	if debugLogsEnabled || wsDebugLogsEnabled {
		log.Printf(format, args...)
	}
}

func httpDebugf(format string, args ...interface{}) {
	if debugLogsEnabled || wsDebugLogsEnabled || httpDebugLogsEnabled {
		log.Printf(format, args...)
	}
}

func authDebugEnabled() bool {
	return debugLogsEnabled || authDebugLogsEnabled
}
