package main

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// TransferToken represents a temporary file transfer token
type TransferToken struct {
	Type       string    // "download" or "upload"
	FilePath   string    // Server file path (absolute)
	TargetPath string    // Device target path (for download) or save path (for upload)
	DeviceSN   string    // Target device serial number
	ExpiresAt  time.Time // Token expiration time
	OneTime    bool      // If true, token is invalidated after use
	TotalBytes int64     // File size (for progress calculation)
	MD5        string    // File MD5 hash (for download verification)
	Category   string    // File category (scripts/files/reports)
	// SharedSourceID links multiple one-time tokens to one temp source file.
	// When all related tokens are consumed/expired, the temp file is deleted once.
	SharedSourceID string
}

type md5CacheEntry struct {
	size    int64
	modTime int64
	hash    string
}

type sharedTempRef struct {
	path           string
	remaining      int
	pendingCleanup bool
	generation     uint64
}

const (
	md5CacheMaxEntries  = 2048
	md5CacheTrimEntries = 1536
)

var sharedTempCleanupGrace = 10 * time.Second

// Transfer token storage
var (
	transferTokens   = make(map[string]*TransferToken)
	transferTokensMu sync.RWMutex
	sharedTempRefs   = struct {
		sync.Mutex
		entries map[string]*sharedTempRef
	}{
		entries: make(map[string]*sharedTempRef),
	}
	md5Cache = struct {
		sync.RWMutex
		entries map[string]md5CacheEntry
	}{
		entries: make(map[string]md5CacheEntry),
	}
)

// TransferProgress represents file transfer progress
type TransferProgress struct {
	Token        string  `json:"token"`
	DeviceSN     string  `json:"deviceSN"`
	Type         string  `json:"type"` // "download" or "upload"
	TargetPath   string  `json:"targetPath"`
	TotalBytes   int64   `json:"totalBytes"`
	CurrentBytes int64   `json:"currentBytes"`
	Percent      float64 `json:"percent"`
}

func isTempFilePath(filePath string) bool {
	clean := filepath.Clean(filePath)
	needle := string(filepath.Separator) + "_temp" + string(filepath.Separator)
	return strings.Contains(clean, needle)
}

func registerSharedTempRef(sharedID, filePath string) {
	if sharedID == "" || !isTempFilePath(filePath) {
		return
	}

	sharedTempRefs.Lock()
	entry := sharedTempRefs.entries[sharedID]
	if entry == nil {
		sharedTempRefs.entries[sharedID] = &sharedTempRef{
			path:       filePath,
			remaining:  1,
			generation: 1,
		}
		sharedTempRefs.Unlock()
		return
	}
	// Keep the original file path for this shared batch; only count tokens.
	entry.remaining++
	entry.pendingCleanup = false
	entry.generation++
	sharedTempRefs.Unlock()
}

func removeTempFileWithRetry(filePath string) {
	if filePath == "" {
		return
	}
	for i := 0; i < 3; i++ {
		err := os.Remove(filePath)
		if err == nil || os.IsNotExist(err) {
			if err == nil {
				debugLogf("🧹 Cleaned temp file: %s", filepath.Base(filePath))
			}
			return
		}
		if i < 2 {
			time.Sleep(300 * time.Millisecond)
		}
	}
	log.Printf("⚠️ Failed to clean temp file: %s", filePath)
}

func trimMD5CacheLocked() {
	if len(md5Cache.entries) <= md5CacheMaxEntries {
		return
	}

	toRemove := len(md5Cache.entries) - md5CacheTrimEntries
	for key := range md5Cache.entries {
		delete(md5Cache.entries, key)
		toRemove--
		if toRemove <= 0 {
			break
		}
	}
}

func releaseSharedTempRef(sharedID string) {
	if sharedID == "" {
		return
	}

	var (
		cleanupPath string
		generation  uint64
	)

	sharedTempRefs.Lock()
	if entry := sharedTempRefs.entries[sharedID]; entry != nil {
		entry.remaining--
		if entry.remaining <= 0 {
			entry.remaining = 0
			entry.pendingCleanup = true
			entry.generation++
			generation = entry.generation
			cleanupPath = entry.path
		}
	}
	sharedTempRefs.Unlock()

	if cleanupPath != "" {
		delay := sharedTempCleanupGrace
		go func(id string, path string, gen uint64, wait time.Duration) {
			time.Sleep(wait)

			sharedTempRefs.Lock()
			entry := sharedTempRefs.entries[id]
			if entry == nil || entry.generation != gen || entry.remaining > 0 || !entry.pendingCleanup {
				sharedTempRefs.Unlock()
				return
			}
			delete(sharedTempRefs.entries, id)
			sharedTempRefs.Unlock()

			removeTempFileWithRetry(path)
		}(sharedID, cleanupPath, generation, delay)
	}
}

