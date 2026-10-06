package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	Type                 string    // "download" or "upload"
	FilePath             string    // Server file path (absolute)
	TargetPath           string    // Device target path (for download) or save path (for upload)
	DeviceSN             string    // Target device serial number
	ExpiresAt            time.Time // Token expiration time
	OneTime              bool      // If true, token is invalidated after use
	TotalBytes           int64     // File size (for progress calculation)
	MD5                  string    // File MD5 hash (for download verification)
	Category             string    // File category (scripts/files/reports)
	DeviceTransferID     string
	BrowserDownloadToken string
	UploadPending        bool
	// 令牌与进行中的下载共同持有临时源文件，避免其他设备或过期清理提前删除它。
	SharedSourceID string
}

type sharedTempRef struct {
	path                 string
	remaining            int
	pendingRegistrations int
	registrationDeadline time.Time
	pendingCleanup       bool
	generation           uint64
}

const (
	md5CacheMaxEntries        = 2048
	md5CacheTrimEntries       = 1536
	defaultTransferTimeoutSec = 300
	defaultTransferTokenTTL   = 5 * time.Minute
	transferTokenTTLGrace     = 30 * time.Second
	transferIOIdleTimeout     = 300 * time.Second
)

var sharedTempCleanupGrace = 10 * time.Second

func normalizeTransferTimeoutSeconds(requestedSeconds int) int {
	timeout := requestedSeconds
	if timeout <= 0 {
		timeout = defaultTransferTimeoutSec
	}
	return timeout
}

func transferTokenTTLForTimeout(timeoutSeconds int) time.Duration {
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultTransferTimeoutSec
	}
	ttl := time.Duration(timeoutSeconds)*time.Second + transferTokenTTLGrace
	if ttl < defaultTransferTokenTTL {
		return defaultTransferTokenTTL
	}
	return ttl
}

func clearTransferRequestDeadlines(c *gin.Context) {
	if c == nil {
		return
	}
	rc := http.NewResponseController(c.Writer)
	if err := rc.SetReadDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		debugLogf("⚠️ Failed to clear transfer read deadline: %v", err)
	}
	if err := rc.SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		debugLogf("⚠️ Failed to clear transfer write deadline: %v", err)
	}
}

func makeTransferDeadlineTouchers(c *gin.Context, idleTimeout time.Duration) (touchRead func(), touchWrite func()) {
	if c == nil || idleTimeout <= 0 {
		return nil, nil
	}

	rc := http.NewResponseController(c.Writer)
	readUnsupported := false
	writeUnsupported := false

	touchRead = func() {
		if readUnsupported {
			return
		}
		if err := rc.SetReadDeadline(time.Now().Add(idleTimeout)); err != nil {
			if errors.Is(err, http.ErrNotSupported) {
				readUnsupported = true
				return
			}
			debugLogf("⚠️ Failed to update transfer read deadline: %v", err)
		}
	}

	touchWrite = func() {
		if writeUnsupported {
			return
		}
		if err := rc.SetWriteDeadline(time.Now().Add(idleTimeout)); err != nil {
			if errors.Is(err, http.ErrNotSupported) {
				writeUnsupported = true
				return
			}
			debugLogf("⚠️ Failed to update transfer write deadline: %v", err)
		}
	}

	return touchRead, touchWrite
}

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
	md5Cache = fileMD5Cache{
		entries:  make(map[string]md5CacheEntry),
		pending:  make(map[md5FileVersion]*pendingMD5),
		hashFile: calculateFileMD5,
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

func registerSharedTempRef(sharedID, filePath string, total int) {
	if sharedID == "" || !isTempFilePath(filePath) {
		return
	}

	sharedTempRefs.Lock()
	entry := sharedTempRefs.entries[sharedID]
	if entry == nil {
		entry = &sharedTempRef{
			path:       filePath,
			remaining:  1,
			generation: 1,
		}
		if total > 1 {
			entry.pendingRegistrations = total - 1
			entry.registrationDeadline = time.Now().Add(defaultTransferTokenTTL)
		}
		sharedTempRefs.entries[sharedID] = entry
		sharedTempRefs.Unlock()
		return
	}
	// 后续批次沿用最初的源文件，避免改变整批传输的清理目标。
	entry.remaining++
	if entry.pendingRegistrations > 0 {
		entry.pendingRegistrations--
		entry.registrationDeadline = time.Now().Add(defaultTransferTokenTTL)
	}
	entry.pendingCleanup = false
	entry.generation++
	sharedTempRefs.Unlock()
}

func retainDownloadTempSource(filePath, sharedID string, total int) string {
	if !isTempFilePath(filePath) {
		return sharedID
	}
	if sharedID == "" {
		// 单设备和直接创建的下载令牌也要持有引用，过期与下载结束走同一条回收路径。
		sharedID = "temp-source:" + filepath.Clean(filePath)
	}
	registerSharedTempRef(sharedID, filePath, total)
	return sharedID
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
			parent := filepath.Dir(filePath)
			if filepath.Base(filepath.Dir(parent)) == "_temp" && (strings.HasPrefix(filepath.Base(parent), "upload-") || strings.HasPrefix(filepath.Base(parent), "download-")) {
				// 每次上传的隔离目录只在为空时删除，不能连带移除仍被使用的文件。
				_ = os.Remove(parent)
			}
			return
		}
		if i < 2 {
			time.Sleep(300 * time.Millisecond)
		}
	}
	log.Printf("⚠️ Failed to clean temp file: %s", filePath)
}

