package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	authSkewSeconds   int64 = 60
	nonceTTLSeconds   int64 = 120
	nonceCleanupEvery       = 30 * time.Second
	authQueryTSKey          = "ts"
	authQueryNonceKey       = "nonce"
	authQuerySignKey        = "sign"
)

var usedNonces = struct {
	sync.Mutex
	store map[string]int64
}{
	store: make(map[string]int64),
}

func debugAuthf(format string, args ...interface{}) {
	if os.Getenv("XXT_AUTH_DEBUG") != "" {
		log.Printf(format, args...)
	}
}

func isTimestampValid(ts int64) bool {
	if ts == 0 {
		return false
	}
	currentTime := time.Now().Unix()
	return ts >= currentTime-authSkewSeconds && ts <= currentTime+authSkewSeconds
}

func cleanupExpiredNonces(now int64) int {
	cutoff := now - nonceTTLSeconds
	removed := 0

	usedNonces.Lock()
	for k, ts := range usedNonces.store {
		if ts < cutoff {
			delete(usedNonces.store, k)
			removed++
		}
	}
	usedNonces.Unlock()

	return removed
}

func startNonceCleanupTicker() {
	ticker := time.NewTicker(nonceCleanupEvery)
	go func() {
		defer ticker.Stop()
		for range ticker.C {
			cleanupExpiredNonces(time.Now().Unix())
		}
	}()
}

func checkAndStoreNonce(namespace, nonce string) bool {
	if nonce == "" {
		return false
	}
	currentTime := time.Now().Unix()
	cutoff := currentTime - nonceTTLSeconds
	key := namespace + ":" + nonce

	usedNonces.Lock()
	defer usedNonces.Unlock()

	if ts, exists := usedNonces.store[key]; exists && ts >= cutoff {
		debugAuthf("[auth] nonce replay rejected: ns=%s nonce=%s", namespace, nonce)
		return false
	}
	usedNonces.store[key] = currentTime
	return true
}

func hashBytesHex(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func hashJSONHex(body interface{}) string {
	if body == nil {
		return ""
	}
	data, err := json.Marshal(body)
	if err != nil {
		return ""
	}
	return hashBytesHex(data)
}

func buildHTTPSignatureString(ts int64, nonce, method, path, bodyHash string) string {
	return fmt.Sprintf("%d\n%s\n%s\n%s\n%s", ts, nonce, method, path, bodyHash)
}

func buildMessageSignatureString(ts int64, nonce, msgType, bodyHash string) string {
	return fmt.Sprintf("%d\n%s\n%s\n%s", ts, nonce, msgType, bodyHash)
}

func computeSignatureHex(message string) string {
	h := hmac.New(sha256.New, passhash)
	h.Write([]byte(message))
	return hex.EncodeToString(h.Sum(nil))
}

func verifySignature(expected, actual string) bool {
	return hmac.Equal([]byte(expected), []byte(actual))
}

func canonicalRequestPath(u *url.URL) string {
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}

	values := u.Query()
	values.Del(authQueryTSKey)
	values.Del(authQueryNonceKey)
	values.Del(authQuerySignKey)

	if len(values) == 0 {
		return path
	}

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var builder strings.Builder
	builder.WriteString(path)
	builder.WriteByte('?')
	first := true
	for _, key := range keys {
		vals := values[key]
		sort.Strings(vals)
		for _, val := range vals {
			if !first {
				builder.WriteByte('&')
			}
			first = false
			builder.WriteString(url.QueryEscape(key))
			builder.WriteByte('=')
			builder.WriteString(url.QueryEscape(val))
		}
	}
	return builder.String()
}

func readRequestBodyBytes(r io.ReadCloser) ([]byte, io.ReadCloser, error) {
	if r == nil {
		return nil, r, nil
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, r, err
	}
	return data, io.NopCloser(bytes.NewBuffer(data)), nil
}

func verifyHTTPRequestSignature(ts int64, nonce, sign, method, path string, bodyBytes []byte) bool {
	if !isTimestampValid(ts) {
		debugAuthf("[auth] http invalid timestamp: ts=%d method=%s path=%s", ts, method, path)
		return false
	}
	bodyHash := hashBytesHex(bodyBytes)
	signatureBase := buildHTTPSignatureString(ts, nonce, method, path, bodyHash)
	expected := computeSignatureHex(signatureBase)
	if !verifySignature(expected, sign) {
		debugAuthf("[auth] http signature mismatch: method=%s path=%s ts=%d nonce=%s expected=%s got=%s bodyHash=%s",
			method, path, ts, nonce, expected, sign, bodyHash)
		return false
	}
	return checkAndStoreNonce("http", nonce)
}

func verifyMessageSignature(data Message) bool {
	if !isTimestampValid(data.TS) {
		debugAuthf("[auth] ws invalid timestamp: ts=%d type=%s", data.TS, data.Type)
		return false
	}
	bodyHash := hashJSONHex(data.Body)
	signatureBase := buildMessageSignatureString(data.TS, data.Nonce, data.Type, bodyHash)
	expected := computeSignatureHex(signatureBase)
	if !verifySignature(expected, data.Sign) {
		debugAuthf("[auth] ws signature mismatch: type=%s ts=%d nonce=%s expected=%s got=%s bodyHash=%s",
			data.Type, data.TS, data.Nonce, expected, data.Sign, bodyHash)
		return false
	}
	return checkAndStoreNonce("ws", data.Nonce)
}

func init() {
	startNonceCleanupTicker()
}