// cleanupExpiredTokens removes expired tokens periodically
func cleanupExpiredTokens() {
	expiredSharedIDs := make([]string, 0)

	now := time.Now()
	transferTokensMu.Lock()
	for token, info := range transferTokens {
		if now.After(info.ExpiresAt) {
			delete(transferTokens, token)
			if info.SharedSourceID != "" {
				expiredSharedIDs = append(expiredSharedIDs, info.SharedSourceID)
			}
		}
	}
	transferTokensMu.Unlock()

	for _, sharedID := range expiredSharedIDs {
		releaseSharedTempRef(sharedID)
	}
}

// createTransferTokenHandler handles POST /api/transfer/create-token
// Creates a temporary token for file download or upload
func createTransferTokenHandler(c *gin.Context) {
	var req struct {
		Type       string `json:"type"`       // "download" or "upload"
		DeviceSN   string `json:"deviceSN"`   // Target device serial number
		Category   string `json:"category"`   // File category
		Path       string `json:"path"`       // File path within category
		TargetPath string `json:"targetPath"` // Device-side target path (for download)
		ExpireSecs int    `json:"expireSecs"` // Token TTL in seconds (default: 300)
		OneTime    *bool  `json:"oneTime"`    // Invalidate after use (default: true)
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Type != "download" && req.Type != "upload" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be 'download' or 'upload'"})
		return
	}

	if req.DeviceSN == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceSN is required"})
		return
	}

	// Validate file path
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// For download, file must exist
	var fileSize int64
	var fileMD5 string
	if req.Type == "download" {
		info, err := os.Stat(filePath)
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if info.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot transfer a directory"})
			return
		}
		fileSize = info.Size()

		// Calculate MD5 for verification (cached by path/size/mtime)
		if md5Hash, err := calculateFileMD5Cached(filePath, info); err == nil {
			fileMD5 = md5Hash
		}

		if req.TargetPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "targetPath is required for download"})
			return
		}
	}

	// For upload, create parent directory if needed
	if req.Type == "upload" {
		parentDir := filepath.Dir(filePath)
		if err := os.MkdirAll(parentDir, 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
			return
		}
	}

	// Generate token
	token := uuid.New().String()

	// Set expiration
	expireSecs := req.ExpireSecs
	if expireSecs <= 0 {
		expireSecs = 300 // Default 5 minutes
	}
	expiresAt := time.Now().Add(time.Duration(expireSecs) * time.Second)

	oneTime := true
	if req.OneTime != nil {
		oneTime = *req.OneTime
	}

	// Store token
	transferTokensMu.Lock()
	transferTokens[token] = &TransferToken{
		Type:       req.Type,
		FilePath:   filePath,
		TargetPath: req.TargetPath,
		DeviceSN:   req.DeviceSN,
		ExpiresAt:  expiresAt,
		OneTime:    oneTime,
		TotalBytes: fileSize,
		MD5:        fileMD5,
		Category:   req.Category,
	}
	transferTokensMu.Unlock()

	// Build download/upload URL
	var transferURL string
	if req.Type == "download" {
		transferURL = fmt.Sprintf("/api/transfer/download/%s", token)
	} else {
		transferURL = fmt.Sprintf("/api/transfer/upload/%s", token)
	}

	debugLogf("🔑 Transfer token created: %s (%s) for device %s", token[:8]+"...", req.Type, req.DeviceSN)

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"url":        transferURL,
		"type":       req.Type,
		"expiresAt":  expiresAt.Unix(),
		"totalBytes": fileSize,
		"md5":        fileMD5,
	})
}