func releaseSharedTempRef(sharedID string) {
	if sharedID == "" {
		return
	}

	sharedTempRefs.Lock()
	if entry := sharedTempRefs.entries[sharedID]; entry != nil {
		if entry.remaining > 0 {
			entry.remaining--
		}
		scheduleSharedTempCleanupLocked(sharedID, entry)
	}
	sharedTempRefs.Unlock()
}

func scheduleSharedTempCleanupLocked(sharedID string, entry *sharedTempRef) {
	// 分批分发时，已完成下载的设备不能提前删除尚未创建传输令牌的设备所需的源文件。
	if entry.remaining > 0 || entry.pendingRegistrations > 0 || entry.pendingCleanup {
		return
	}
	entry.pendingCleanup = true
	entry.generation++
	go func(path string, generation uint64, wait time.Duration) {
		time.Sleep(wait)

		sharedTempRefs.Lock()
		current := sharedTempRefs.entries[sharedID]
		if current != entry || current.generation != generation || current.remaining > 0 || current.pendingRegistrations > 0 || !current.pendingCleanup {
			sharedTempRefs.Unlock()
			return
		}
		delete(sharedTempRefs.entries, sharedID)
		sharedTempRefs.Unlock()
		removeTempFileWithRetry(path)
	}(entry.path, entry.generation, sharedTempCleanupGrace)
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

	sharedTempRefs.Lock()
	for sharedID, entry := range sharedTempRefs.entries {
		if entry.pendingRegistrations > 0 && !now.Before(entry.registrationDeadline) {
			// 浏览器中途退出时，让未发出的请求过期；仍在下载的设备继续持有各自引用。
			entry.pendingRegistrations = 0
			scheduleSharedTempCleanupLocked(sharedID, entry)
		}
	}
	sharedTempRefs.Unlock()

	deviceFileTransfers.Lock()
	for requestID, transfer := range deviceFileTransfers.byID {
		if !transfer.expiresAt.IsZero() && !now.Before(transfer.expiresAt) {
			delete(deviceFileTransfers.byPath, transfer.key)
			delete(deviceFileTransfers.byID, requestID)
		}
	}
	deviceFileTransfers.Unlock()
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
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}

	if req.Type != "download" && req.Type != "upload" {
		jsonError(c, http.StatusBadRequest, "type must be 'download' or 'upload'")
		return
	}

	if req.DeviceSN == "" {
		jsonError(c, http.StatusBadRequest, "deviceSN is required")
		return
	}

	// Validate file path
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	// For download, file must exist
	var fileSize int64
	var fileMD5 string
	if req.Type == "download" {
		info, err := os.Stat(filePath)
		if os.IsNotExist(err) {
			jsonError(c, http.StatusNotFound, "file not found")
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, err.Error())
			return
		}
		if info.IsDir() {
			jsonError(c, http.StatusBadRequest, "cannot transfer a directory")
			return
		}
		fileSize = info.Size()

		// Calculate MD5 for verification (cached by path/size/mtime)
		if md5Hash, err := md5Cache.get(filePath, info); err == nil {
			fileMD5 = md5Hash
		}

		if req.TargetPath == "" {
			jsonError(c, http.StatusBadRequest, "targetPath is required for download")
			return
		}
	}

	// For upload, create parent directory if needed
	if req.Type == "upload" {
		parentDir := filepath.Dir(filePath)
		if err := os.MkdirAll(parentDir, 0755); err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create directory")
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
	sharedSourceID := ""
	if req.Type == "download" {
		sharedSourceID = retainDownloadTempSource(filePath, "", 0)
	}
	transferTokens[token] = &TransferToken{
		Type:           req.Type,
		FilePath:       filePath,
		TargetPath:     req.TargetPath,
		DeviceSN:       req.DeviceSN,
		ExpiresAt:      expiresAt,
		OneTime:        oneTime,
		TotalBytes:     fileSize,
		MD5:            fileMD5,
		Category:       req.Category,
		SharedSourceID: sharedSourceID,
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
	touchWrite  func()
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	if pw.touchWrite != nil {
		pw.touchWrite()
	}

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
	touchRead   func()
}

func (pr *ProgressReader) Read(p []byte) (int, error) {
	if pr.touchRead != nil {
		pr.touchRead()
	}

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
	clearTransferRequestDeadlines(c)
	_, touchWriteDeadline := makeTransferDeadlineTouchers(c, transferIOIdleTimeout)
	if touchWriteDeadline != nil {
		touchWriteDeadline()
	}

	token := c.Param("token")
	if token == "" {
		jsonError(c, http.StatusBadRequest, "token is required")
		return
	}

	// 领取令牌和保留下载引用必须一起完成，避免过期清理抢先释放正在使用的源文件。
	transferTokensMu.Lock()
	tokenInfo, exists := transferTokens[token]

	if !exists {
		transferTokensMu.Unlock()
		jsonError(c, http.StatusNotFound, "token not found or expired")
		return
	}

	// Check expiration
	if time.Now().After(tokenInfo.ExpiresAt) {
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		if tokenInfo.SharedSourceID != "" {
			releaseSharedTempRef(tokenInfo.SharedSourceID)
		}
		jsonError(c, http.StatusGone, "token expired")
		return
	}

	// Check type
	if tokenInfo.Type != "download" {
		transferTokensMu.Unlock()
		jsonError(c, http.StatusBadRequest, "token is not for download")
		return
	}
	if tokenInfo.UploadPending {
		transferTokensMu.Unlock()
		jsonError(c, http.StatusConflict, errDeviceFileTransferBusy.Error())
		return
	}

	releaseSharedID := tokenInfo.SharedSourceID
	if tokenInfo.OneTime {
		delete(transferTokens, token)
	} else if releaseSharedID != "" {
		// 可重复使用的令牌本身与本次下载分别持有引用，令牌过期不应中断下载。
		registerSharedTempRef(releaseSharedID, tokenInfo.FilePath, 0)
	}
	transferTokensMu.Unlock()
	if releaseSharedID != "" {
		defer releaseSharedTempRef(releaseSharedID)
	}

	// Open file
	file, err := os.Open(tokenInfo.FilePath)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to open file")
		return
	}
	defer file.Close()

	// Get file info
	info, err := file.Stat()
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to stat file")
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
		touchWrite:  touchWriteDeadline,
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
	// Do not treat HTTP stream completion as device fetch completion.
	// Script-start orchestration must only be driven by device WS message:
	// transfer/fetch/complete.

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
	clearTransferRequestDeadlines(c)
	touchReadDeadline, _ := makeTransferDeadlineTouchers(c, transferIOIdleTimeout)
	if touchReadDeadline != nil {
		touchReadDeadline()
	}

	token := c.Param("token")
	if token == "" {
		jsonError(c, http.StatusBadRequest, "token is required")
		return
	}

	// 一次性上传令牌必须在同一个临界区内领取，避免并发请求同时覆盖目标。
	transferTokensMu.Lock()
	tokenInfo, exists := transferTokens[token]

	if !exists {
		transferTokensMu.Unlock()
		jsonError(c, http.StatusNotFound, "token not found or expired")
		return
	}

	// Check expiration
	if time.Now().After(tokenInfo.ExpiresAt) {
		delete(transferTokens, token)
		transferTokensMu.Unlock()
		if tokenInfo.SharedSourceID != "" {
			releaseSharedTempRef(tokenInfo.SharedSourceID)
		}
		jsonError(c, http.StatusGone, "token expired")
		return
	}

	// Check type
	if tokenInfo.Type != "upload" {
		transferTokensMu.Unlock()
		jsonError(c, http.StatusBadRequest, "token is not for upload")
		return
	}

	// Invalidate one-time token
	if tokenInfo.OneTime {
		delete(transferTokens, token)
	}
	transferTokensMu.Unlock()

	// Get content length
	contentLength := c.Request.ContentLength
	if tokenInfo.DeviceTransferID != "" {
		deviceFileTransfers.Lock()
		if transfer := deviceFileTransfers.byID[tokenInfo.DeviceTransferID]; transfer != nil {
			transfer.expiresAt = time.Time{}
		}
		deviceFileTransfers.Unlock()
		defer finishDeviceFileTransfer(tokenInfo.DeviceTransferID)
	}
	uploadComplete := false
	if tokenInfo.SharedSourceID != "" && tokenInfo.OneTime {
		// 上传令牌消费后由正在进行的接收继续持有源文件，不能被下载令牌过期清理抢先删除。
		defer func() {
			if !uploadComplete && tokenInfo.BrowserDownloadToken != "" {
				transferTokensMu.Lock()
				download := transferTokens[tokenInfo.BrowserDownloadToken]
				delete(transferTokens, tokenInfo.BrowserDownloadToken)
				transferTokensMu.Unlock()
				if download != nil {
					releaseSharedTempRef(download.SharedSourceID)
				}
			}
			releaseSharedTempRef(tokenInfo.SharedSourceID)
		}()
	}

	// Create progress reader
	pr := &ProgressReader{
		r:           c.Request.Body,
		total:       contentLength,
		token:       token,
		deviceSN:    tokenInfo.DeviceSN,
		filePath:    tokenInfo.FilePath,
		minInterval: 200 * time.Millisecond,
		touchRead:   touchReadDeadline,
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
	written, info, err := replaceUploadedFile(c.Request.Context(), tokenInfo.FilePath, io.TeeReader(pr, hashWriter), contentLength)
	if err != nil {
		log.Printf("❌ Upload failed: %s - %v", fileName, err)
		if errors.Is(err, errUploadSizeMismatch) {
			jsonError(c, http.StatusBadRequest, err.Error())
			return
		}
		jsonError(c, http.StatusInternalServerError, "failed to write file")
		return
	}

	// MD5 is computed while streaming upload data to avoid a second full-file read.
	md5Hash := hex.EncodeToString(hashWriter.Sum(nil))
	// 使用本次写入的元数据，避免再次 Stat 时读到另一笔上传刚替换的文件。
	md5Cache.Lock()
	md5Cache.trimLocked(tokenInfo.FilePath)
	md5Cache.generation++
	md5Cache.entries[tokenInfo.FilePath] = md5CacheEntry{
		size:       info.Size(),
		modTime:    info.ModTime().UnixNano(),
		hash:       md5Hash,
		generation: md5Cache.generation,
	}
	md5Cache.Unlock()
	if tokenInfo.BrowserDownloadToken != "" {
		transferTokensMu.Lock()
		if download := transferTokens[tokenInfo.BrowserDownloadToken]; download != nil {
			download.TotalBytes = written
			download.MD5 = md5Hash
			download.UploadPending = false
			download.ExpiresAt = time.Now().Add(defaultTransferTokenTTL)
		}
		transferTokensMu.Unlock()
	}
	uploadComplete = true

	debugLogf("✅ Upload completed: device %s → %s (%d bytes, MD5: %s)",
		tokenInfo.DeviceSN, fileName, written, md5Hash)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"bytes":   written,
		"md5":     md5Hash,
		"path":    tokenInfo.FilePath,
	})
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

