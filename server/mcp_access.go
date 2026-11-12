package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpAccess struct {
	mu     sync.RWMutex
	path   string
	digest []byte
}

func registerMCP(r *gin.Engine) error {
	access := &mcpAccess{path: filepath.Join(serverConfig.DataDir, "mcp-token.sha256")}
	data, err := os.ReadFile(access.path)
	if err == nil {
		access.digest, err = hex.DecodeString(strings.TrimSpace(string(data)))
		if err != nil || len(access.digest) != sha256.Size {
			return errors.New("invalid MCP credential digest")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	// 服务重启后内存中的下载令牌已失效，可以回收此前批次的私有副本。
	stageDir := filepath.Join(serverConfig.DataDir, ".mcp-staging")
	if st, e := os.Lstat(stageDir); e == nil && !st.IsDir() {
		return errors.New("MCP staging path must be a directory")
	}
	if entries, e := os.ReadDir(stageDir); e == nil {
		for _, v := range entries {
			if v.IsDir() && strings.HasPrefix(v.Name(), "source-") {
				if e = os.RemoveAll(filepath.Join(stageDir, v.Name())); e != nil {
					return e
				}
			}
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}

	r.GET("/api/mcp/token", access.manage)
	r.POST("/api/mcp/token", access.manage)
	r.DELETE("/api/mcp/token", access.manage)
	server := newCloudMCPServer()
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	r.Any("/mcp", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if origin := c.GetHeader("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || !strings.EqualFold(u.Host, c.Request.Host) || u.Scheme != requestTransferScheme(c) {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
		}
		auth := strings.Fields(c.GetHeader("Authorization"))
		access.mu.RLock()
		allowed := false
		if len(auth) == 2 && strings.EqualFold(auth[0], "Bearer") {
			hash := sha256.Sum256([]byte(auth[1]))
			allowed = subtle.ConstantTimeCompare(access.digest, hash[:]) == 1
		}
		access.mu.RUnlock()
		if !allowed {
			c.Header("WWW-Authenticate", `Bearer realm="XXTCloudControl"`)
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		req := c.Request
		req.Body = http.MaxBytesReader(c.Writer, req.Body, 4<<20)
		ctx := context.WithValue(req.Context(), mcpContextKey{}, mcpRequestInfo{baseURL: resolveTransferBaseURL(c, ""), language: req.Header.Get("Accept-Language")})
		handler.ServeHTTP(c.Writer, req.WithContext(ctx))
	})
	return nil
}

func (a *mcpAccess) manage(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	a.mu.Lock()
	defer a.mu.Unlock()
	switch c.Request.Method {
	case http.MethodPost:
		var secret [32]byte
		if _, err := rand.Read(secret[:]); err != nil {
			jsonError(c, 500, "error.internal")
			return
		}
		token := base64.RawURLEncoding.EncodeToString(secret[:])
		hash := sha256.Sum256([]byte(token))
		temp, err := os.CreateTemp(filepath.Dir(a.path), ".mcp-token-*")
		if err == nil {
			defer os.Remove(temp.Name())
			_, err = fmt.Fprintf(temp, "%x\n", hash)
			if closeErr := temp.Close(); err == nil {
				err = closeErr
			}
			if err == nil {
				err = os.Rename(temp.Name(), a.path)
			}
		}
		if err != nil {
			jsonError(c, 500, "error.config.save_failed")
			return
		}
		a.digest = hash[:]
		c.JSON(200, gin.H{"enabled": true, "token": token})
		return
	case http.MethodDelete:
		if err := os.Remove(a.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			jsonError(c, 500, "error.config.save_failed")
			return
		}
		a.digest = nil
	}
	c.JSON(200, gin.H{"enabled": len(a.digest) > 0})
}