// ProgressWriter wraps an io.Writer to track write progress
type ProgressWriter struct {
	w           io.Writer
	total       int64
	written     int64
	token       string
	deviceSN    string
	targetPath  string
	onProgress  func(progress TransferProgress)
	lastReport  time.Time
	minInterval time.Duration
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n, err := pw.w.Write(p)
	pw.written += int64(n)

	// Throttle progress updates
	now := time.Now()
	if pw.onProgress != nil && now.Sub(pw.lastReport) >= pw.minInterval {
		pw.lastReport = now
		percent := float64(0)
		if pw.total > 0 {
			percent = float64(pw.written) / float64(pw.total) * 100
		}
		pw.onProgress(TransferProgress{
			Token:        pw.token,
			DeviceSN:     pw.deviceSN,
			Type:         "download",
			TargetPath:   pw.targetPath,
			TotalBytes:   pw.total,
			CurrentBytes: pw.written,
			Percent:      percent,
		})
	}

	return n, err
}

// ProgressReader wraps an io.Reader to track read progress (for uploads)
type ProgressReader struct {
	r           io.Reader
	total       int64
	read        int64
	token       string
	deviceSN    string
	filePath    string
	onProgress  func(progress TransferProgress)
	lastReport  time.Time
	minInterval time.Duration
}

func (pr *ProgressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.read += int64(n)

	// Throttle progress updates
	now := time.Now()
	if pr.onProgress != nil && now.Sub(pr.lastReport) >= pr.minInterval {
		pr.lastReport = now
		percent := float64(0)
		if pr.total > 0 {
			percent = float64(pr.read) / float64(pr.total) * 100
		}
		pr.onProgress(TransferProgress{
			Token:        pr.token,
			DeviceSN:     pr.deviceSN,
			Type:         "upload",
			TargetPath:   pr.filePath,
			TotalBytes:   pr.total,
			CurrentBytes: pr.read,
			Percent:      percent,
		})
	}

	return n, err
}

// transferDownloadHandler handles GET /api/transfer/download/:token
// This endpoint does NOT require authentication - the token IS the auth
func transferDownloadHandler(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
		return
	}

	// Lookup token
	transferTokensMu.RLock()
	tokenInfo, exists := transferTokens[token]
	transferTokensMu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found or expired"})
		return
	}

	// Check expiration
	if time.Now().After(tokenInfo.ExpiresAt) {
		var sharedID string
		transferTokensMu.Lock()
		if info, ok := transferTokens[token]; ok {
			delete(transferTokens, token)
			sharedID = info.SharedSourceID
		}
		transferTokensMu.Unlock()
		if sharedID != "" {
			releaseSharedTempRef(sharedID)
		}
		c.JSON(http.StatusGone, gin.H{"error": "token expired"})
		return
	}

	// Check type
	if tokenInfo.Type != "download" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is not for download"})
		return
	}

	// Invalidate one-time token
	releaseSharedID := ""
	if tokenInfo.OneTime {
		transferTokensMu.Lock()
		if info, ok := transferTokens[token]; ok {
			delete(transferTokens, token)
			releaseSharedID = info.SharedSourceID
		}
		transferTokensMu.Unlock()
	}

	// Open file
	file, err := os.Open(tokenInfo.FilePath)
	if err != nil {
		if releaseSharedID != "" {
			releaseSharedTempRef(releaseSharedID)
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
		return
	}
	if releaseSharedID != "" {
		defer releaseSharedTempRef(releaseSharedID)
	}
	defer file.Close()

	// Get file info
	info, err := file.Stat()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to stat file"})
		return
	}

	// Set headers
	fileName := filepath.Base(tokenInfo.FilePath)
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	c.Header("Content-Length", fmt.Sprintf("%d", info.Size()))
	c.Header("X-File-MD5", tokenInfo.MD5)

	// Create progress writer
	pw := &ProgressWriter{
		w:           c.Writer,
		total:       info.Size(),
		token:       token,
		deviceSN:    tokenInfo.DeviceSN,
		targetPath:  tokenInfo.TargetPath,
		minInterval: 200 * time.Millisecond,
		onProgress: func(progress TransferProgress) {
			// Broadcast progress to frontend via WebSocket
			broadcastTransferProgress(progress)
		},
	}

	debugLogf("📥 Download started: %s → device %s (%d bytes)",
		fileName, tokenInfo.DeviceSN, info.Size())

	// Stream file content
	_, err = io.Copy(pw, file)
	if err != nil {
		log.Printf("❌ Download failed: %s - %v", fileName, err)
		return
	}

	debugLogf("✅ Download completed: %s → device %s", fileName, tokenInfo.DeviceSN)

	// Clean up temp files after successful download
	// Shared temp file cleanup is managed by shared token ref-count.
	// Non-shared temp files keep existing one-time cleanup behavior.
	if tokenInfo.SharedSourceID == "" && isTempFilePath(tokenInfo.FilePath) {
		go removeTempFileWithRetry(tokenInfo.FilePath)
	}
}