var deviceMessageChineseTemplates = map[string]string{
	"device.command.script_run":                   "运行脚本",
	"device.command.script_stop":                  "停止脚本",
	"device.command.reboot":                       "重启设备",
	"device.command.respring":                     "注销桌面",
	"device.command.home":                         "主屏幕",
	"device.command.lock":                         "锁定屏幕",
	"device.command.unlock":                       "解锁屏幕",
	"device.command.volume_up":                    "增加音量",
	"device.command.volume_down":                  "减少音量",
	"device.command.clipboard_write":              "写入剪贴板",
	"device.command.clipboard_read":               "读取剪贴板",
	"device.command.file_upload":                  "上传文件",
	"device.command.file_delete":                  "删除文件",
	"device.command.file_download":                "下载文件",
	"device.command.large_file_fetch":             "拉取大文件",
	"device.command.app_install":                  "安装应用",
	"device.command.app_uninstall":                "卸载应用",
	"device.command.app_open":                     "打开应用",
	"device.command.app_close":                    "关闭应用",
	"device.script.start_transfer_timeout":        "脚本启动失败：大文件传输超时",
	"device.script.started":                       "脚本已启动",
	"device.script.start_device_offline":          "脚本启动失败：设备已离线",
	"device.script.start_send_failed":             "脚本启动失败：发送启动命令失败",
	"device.script.start_transfer_failed":         "脚本启动已取消：大文件传输失败",
	"device.script.large_transfer_complete":       "大文件传输完成，启动脚本…",
	"device.script.upload_summary":                "上传脚本（{small} 个小文件，{large} 个大文件）",
	"device.script.send_summary":                  "发送脚本（{small} 个小文件，{large} 个大文件）",
	"device.script.upload_large_file":             "上传大文件 {name}",
	"device.script.verify_failed":                 "校验失败 {name}",
	"device.script.uploaded":                      "脚本已上传",
	"device.script.start_previous_pending":        "脚本启动已取消：上一次脚本启动尚未完成，请稍后重试",
	"device.script.start_not_connected":           "脚本启动失败：设备未连接",
	"device.script.start_transfer_prepare_failed": "脚本启动已取消：大文件传输准备失败",
	"device.script.waiting_for_transfers":         "等待大文件传输完成后启动脚本（{count}）",
	"device.script.starting":                      "启动脚本…",
	"device.script.start_canceled":                "脚本启动已取消：已取消本次启动流程",
	"device.transfer.send_file":                   "发送文件 {name}",
	"device.transfer.download_file":               "下载文件 {name}",
}

