package main

import (
	"log"
	"os"
	"strconv"
	"strings"
)

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
