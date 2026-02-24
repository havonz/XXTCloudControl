package main

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// resolveTransferBaseURL builds a device-reachable HTTP base URL for transfer/fetch and transfer/send.
// It prefers caller-provided base URL, then request host, and rewrites loopback hosts to a LAN IPv4 when possible.
func resolveTransferBaseURL(c *gin.Context, preferred string) string {
	scheme := requestTransferScheme(c)

	if parsed := parseTransferBaseURL(preferred, scheme); parsed != nil {
		return normalizeTransferBaseURL(parsed, scheme)
	}
	if parsed := parseTransferBaseURL(requestBaseURLFromContext(c, scheme), scheme); parsed != nil {
		return normalizeTransferBaseURL(parsed, scheme)
	}

	if ip, ok := firstNonLoopbackIPv4(); ok {
		return fmt.Sprintf("%s://%s:%d", scheme, ip, serverConfig.Port)
	}
	return fmt.Sprintf("http://127.0.0.1:%d", serverConfig.Port)
}

func requestTransferScheme(c *gin.Context) string {
	if c != nil {
		forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
		if forwarded != "" {
			parts := strings.Split(forwarded, ",")
			proto := strings.ToLower(strings.TrimSpace(parts[0]))
			if proto == "http" || proto == "https" {
				return proto
			}
		}

		if c.Request != nil && c.Request.TLS != nil {
			return "https"
		}
	}
	return "http"
}

func requestBaseURLFromContext(c *gin.Context, scheme string) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := strings.TrimSpace(c.Request.Host)
	if host == "" {
		return ""
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

func parseTransferBaseURL(raw string, fallbackScheme string) *url.URL {
	base := strings.TrimSpace(raw)
	if base == "" {
		return nil
	}
	if !strings.Contains(base, "://") {
		base = fallbackScheme + "://" + base
	}

	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" {
		return nil
	}
	parsed.Path = ""
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed
}

func normalizeTransferBaseURL(parsed *url.URL, fallbackScheme string) string {
	if parsed == nil {
		return ""
	}
	if parsed.Scheme == "" {
		parsed.Scheme = fallbackScheme
	}

	host := parsed.Hostname()
	if isLoopbackHost(host) {
		if ip, ok := firstNonLoopbackIPv4(); ok {
			port := parsed.Port()
			switch {
			case port != "":
				parsed.Host = net.JoinHostPort(ip, port)
			case serverConfig.Port > 0:
				parsed.Host = net.JoinHostPort(ip, strconv.Itoa(serverConfig.Port))
			default:
				parsed.Host = ip
			}
		}
	}
	return strings.TrimRight(parsed.String(), "/")
}

func isLoopbackHost(host string) bool {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == "" {
		return false
	}
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}

	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func firstNonLoopbackIPv4() (string, bool) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", false
	}

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch value := addr.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ipv4 := ip.To4()
			if ipv4 == nil {
				continue
			}
			// Skip link-local self-assigned addresses.
			if ipv4[0] == 169 && ipv4[1] == 254 {
				continue
			}
			return ipv4.String(), true
		}
	}

	return "", false
}