// broadcastDeviceMessage keeps the legacy Chinese message while adding a
// language-neutral code that each controller can translate independently.
func broadcastDeviceMessage(udid string, messageCode string, messageParams map[string]any) {
	broadcastDeviceMessageWithDetail(udid, messageCode, messageParams, "")
}

func broadcastDeviceMessageWithDetail(udid string, messageCode string, messageParams map[string]any, detail string) {
	controllerList := snapshotControllerConns()
	if len(controllerList) == 0 {
		return
	}

	message := interpolateMessage(deviceMessageChineseTemplates[messageCode], messageParams)
	if message == "" {
		message = messageCode
	}
	body := map[string]any{
		"udid":        udid,
		"message":     message,
		"messageCode": messageCode,
	}
	if len(messageParams) > 0 {
		body["messageParams"] = messageParams
	}
	if strings.TrimSpace(detail) != "" {
		body["detail"] = detail
	}
	msg := Message{
		Type: "device/message",
		Body: body,
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
func sendFileDownloadCommand(deviceSN string, downloadURL string, targetPath string, md5 string, totalBytes int64, timeout int, requestID string) error {
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
			"requestId":  requestID,
		},
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}

	return conn.WriteMessage(1, data)
}

// sendFileUploadCommand sends a file upload command to a device
func sendFileUploadCommand(deviceSN string, uploadURL string, sourcePath string, savePath string, timeout int, requestID string) error {
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
			"requestId":  requestID,
		},
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}

	return conn.WriteMessage(1, data)
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
		Temporary     bool   `json:"temporary"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}

	if req.DeviceSN == "" || req.SourcePath == "" || req.Category == "" || req.Path == "" {
		jsonError(c, http.StatusBadRequest, "deviceSN, sourcePath, category, and path are required")
		return
	}
	if req.Temporary {
		parts := strings.Split(req.Path, "/")
		if req.Category != "files" || len(parts) != 3 || parts[0] != "_temp" || !strings.HasPrefix(parts[1], "download-") ||
			parts[1] == "download-" || validateFileName(parts[1]) != nil || parts[2] != "payload" {
			jsonError(c, http.StatusBadRequest, "invalid file path")
			return
		}
	}

	// Validate and prepare save path
	filePath, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	token := uuid.New().String()
	requestID := uuid.NewString()
	timeout := normalizeTransferTimeoutSeconds(req.Timeout)
	expiresAt := time.Now().Add(transferTokenTTLForTimeout(timeout))
	if err := beginDeviceFileTransfer(req.DeviceSN, req.SourcePath, requestID, "upload", expiresAt); err != nil {
		jsonError(c, http.StatusConflict, err.Error())
		return
	}
	transferDispatched := false
	defer func() {
		if !transferDispatched {
			finishDeviceFileTransfer(requestID)
		}
	}()

	// Create parent directory
	parentDir := filepath.Dir(filePath)
	if req.Temporary {
		if err := os.MkdirAll(filepath.Dir(parentDir), 0755); err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create directory")
			return
		}
		// 浏览器临时文件必须使用独占目录，不能给已有文件挂上自动删除令牌。
		if err := os.Mkdir(parentDir, 0755); err != nil {
			if os.IsExist(err) {
				jsonError(c, http.StatusConflict, "file or directory already exists")
			} else {
				jsonError(c, http.StatusInternalServerError, "failed to create directory")
			}
			return
		}
	} else {
		if err := os.MkdirAll(parentDir, 0755); err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create directory")
			return
		}
	}

	browserDownloadToken, sharedSourceID := "", ""
	transferTokensMu.Lock()
	if req.Temporary {
		sharedSourceID = retainDownloadTempSource(filePath, "", 0)
		registerSharedTempRef(sharedSourceID, filePath, 0)
		browserDownloadToken = uuid.NewString()
		transferTokens[browserDownloadToken] = &TransferToken{
			Type: "download", FilePath: filePath, TargetPath: req.Path, DeviceSN: req.DeviceSN,
			ExpiresAt: expiresAt, OneTime: true, Category: req.Category,
			SharedSourceID: sharedSourceID, UploadPending: true,
		}
	}
	transferTokens[token] = &TransferToken{
		Type:                 "upload",
		FilePath:             filePath,
		TargetPath:           req.SourcePath, // Store device source path for reference
		DeviceSN:             req.DeviceSN,
		ExpiresAt:            expiresAt,
		OneTime:              true,
		Category:             req.Category,
		DeviceTransferID:     requestID,
		SharedSourceID:       sharedSourceID,
		BrowserDownloadToken: browserDownloadToken,
	}
	transferTokensMu.Unlock()

	// Build upload URL path
	uploadPath := fmt.Sprintf("/api/transfer/upload/%s", token)
	transferBaseURL := resolveTransferBaseURL(c, req.ServerBaseUrl)
	uploadURL := transferBaseURL + uploadPath

	// Send command to device
	if err := sendFileUploadCommand(req.DeviceSN, uploadURL, req.SourcePath, req.Path, timeout, requestID); err != nil {
		// Cleanup token on failure
		var abandoned []*TransferToken
		transferTokensMu.Lock()
		for _, key := range []string{token, browserDownloadToken} {
			if info := transferTokens[key]; info != nil {
				abandoned = append(abandoned, info)
				delete(transferTokens, key)
			}
		}
		transferTokensMu.Unlock()
		for _, info := range abandoned {
			releaseSharedTempRef(info.SharedSourceID)
		}
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	debugLogf("📥 Pull file initiated: device %s:%s → %s", req.DeviceSN, req.SourcePath, req.Path)
	transferDispatched = true

	result := gin.H{
		"success": true,
		"token":   token,
	}
	if browserDownloadToken != "" {
		result["downloadToken"] = browserDownloadToken
	}
	c.JSON(http.StatusOK, result)
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