// transferUploadHandler handles PUT /api/transfer/upload/:token
// This endpoint does NOT require authentication - the token IS the auth
func transferUploadHandler(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
		return
	}

	// Lookup token
	transferTokensMu.RLock()
	tokenInfo, exists := transferTokens[token]
	transferTokensMu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found or expired"})
		return
	}

	// Check expiration
	if time.Now().After(tokenInfo.ExpiresAt) {
		transferTokensMu.Lock()
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		c.JSON(http.StatusGone, gin.H{"error": "token expired"})
		return
	}

	// Check type
	if tokenInfo.Type != "upload" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is not for upload"})
		return
	}

	// Invalidate one-time token
	if tokenInfo.OneTime {
		transferTokensMu.Lock()
		delete(transferTokens, token)
		transferTokensMu.Unlock()
	}

	// Get content length
	contentLength := c.Request.ContentLength

	// Create file
	file, err := os.Create(tokenInfo.FilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
		return
	}
	defer file.Close()

	// Create progress reader
	pr := &ProgressReader{
		r:           c.Request.Body,
		total:       contentLength,
		token:       token,
		deviceSN:    tokenInfo.DeviceSN,
		filePath:    tokenInfo.FilePath,
		minInterval: 200 * time.Millisecond,
		onProgress: func(progress TransferProgress) {
			// Broadcast progress to frontend via WebSocket
			broadcastTransferProgress(progress)
		},
	}

	fileName := filepath.Base(tokenInfo.FilePath)
	debugLogf("📤 Upload started: device %s → %s (%d bytes)",
		tokenInfo.DeviceSN, fileName, contentLength)

	// Copy with progress tracking
	hashWriter := md5.New()
	written, err := io.Copy(io.MultiWriter(file, hashWriter), pr)
	if err != nil {
		log.Printf("❌ Upload failed: %s - %v", fileName, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file"})
		return
	}

	// MD5 is computed while streaming upload data to avoid a second full-file read.
	md5Hash := hex.EncodeToString(hashWriter.Sum(nil))
	if info, statErr := file.Stat(); statErr == nil {
		md5Cache.Lock()
		trimMD5CacheLocked()
		md5Cache.entries[tokenInfo.FilePath] = md5CacheEntry{
			size:    info.Size(),
			modTime: info.ModTime().UnixNano(),
			hash:    md5Hash,
		}
		md5Cache.Unlock()
	}

	debugLogf("✅ Upload completed: device %s → %s (%d bytes, MD5: %s)",
		tokenInfo.DeviceSN, fileName, written, md5Hash)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"bytes":   written,
		"md5":     md5Hash,
		"path":    tokenInfo.FilePath,
	})
}

// calculateFileMD5Cached calculates the MD5 hash with a small cache keyed by path/size/mtime
func calculateFileMD5Cached(filePath string, info os.FileInfo) (string, error) {
	if info == nil {
		statInfo, err := os.Stat(filePath)
		if err != nil {
			return "", err
		}
		info = statInfo
	}

	size := info.Size()
	modTime := info.ModTime().UnixNano()

	md5Cache.RLock()
	if entry, ok := md5Cache.entries[filePath]; ok && entry.size == size && entry.modTime == modTime {
		md5Cache.RUnlock()
		return entry.hash, nil
	}
	md5Cache.RUnlock()

	hash, err := calculateFileMD5(filePath)
	if err != nil {
		return "", err
	}

	md5Cache.Lock()
	trimMD5CacheLocked()
	md5Cache.entries[filePath] = md5CacheEntry{
		size:    size,
		modTime: modTime,
		hash:    hash,
	}
	md5Cache.Unlock()

	return hash, nil
}

// calculateFileMD5 calculates the MD5 hash of a file
func calculateFileMD5(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := md5.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

func snapshotControllerConns() []*SafeConn {
	mu.RLock()
	if len(controllers) == 0 {
		mu.RUnlock()
		return nil
	}
	controllerList := make([]*SafeConn, 0, len(controllers))
	for conn := range controllers {
		controllerList = append(controllerList, conn)
	}
	mu.RUnlock()
	return controllerList
}

// broadcastTransferProgress sends transfer progress to all connected controllers
func broadcastTransferProgress(progress TransferProgress) {
	controllerList := snapshotControllerConns()
	if len(controllerList) == 0 {
		return
	}

	msg := Message{
		Type: "transfer/progress",
		Body: progress,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("❌ Failed to marshal progress: %v", err)
		return
	}

	for _, conn := range controllerList {
		writeTextMessageAsync(conn, data)
	}
}

// broadcastDeviceMessage sends a status message for a device to all connected controllers
func broadcastDeviceMessage(udid string, message string) {
	controllerList := snapshotControllerConns()
	if len(controllerList) == 0 {
		return
	}

	msg := Message{
		Type: "device/message",
		Body: map[string]string{
			"udid":    udid,
			"message": message,
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("❌ Failed to marshal device message: %v", err)
		return
	}

	// Send messages without holding the lock
	for _, conn := range controllerList {
		writeTextMessageAsync(conn, data)
	}
}

// sendFileDownloadCommand sends a file download command to a device
func sendFileDownloadCommand(deviceSN string, downloadURL string, targetPath string, md5 string, totalBytes int64, timeout int) error {
	mu.RLock()
	conn, exists := deviceLinks[deviceSN]
	mu.RUnlock()

	if !exists {
		return fmt.Errorf("device %s not connected", deviceSN)
	}

	cmd := Message{
		Type: "transfer/fetch",
		Body: map[string]interface{}{
			"url":        downloadURL,
			"targetPath": targetPath,
			"md5":        md5,
			"totalBytes": totalBytes,
			"timeout":    timeout,
		},
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}

	return conn.WriteMessage(1, data)
}

// sendFileUploadCommand sends a file upload command to a device
func sendFileUploadCommand(deviceSN string, uploadURL string, sourcePath string, savePath string, timeout int) error {
	mu.RLock()
	conn, exists := deviceLinks[deviceSN]
	mu.RUnlock()

	if !exists {
		return fmt.Errorf("device %s not connected", deviceSN)
	}

	cmd := Message{
		Type: "transfer/send",
		Body: map[string]interface{}{
			"url":        uploadURL,
			"sourcePath": sourcePath,
			"savePath":   savePath,
			"timeout":    timeout,
		},
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}

	return conn.WriteMessage(1, data)
}

// pushFileToDeviceHandler handles POST /api/transfer/push-to-device
// High-level API that creates token and sends command in one call
// Uses file/put for small files (<128KB) and transfer/fetch for large files
func pushFileToDeviceHandler(c *gin.Context) {
	var req struct {
		DeviceSN       string `json:"deviceSN"`
		Category       string `json:"category"`
		Path           string `json:"path"`
		TargetPath     string `json:"targetPath"`
		Timeout        int    `json:"timeout"`       // Download timeout in seconds
		ServerBaseUrl  string `json:"serverBaseUrl"` // Server base URL for device to download from
		SharedSourceID string `json:"sharedSourceId"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.DeviceSN == "" || req.Category == "" || req.Path == "" || req.TargetPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceSN, category, path, and targetPath are required"})
		return
	}

	// Validate file
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot push a directory"})
		return
	}

	const LargeFileThreshold int64 = 128 * 1024 // 128KB
	fileSize := info.Size()

	// Small file: use file/put via WebSocket
	if fileSize < LargeFileThreshold {
		content, err := os.ReadFile(filePath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
			return
		}

		base64Data := base64.StdEncoding.EncodeToString(content)

		// Send file/put command via WebSocket
		mu.RLock()
		conn, exists := deviceLinks[req.DeviceSN]
		mu.RUnlock()

		if !exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device not connected"})
			return
		}

		putMsg := Message{
			Type: "file/put",
			Body: map[string]interface{}{
				"path": req.TargetPath,
				"data": base64Data,
			},
		}

		if err := sendMessage(conn, putMsg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send file to device"})
			return
		}

		// Broadcast status to frontend
		broadcastDeviceMessage(req.DeviceSN, fmt.Sprintf("发送文件 %s", filepath.Base(req.Path)))

		debugLogf("📤 Push file (small): %s → device %s:%s (%d bytes)", req.Path, req.DeviceSN, req.TargetPath, fileSize)

		c.JSON(http.StatusOK, gin.H{
			"success":    true,
			"method":     "file/put",
			"totalBytes": fileSize,
		})
		return
	}

	// Large file: use transfer/fetch (existing logic)
	token := uuid.New().String()
	expiresAt := time.Now().Add(5 * time.Minute)

	md5Hash, _ := calculateFileMD5Cached(filePath, info)

	transferTokensMu.Lock()
	if req.SharedSourceID != "" {
		registerSharedTempRef(req.SharedSourceID, filePath)
	}
	transferTokens[token] = &TransferToken{
		Type:           "download",
		FilePath:       filePath,
		TargetPath:     req.TargetPath,
		DeviceSN:       req.DeviceSN,
		ExpiresAt:      expiresAt,
		OneTime:        true,
		TotalBytes:     info.Size(),
		MD5:            md5Hash,
		Category:       req.Category,
		SharedSourceID: req.SharedSourceID,
	}
	transferTokensMu.Unlock()

	// Build download URL path
	downloadPath := fmt.Sprintf("/api/transfer/download/%s", token)

	// Build full download URL using serverBaseUrl if provided
	downloadURL := downloadPath
	if req.ServerBaseUrl != "" {
		downloadURL = req.ServerBaseUrl + downloadPath
	}

	// Set timeout
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 300 // Default 5 minutes
	}

	// Send command to device
	// Broadcast status to frontend
	broadcastDeviceMessage(req.DeviceSN, fmt.Sprintf("下载文件 %s", filepath.Base(req.Path)))

	if err := sendFileDownloadCommand(req.DeviceSN, downloadURL, req.TargetPath, md5Hash, info.Size(), timeout); err != nil {
		// Cleanup token on failure
		sharedID := ""
		transferTokensMu.Lock()
		if info, ok := transferTokens[token]; ok {
			sharedID = info.SharedSourceID
		}
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		if sharedID != "" {
			releaseSharedTempRef(sharedID)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	debugLogf("📤 Push file (large): %s → device %s:%s (%d bytes)", req.Path, req.DeviceSN, req.TargetPath, fileSize)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"method":     "transfer/fetch",
		"token":      token,
		"totalBytes": info.Size(),
		"md5":        md5Hash,
	})
}

// pullFileFromDeviceHandler handles POST /api/transfer/pull-from-device
// High-level API that creates token and sends command in one call
func pullFileFromDeviceHandler(c *gin.Context) {
	var req struct {
		DeviceSN      string `json:"deviceSN"`
		SourcePath    string `json:"sourcePath"`    // Device-side file path
		Category      string `json:"category"`      // Server-side category
		Path          string `json:"path"`          // Server-side save path
		Timeout       int    `json:"timeout"`       // Upload timeout in seconds
		ServerBaseUrl string `json:"serverBaseUrl"` // Server base URL for device to upload to
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.DeviceSN == "" || req.SourcePath == "" || req.Category == "" || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceSN, sourcePath, category, and path are required"})
		return
	}

	// Validate and prepare save path
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create parent directory
	parentDir := filepath.Dir(filePath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
		return
	}

	// Generate token
	token := uuid.New().String()
	expiresAt := time.Now().Add(5 * time.Minute)

	transferTokensMu.Lock()
	transferTokens[token] = &TransferToken{
		Type:       "upload",
		FilePath:   filePath,
		TargetPath: req.SourcePath, // Store device source path for reference
		DeviceSN:   req.DeviceSN,
		ExpiresAt:  expiresAt,
		OneTime:    true,
		Category:   req.Category,
	}
	transferTokensMu.Unlock()

	// Build upload URL path
	uploadPath := fmt.Sprintf("/api/transfer/upload/%s", token)

	// Build full upload URL using serverBaseUrl if provided
	uploadURL := uploadPath
	if req.ServerBaseUrl != "" {
		uploadURL = req.ServerBaseUrl + uploadPath
	}

	// Set timeout
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 300 // Default 5 minutes
	}

	// Send command to device
	if err := sendFileUploadCommand(req.DeviceSN, uploadURL, req.SourcePath, req.Path, timeout); err != nil {
		// Cleanup token on failure
		transferTokensMu.Lock()
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	debugLogf("📥 Pull file initiated: device %s:%s → %s", req.DeviceSN, req.SourcePath, req.Path)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"token":   token,
	})
}

// Start cleanup goroutine
func init() {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupExpiredTokens()
		}
	}()
}
