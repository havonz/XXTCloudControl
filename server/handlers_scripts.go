package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	scriptLargeFileThreshold = 128 * 1024
	scriptPackageCacheMax    = 64
	scriptPackageCacheTrimTo = 48
)

var scriptStartWaitTimeout = 6 * time.Minute

type scriptFileData struct {
	Path           string
	NormalizedPath string
	SourcePath     string
	Data           string
	Size           int64
	IsMainJSON     bool
}

type md5Result struct {
	hash string
	err  error
}

type scriptPackageCacheEntry struct {
	signature string
	files     []scriptFileData
}

type pendingScriptStart struct {
	runPayload         []byte
	runPayloadPrepared bool
	runName            string
	remaining          map[string]struct{}
	generation         uint64
}

var scriptPackageCache = struct {
	sync.RWMutex
	entries map[string]scriptPackageCacheEntry
}{
	entries: make(map[string]scriptPackageCacheEntry),
}

var pendingScriptStarts = struct {
	sync.Mutex
	seq     uint64
	entries map[string]*pendingScriptStart
}{
	entries: make(map[string]*pendingScriptStart),
}

func startScriptOnDevice(deviceID string, runPayload []byte, runPayloadPrepared bool, runName string, delay time.Duration) {
	go func() {
		if delay > 0 {
			time.Sleep(delay)
		}

		mu.RLock()
		conn, exists := deviceLinks[deviceID]
		mu.RUnlock()
		if !exists {
			broadcastDeviceMessage(deviceID, "脚本启动失败: 设备已离线")
			return
		}

		if runPayloadPrepared {
			_ = writeTextMessage(conn, runPayload)
		} else {
			_ = sendMessage(conn, Message{
				Type: "script/run",
				Body: gin.H{
					"name": runName,
				},
			})
		}

		broadcastDeviceMessage(deviceID, "脚本已启动")
	}()
}

func registerPendingScriptStart(deviceID string, runPayload []byte, runPayloadPrepared bool, runName string, targetPaths []string) {
	if deviceID == "" || len(targetPaths) == 0 {
		return
	}

	remaining := make(map[string]struct{}, len(targetPaths))
	for _, path := range targetPaths {
		if path == "" {
			continue
		}
		remaining[path] = struct{}{}
	}
	if len(remaining) == 0 {
		return
	}

	entry := &pendingScriptStart{
		runPayload:         append([]byte(nil), runPayload...),
		runPayloadPrepared: runPayloadPrepared,
		runName:            runName,
		remaining:          remaining,
	}

	pendingScriptStarts.Lock()
	pendingScriptStarts.seq++
	entry.generation = pendingScriptStarts.seq
	pendingScriptStarts.entries[deviceID] = entry
	generation := entry.generation
	pendingScriptStarts.Unlock()

	if scriptStartWaitTimeout <= 0 {
		return
	}

	go func(device string, gen uint64, wait time.Duration) {
		time.Sleep(wait)

		pendingScriptStarts.Lock()
		current := pendingScriptStarts.entries[device]
		if current == nil || current.generation != gen {
			pendingScriptStarts.Unlock()
			return
		}
		delete(pendingScriptStarts.entries, device)
		pendingScriptStarts.Unlock()

		broadcastDeviceMessage(device, "脚本启动失败: 大文件传输超时")
	}(deviceID, generation, scriptStartWaitTimeout)
}

func completePendingScriptStart(
	deviceID string,
	targetPath string,
	success bool,
	errMsg string,
) (ready *pendingScriptStart, cancelMsg string, handled bool) {
	if deviceID == "" || targetPath == "" {
		return nil, "", false
	}

	pendingScriptStarts.Lock()
	entry := pendingScriptStarts.entries[deviceID]
	if entry == nil {
		pendingScriptStarts.Unlock()
		return nil, "", false
	}

	if _, exists := entry.remaining[targetPath]; !exists {
		pendingScriptStarts.Unlock()
		return nil, "", false
	}

	if !success {
		delete(pendingScriptStarts.entries, deviceID)
		pendingScriptStarts.Unlock()

		errMsg = strings.TrimSpace(errMsg)
		if errMsg == "" {
			errMsg = "未知错误"
		}
		return nil, errMsg, true
	}

	delete(entry.remaining, targetPath)
	if len(entry.remaining) > 0 {
		pendingScriptStarts.Unlock()
		return nil, "", true
	}

	ready = &pendingScriptStart{
		runPayload:         append([]byte(nil), entry.runPayload...),
		runPayloadPrepared: entry.runPayloadPrepared,
		runName:            entry.runName,
	}
	delete(pendingScriptStarts.entries, deviceID)
	pendingScriptStarts.Unlock()

	return ready, "", true
}

func clearPendingScriptStart(deviceID string) {
	if deviceID == "" {
		return
	}
	pendingScriptStarts.Lock()
	delete(pendingScriptStarts.entries, deviceID)
	pendingScriptStarts.Unlock()
}

func hasPendingScriptStart(deviceID string) bool {
	if deviceID == "" {
		return false
	}
	pendingScriptStarts.Lock()
	_, exists := pendingScriptStarts.entries[deviceID]
	pendingScriptStarts.Unlock()
	return exists
}

func handleTransferFetchCompletionForScriptStart(deviceID string, body interface{}) {
	bodyMap, ok := body.(map[string]interface{})
	if !ok {
		return
	}

	targetPath, ok := bodyMap["targetPath"].(string)
	if !ok || targetPath == "" {
		return
	}

	success := false
	switch value := bodyMap["success"].(type) {
	case bool:
		success = value
	case string:
		success = strings.EqualFold(value, "true")
	case float64:
		success = value != 0
	}

	errMsg := ""
	if value, ok := bodyMap["error"].(string); ok {
		errMsg = value
	}

	ready, cancelMsg, handled := completePendingScriptStart(deviceID, targetPath, success, errMsg)
	if !handled {
		return
	}

	if cancelMsg != "" {
		broadcastDeviceMessage(deviceID, "脚本启动已取消: "+cancelMsg)
		return
	}

	if ready == nil {
		return
	}

	broadcastDeviceMessage(deviceID, "大文件传输完成，启动脚本...")
	startScriptOnDevice(deviceID, ready.runPayload, ready.runPayloadPrepared, ready.runName, ScriptStartDelay)
}

func normalizeScriptPath(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

type resolvedScriptPath struct {
	absPath        string
	normalizedName string
}

func resolveScriptPath(rawName string) (resolvedScriptPath, error) {
	name := strings.TrimSpace(rawName)
	if name == "" {
		return resolvedScriptPath{}, fmt.Errorf("script name is required")
	}

	// Reuse shared relative path sanitizer to block traversal and absolute paths.
	safeName, err := sanitizeRelativeItemPath(name)
	if err != nil {
		return resolvedScriptPath{}, fmt.Errorf("invalid script name")
	}

	absPath, err := validatePath("scripts", safeName)
	if err != nil {
		return resolvedScriptPath{}, fmt.Errorf("invalid script name")
	}

	return resolvedScriptPath{
		absPath:        absPath,
		normalizedName: normalizeScriptPath(safeName),
	}, nil
}

func isMainJSONPath(path string) bool {
	normalized := normalizeScriptPath(path)
	return normalized == "lua/scripts/main.json" || strings.HasSuffix(normalized, "/main.json")
}

func cloneScriptFileDataSlice(src []scriptFileData) []scriptFileData {
	if len(src) == 0 {
		return nil
	}
	dst := make([]scriptFileData, len(src))
	copy(dst, src)
	return dst
}

func scriptPackageCacheKey(scriptRootPath string, scriptName string, isDir bool, isPiled bool) string {
	return fmt.Sprintf("%s|%s|%t|%t", scriptRootPath, scriptName, isDir, isPiled)
}

// buildScriptSourceSignature computes a content signature using relative path + size + mtime.
// It avoids reading full file contents, and is used for cache invalidation.
func buildScriptSourceSignature(scriptRootPath string, isDir bool) (string, error) {
	signatureHash := sha256.New()
	writePart := func(value string) {
		_, _ = signatureHash.Write([]byte(value))
		_, _ = signatureHash.Write([]byte{0})
	}

	if !isDir {
		info, err := os.Stat(scriptRootPath)
		if err != nil {
			return "", err
		}
		writePart("file")
		writePart(strconv.FormatInt(info.Size(), 10))
		writePart(strconv.FormatInt(info.ModTime().UnixNano(), 10))
		return hex.EncodeToString(signatureHash.Sum(nil)), nil
	}

	walkErr := filepath.Walk(scriptRootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relPath, relErr := filepath.Rel(scriptRootPath, path)
		if relErr != nil {
			return relErr
		}
		writePart(normalizeScriptPath(relPath))
		writePart(strconv.FormatInt(info.Size(), 10))
		writePart(strconv.FormatInt(info.ModTime().UnixNano(), 10))
		return nil
	})
	if walkErr != nil {
		return "", walkErr
	}

	return hex.EncodeToString(signatureHash.Sum(nil)), nil
}

func trimScriptPackageCacheLocked() {
	if len(scriptPackageCache.entries) < scriptPackageCacheMax {
		return
	}
	toRemove := len(scriptPackageCache.entries) - scriptPackageCacheTrimTo
	if toRemove <= 0 {
		toRemove = 1
	}
	for key := range scriptPackageCache.entries {
		delete(scriptPackageCache.entries, key)
		toRemove--
		if toRemove == 0 {
			break
		}
	}
}

func collectScriptFilesCached(scriptRootPath string, scriptName string, isDir bool, isPiled bool) ([]scriptFileData, error) {
	signature, err := buildScriptSourceSignature(scriptRootPath, isDir)
	if err != nil {
		return nil, err
	}

	cacheKey := scriptPackageCacheKey(scriptRootPath, scriptName, isDir, isPiled)
	scriptPackageCache.RLock()
	entry, ok := scriptPackageCache.entries[cacheKey]
	scriptPackageCache.RUnlock()
	if ok && entry.signature == signature {
		return cloneScriptFileDataSlice(entry.files), nil
	}

	filesToSend, err := collectScriptFiles(scriptRootPath, scriptName, isDir, isPiled)
	if err != nil {
		return nil, err
	}

	scriptPackageCache.Lock()
	trimScriptPackageCacheLocked()
	scriptPackageCache.entries[cacheKey] = scriptPackageCacheEntry{
		signature: signature,
		files:     cloneScriptFileDataSlice(filesToSend),
	}
	scriptPackageCache.Unlock()

	return filesToSend, nil
}

func getSelectableScriptPath(basePath string, name string, isDir bool) (string, bool) {
	fullPath := filepath.Join(basePath, name)

	if !isDir {
		ext := strings.ToLower(filepath.Ext(name))
		if ext == ".lua" || ext == ".xxt" {
			return name, true
		}
		return "", false
	}

	// Directory: check if it's a .xpp
	if strings.ToLower(filepath.Ext(name)) == ".xpp" {
		return name, true
	}

	// Directory: check if it's a piled script with lua/scripts/main.lua or main.xxt
	mainLua := filepath.Join(fullPath, "lua", "scripts", "main.lua")
	if _, err := os.Stat(mainLua); err == nil {
		return "main.lua", true
	}
	mainXxt := filepath.Join(fullPath, "lua", "scripts", "main.xxt")
	if _, err := os.Stat(mainXxt); err == nil {
		return "main.xxt", true
	}

	return "", false
}

func collectScriptFiles(scriptRootPath string, scriptName string, isDir bool, isPiled bool) ([]scriptFileData, error) {
	filesToSend := make([]scriptFileData, 0)

	appendFile := func(targetPath string, sourcePath string, size int64, encodedData string) {
		normalizedPath := normalizeScriptPath(targetPath)
		filesToSend = append(filesToSend, scriptFileData{
			Path:           targetPath,
			NormalizedPath: normalizedPath,
			SourcePath:     sourcePath,
			Data:           encodedData,
			Size:           size,
			IsMainJSON:     isMainJSONPath(normalizedPath),
		})
	}

	if !isDir {
		content, err := os.ReadFile(scriptRootPath)
		if err != nil {
			return nil, err
		}

		fileSize := int64(len(content))
		encodedData := ""
		if fileSize < scriptLargeFileThreshold {
			encodedData = base64.StdEncoding.EncodeToString(content)
		}

		appendFile("lua/scripts/"+scriptName, scriptRootPath, fileSize, encodedData)
		return filesToSend, nil
	}

	walkErr := filepath.Walk(scriptRootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		relPath, _ := filepath.Rel(scriptRootPath, path)
		normalizedRelPath := normalizeScriptPath(relPath)

		targetPath := normalizedRelPath
		if !isPiled {
			targetPath = "lua/scripts/" + scriptName + "/" + normalizedRelPath
		}

		fileSize := info.Size()
		encodedData := ""
		if fileSize < scriptLargeFileThreshold {
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			encodedData = base64.StdEncoding.EncodeToString(content)
		}

		appendFile(targetPath, path, fileSize, encodedData)
		return nil
	})

	if walkErr != nil {
		return nil, walkErr
	}

	return filesToSend, nil
}

func calculateLargeFileMD5(filesToSend []scriptFileData) map[string]md5Result {
	largeFileMD5 := make(map[string]md5Result)
	for _, f := range filesToSend {
		if f.Data != "" {
			continue
		}
		if _, exists := largeFileMD5[f.SourcePath]; exists {
			continue
		}

		md5Hash, err := calculateFileMD5Cached(f.SourcePath, nil)
		if err != nil {
			fmt.Printf("❌ Failed to calculate MD5 for %s: %v\n", f.SourcePath, err)
			largeFileMD5[f.SourcePath] = md5Result{err: err}
			continue
		}
		largeFileMD5[f.SourcePath] = md5Result{hash: md5Hash}
	}
	return largeFileMD5
}

func countScriptFileKinds(filesToSend []scriptFileData) (smallFilesCount int, largeFilesCount int) {
	for _, f := range filesToSend {
		if f.Data == "" {
			largeFilesCount++
		} else {
			smallFilesCount++
		}
	}
	return smallFilesCount, largeFilesCount
}

func buildFilePutPayload(path string, data string) ([]byte, error) {
	return json.Marshal(Message{
		Type: "file/put",
		Body: gin.H{
			"path": path,
			"data": data,
		},
	})
}

// isSelectableScript checks if a file/directory is a selectable script
func isSelectableScript(basePath string, name string, isDir bool) bool {
	_, selectable := getSelectableScriptPath(basePath, name, isDir)
	return selectable
}

// selectableScriptsHandler handles GET /api/scripts/selectable
// Returns a list of scripts with name (display name) and path (actual script to select)
// For piled scripts, path is "main.lua" or "main.xxt" depending on entry point
func selectableScriptsHandler(c *gin.Context) {
	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")

	if _, err := os.Stat(scriptsDir); os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"scripts": []gin.H{}})
		return
	}

	entries, err := os.ReadDir(scriptsDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read scripts directory"})
		return
	}

	type ScriptEntry struct {
		Name string `json:"name"` // Display name (file or folder name)
		Path string `json:"path"` // Actual script path to select
	}

	selectableScripts := make([]ScriptEntry, 0)
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		scriptPath, selectable := getSelectableScriptPath(scriptsDir, name, entry.IsDir())
		if !selectable {
			continue
		}

		selectableScripts = append(selectableScripts, ScriptEntry{
			Name: name,
			Path: scriptPath,
		})
	}

	c.JSON(http.StatusOK, gin.H{"scripts": selectableScripts})
}

// resolveDeviceScriptConfig gets the script config for a device based on group membership
// Rules:
// 1. If selectedGroups contains "__all__" -> return nil (use global config)
// 2. Find the first group (by sortOrder) that contains the device and has config for this script
// 3. If no config found -> return nil (use global config)
func resolveDeviceScriptConfig(udid string, scriptName string, selectedGroups []string) map[string]interface{} {
	for _, gid := range selectedGroups {
		if gid == "__all__" {
			return nil
		}
	}

	if len(selectedGroups) == 0 {
		return nil
	}

	// Acquire locks in consistent order to prevent deadlock
	deviceGroupsMu.RLock()
	defer deviceGroupsMu.RUnlock()
	groupScriptConfigsMu.RLock()
	defer groupScriptConfigsMu.RUnlock()

	selectedSet := make(map[string]bool)
	for _, gid := range selectedGroups {
		selectedSet[gid] = true
	}

	for _, group := range deviceGroups {
		if !selectedSet[group.ID] {
			continue
		}

		deviceInGroup := false
		for _, dID := range group.DeviceIDs {
			if dID == udid {
				deviceInGroup = true
				break
			}
		}

		if !deviceInGroup {
			continue
		}

		if scripts, ok := groupScriptConfigs[group.ID]; ok {
			if config, ok := scripts[scriptName]; ok {
				return config
			}
		}
	}

	return nil
}

// buildDeviceScriptConfigIndex precomputes script config lookup for selected devices.
// It preserves resolveDeviceScriptConfig priority semantics:
// the first selected group (by current deviceGroups order) that contains a device and
// has config for the script wins.
func buildDeviceScriptConfigIndex(scriptName string, selectedGroups []string) map[string]map[string]interface{} {
	for _, gid := range selectedGroups {
		if gid == "__all__" {
			return nil
		}
	}
	if len(selectedGroups) == 0 {
		return nil
	}

	selectedSet := make(map[string]struct{}, len(selectedGroups))
	for _, gid := range selectedGroups {
		selectedSet[gid] = struct{}{}
	}

	deviceToConfig := make(map[string]map[string]interface{})

	// Acquire locks in consistent order to prevent deadlock.
	deviceGroupsMu.RLock()
	defer deviceGroupsMu.RUnlock()
	groupScriptConfigsMu.RLock()
	defer groupScriptConfigsMu.RUnlock()

	for _, group := range deviceGroups {
		if _, ok := selectedSet[group.ID]; !ok {
			continue
		}

		scripts, ok := groupScriptConfigs[group.ID]
		if !ok {
			continue
		}
		config, ok := scripts[scriptName]
		if !ok {
			continue
		}

		for _, deviceID := range group.DeviceIDs {
			// First matched group wins.
			if _, exists := deviceToConfig[deviceID]; !exists {
				deviceToConfig[deviceID] = config
			}
		}
	}

	return deviceToConfig
}

// snapshotDeviceConns copies currently connected device sockets for target devices.
// This avoids holding the global device mutex while doing heavy per-device work.
func snapshotDeviceConns(deviceIDs []string) map[string]*SafeConn {
	conns := make(map[string]*SafeConn, len(deviceIDs))
	mu.RLock()
	for _, udid := range deviceIDs {
		if conn, exists := deviceLinks[udid]; exists {
			conns[udid] = conn
		}
	}
	mu.RUnlock()
	return conns
}

// scriptsSendHandler handles POST /api/scripts/send
// Like scriptsSendAndStartHandler but only sends files, does not run the script
func scriptsSendHandler(c *gin.Context) {
	var req struct {
		Devices        []string `json:"devices"`
		Name           string   `json:"name"`
		SelectedGroups []string `json:"selectedGroups"`
		ServerBaseUrl  string   `json:"serverBaseUrl"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if len(req.Devices) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "devices are required"})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "script name is required"})
		return
	}

	resolved, err := resolveScriptPath(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	scriptPath := resolved.absPath
	scriptName := resolved.normalizedName

	fileInfo, err := os.Stat(scriptPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "script not found"})
		return
	}

	isDir := fileInfo.IsDir()
	isPiled := false
	if isDir {
		if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts")); err == nil {
			isPiled = true
		}
	}

	filesToSend, err := collectScriptFilesCached(scriptPath, scriptName, isDir, isPiled)
	if err != nil {
		errorMsg := "failed to read script directory"
		if !isDir {
			errorMsg = "failed to read script file"
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": errorMsg})
		return
	}

	largeFileMD5 := calculateLargeFileMD5(filesToSend)
	smallFilesCount, largeFilesCount := countScriptFileKinds(filesToSend)
	transferBaseURL := resolveTransferBaseURL(c, req.ServerBaseUrl)

	deviceConfigIndex := buildDeviceScriptConfigIndex(scriptName, req.SelectedGroups)
	groupConfigKeyCache := make(map[uintptr]string)
	groupConfigKeySeq := 0
	getGroupConfigKey := func(groupConfig map[string]interface{}) string {
		if groupConfig == nil {
			return ""
		}
		ptr := reflect.ValueOf(groupConfig).Pointer()
		if key, ok := groupConfigKeyCache[ptr]; ok {
			return key
		}
		groupConfigKeySeq++
		key := strconv.Itoa(groupConfigKeySeq)
		groupConfigKeyCache[ptr] = key
		return key
	}

	mainJSONTemplates := make(map[string]map[string]interface{})
	mainJSONParsed := make(map[string]bool)

	parseMainJSONTemplate := func(pathKey string, encoded string) map[string]interface{} {
		if mainJSONParsed[pathKey] {
			return mainJSONTemplates[pathKey]
		}
		mainJSONParsed[pathKey] = true

		rawJSON, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return nil
		}
		var mainObj map[string]interface{}
		if err := json.Unmarshal(rawJSON, &mainObj); err != nil {
			return nil
		}
		mainJSONTemplates[pathKey] = mainObj
		return mainObj
	}

	buildMergedMainJSONData := func(template map[string]interface{}, groupConfig map[string]interface{}) (string, bool) {
		if template == nil || groupConfig == nil {
			return "", false
		}

		mergedObj := make(map[string]interface{}, len(template))
		for k, v := range template {
			mergedObj[k] = v
		}

		configObj := make(map[string]interface{}, len(groupConfig))
		if existingConfig, ok := template["Config"].(map[string]interface{}); ok {
			for k, v := range existingConfig {
				configObj[k] = v
			}
		}
		for k, v := range groupConfig {
			configObj[k] = v
		}
		mergedObj["Config"] = configObj

		newJSON, err := json.Marshal(mergedObj)
		if err != nil {
			return "", false
		}
		return base64.StdEncoding.EncodeToString(newJSON), true
	}

	deviceConns := snapshotDeviceConns(req.Devices)
	basePutPayloadCache := make(map[string][]byte, len(filesToSend))
	mergedPutPayloadCache := make(map[string][]byte)
	for _, udid := range req.Devices {
		if conn, exists := deviceConns[udid]; exists {
			groupConfig := deviceConfigIndex[udid]
			groupConfigKey := getGroupConfigKey(groupConfig)

			broadcastDeviceMessage(udid, fmt.Sprintf("上传脚本 (%d小文件, %d大文件)", smallFilesCount, largeFilesCount))

			for _, f := range filesToSend {
				if f.Data != "" {
					// Most file/put payloads are identical across devices, cache encoded JSON bytes.
					if !f.IsMainJSON || groupConfig == nil {
						payload, ok := basePutPayloadCache[f.Path]
						if !ok {
							encoded, buildErr := buildFilePutPayload(f.Path, f.Data)
							if buildErr != nil {
								continue
							}
							payload = encoded
							basePutPayloadCache[f.Path] = payload
						}
						writeTextMessageAsync(conn, payload)
						continue
					}

					cacheKey := ""
					if groupConfigKey != "" {
						cacheKey = f.NormalizedPath + "|" + groupConfigKey
						if cachedPayload, ok := mergedPutPayloadCache[cacheKey]; ok {
							writeTextMessageAsync(conn, cachedPayload)
							continue
						}
					}

					finalData := f.Data
					template := parseMainJSONTemplate(f.NormalizedPath, f.Data)
					if mergedData, ok := buildMergedMainJSONData(template, groupConfig); ok {
						finalData = mergedData
					}

					payload, buildErr := buildFilePutPayload(f.Path, finalData)
					if buildErr != nil {
						continue
					}
					if cacheKey != "" {
						mergedPutPayloadCache[cacheKey] = payload
					}
					writeTextMessageAsync(conn, payload)
				} else {
					broadcastDeviceMessage(udid, fmt.Sprintf("上传大文件 %s", filepath.Base(f.Path)))

					md5Info, ok := largeFileMD5[f.SourcePath]
					if !ok || md5Info.err != nil {
						broadcastDeviceMessage(udid, fmt.Sprintf("校验失败 %s", filepath.Base(f.Path)))
						continue
					}
					md5Hash := md5Info.hash

					token := uuid.New().String()
					transferTokensMu.Lock()
					transferTokens[token] = &TransferToken{
						Type:       "download",
						FilePath:   f.SourcePath,
						TargetPath: f.Path,
						DeviceSN:   udid,
						ExpiresAt:  time.Now().Add(5 * time.Minute),
						OneTime:    true,
						TotalBytes: f.Size,
						MD5:        md5Hash,
					}
					transferTokensMu.Unlock()

					downloadURL := fmt.Sprintf("%s/api/transfer/download/%s", transferBaseURL, token)

					fetchMsg := Message{
						Type: "transfer/fetch",
						Body: gin.H{
							"url":        downloadURL,
							"targetPath": f.Path,
							"md5":        md5Hash,
							"totalBytes": f.Size,
							"timeout":    300,
						},
					}
					fetchPayload, marshalErr := json.Marshal(fetchMsg)
					if marshalErr != nil {
						continue
					}
					writeTextMessageAsync(conn, fetchPayload)
				}
			}

			// Broadcast completion message (no script start)
			broadcastDeviceMessage(udid, "脚本已上传")
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "files_sent": len(filesToSend)})
}

// scriptsSendAndStartHandler handles POST /api/scripts/send-and-start
func scriptsSendAndStartHandler(c *gin.Context) {
	var req struct {
		Devices        []string `json:"devices"`
		Name           string   `json:"name"`
		SelectedGroups []string `json:"selectedGroups"`
		ServerBaseUrl  string   `json:"serverBaseUrl"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if len(req.Devices) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "devices are required"})
		return
	}

	// Device-selected mode: empty name means run the script already selected on device
	if req.Name == "" {
		deviceConns := snapshotDeviceConns(req.Devices)
		for _, udid := range req.Devices {
			if conn, exists := deviceConns[udid]; exists {
				runMsg := Message{
					Type: "script/run",
					Body: gin.H{"name": ""},
				}
				sendMessageAsync(conn, runMsg)
			}
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "device_selected": true})
		return
	}

	resolved, err := resolveScriptPath(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	scriptPath := resolved.absPath
	scriptName := resolved.normalizedName

	fileInfo, err := os.Stat(scriptPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "script not found"})
		return
	}

	isDir := fileInfo.IsDir()
	isPiled := false
	if isDir {
		if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts")); err == nil {
			isPiled = true
		}
	}

	filesToSend, err := collectScriptFilesCached(scriptPath, scriptName, isDir, isPiled)
	if err != nil {
		errorMsg := "failed to read script directory"
		if !isDir {
			errorMsg = "failed to read script file"
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": errorMsg})
		return
	}

	largeFileMD5 := calculateLargeFileMD5(filesToSend)
	smallFilesCount, largeFilesCount := countScriptFileKinds(filesToSend)

	deviceConfigIndex := buildDeviceScriptConfigIndex(scriptName, req.SelectedGroups)
	groupConfigKeyCache := make(map[uintptr]string)
	groupConfigKeySeq := 0
	getGroupConfigKey := func(groupConfig map[string]interface{}) string {
		if groupConfig == nil {
			return ""
		}
		ptr := reflect.ValueOf(groupConfig).Pointer()
		if key, ok := groupConfigKeyCache[ptr]; ok {
			return key
		}
		groupConfigKeySeq++
		key := strconv.Itoa(groupConfigKeySeq)
		groupConfigKeyCache[ptr] = key
		return key
	}

	mainJSONTemplates := make(map[string]map[string]interface{})
	mainJSONParsed := make(map[string]bool)

	parseMainJSONTemplate := func(pathKey string, encoded string) map[string]interface{} {
		if mainJSONParsed[pathKey] {
			return mainJSONTemplates[pathKey]
		}
		mainJSONParsed[pathKey] = true

		rawJSON, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return nil
		}
		var mainObj map[string]interface{}
		if err := json.Unmarshal(rawJSON, &mainObj); err != nil {
			return nil
		}
		mainJSONTemplates[pathKey] = mainObj
		return mainObj
	}

	buildMergedMainJSONData := func(template map[string]interface{}, groupConfig map[string]interface{}) (string, bool) {
		if template == nil || groupConfig == nil {
			return "", false
		}

		mergedObj := make(map[string]interface{}, len(template))
		for k, v := range template {
			mergedObj[k] = v
		}

		configObj := make(map[string]interface{}, len(groupConfig))
		if existingConfig, ok := template["Config"].(map[string]interface{}); ok {
			for k, v := range existingConfig {
				configObj[k] = v
			}
		}
		for k, v := range groupConfig {
			configObj[k] = v
		}
		mergedObj["Config"] = configObj

		newJSON, err := json.Marshal(mergedObj)
		if err != nil {
			return "", false
		}
		return base64.StdEncoding.EncodeToString(newJSON), true
	}

	runName := scriptName
	if isPiled {
		if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts", "main.lua")); err == nil {
			runName = "main.lua"
		} else {
			runName = "main.xxt"
		}
	}

	runPayload, runPayloadErr := json.Marshal(Message{
		Type: "script/run",
		Body: gin.H{
			"name": runName,
		},
	})
	runPayloadPrepared := runPayloadErr == nil
	transferBaseURL := resolveTransferBaseURL(c, req.ServerBaseUrl)

	deviceConns := snapshotDeviceConns(req.Devices)
	basePutPayloadCache := make(map[string][]byte, len(filesToSend))
	mergedPutPayloadCache := make(map[string][]byte)
	for _, udid := range req.Devices {
		if conn, exists := deviceConns[udid]; exists {
			groupConfig := deviceConfigIndex[udid]
			groupConfigKey := getGroupConfigKey(groupConfig)
			pendingLargeTargets := make([]string, 0, largeFilesCount)
			for _, f := range filesToSend {
				if f.Data == "" {
					pendingLargeTargets = append(pendingLargeTargets, f.Path)
				}
			}
			largeTransferPrepareFailed := false

			// 广播状态: 正在发送文件
			broadcastDeviceMessage(udid, fmt.Sprintf("发送脚本 (%d小文件, %d大文件)", smallFilesCount, largeFilesCount))

			// 先发送小文件，避免大文件过早完成导致脚本提前启动。
			for _, f := range filesToSend {
				if f.Data == "" {
					continue
				}

				if !f.IsMainJSON || groupConfig == nil {
					payload, ok := basePutPayloadCache[f.Path]
					if !ok {
						encoded, buildErr := buildFilePutPayload(f.Path, f.Data)
						if buildErr != nil {
							continue
						}
						payload = encoded
						basePutPayloadCache[f.Path] = payload
					}
					writeTextMessageAsync(conn, payload)
					continue
				}

				cacheKey := ""
				if groupConfigKey != "" {
					cacheKey = f.NormalizedPath + "|" + groupConfigKey
					if cachedPayload, ok := mergedPutPayloadCache[cacheKey]; ok {
						writeTextMessageAsync(conn, cachedPayload)
						continue
					}
				}

				finalData := f.Data
				template := parseMainJSONTemplate(f.NormalizedPath, f.Data)
				if mergedData, ok := buildMergedMainJSONData(template, groupConfig); ok {
					finalData = mergedData
				}

				payload, buildErr := buildFilePutPayload(f.Path, finalData)
				if buildErr != nil {
					continue
				}
				if cacheKey != "" {
					mergedPutPayloadCache[cacheKey] = payload
				}
				writeTextMessageAsync(conn, payload)
			}

			if len(pendingLargeTargets) > 0 {
				registerPendingScriptStart(udid, runPayload, runPayloadPrepared, runName, pendingLargeTargets)
			}

			// 再发送大文件，避免 transfer/fetch/complete 在注册前到达。
			for _, f := range filesToSend {
				if f.Data != "" {
					continue
				}

				broadcastDeviceMessage(udid, fmt.Sprintf("上传大文件 %s", filepath.Base(f.Path)))

				md5Info, ok := largeFileMD5[f.SourcePath]
				if !ok || md5Info.err != nil {
					broadcastDeviceMessage(udid, fmt.Sprintf("校验失败 %s", filepath.Base(f.Path)))
					largeTransferPrepareFailed = true
					break
				}
				md5Hash := md5Info.hash

				token := uuid.New().String()
				transferTokensMu.Lock()
				transferTokens[token] = &TransferToken{
					Type:       "download",
					FilePath:   f.SourcePath,
					TargetPath: f.Path,
					DeviceSN:   udid,
					ExpiresAt:  time.Now().Add(5 * time.Minute),
					OneTime:    true,
					TotalBytes: f.Size,
					MD5:        md5Hash,
				}
				transferTokensMu.Unlock()

				downloadURL := fmt.Sprintf("%s/api/transfer/download/%s", transferBaseURL, token)
				fetchMsg := Message{
					Type: "transfer/fetch",
					Body: gin.H{
						"url":        downloadURL,
						"targetPath": f.Path,
						"md5":        md5Hash,
						"totalBytes": f.Size,
						"timeout":    300, // 5 minutes
					},
				}
				fetchPayload, marshalErr := json.Marshal(fetchMsg)
				if marshalErr != nil {
					largeTransferPrepareFailed = true
					break
				}
				writeTextMessageAsync(conn, fetchPayload)
			}

			if largeTransferPrepareFailed {
				clearPendingScriptStart(udid)
				broadcastDeviceMessage(udid, "脚本启动已取消: 大文件传输准备失败")
				continue
			}

			if len(pendingLargeTargets) > 0 {
				if hasPendingScriptStart(udid) {
					broadcastDeviceMessage(udid, fmt.Sprintf("等待大文件传输完成后启动脚本 (%d)", len(pendingLargeTargets)))
				}
				continue
			}

			// 全部为小文件时，保持原有延迟启动行为。
			broadcastDeviceMessage(udid, "启动脚本...")
			startScriptOnDevice(udid, runPayload, runPayloadPrepared, runName, ScriptStartDelay)
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "files_sent": len(filesToSend)})
}

// scriptConfigStatusHandler handles GET /api/scripts/config-status
func scriptConfigStatusHandler(c *gin.Context) {
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	resolved, err := resolveScriptPath(name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	scriptPath := resolved.absPath

	info, err := os.Stat(scriptPath)
	if err != nil || !info.IsDir() {
		c.JSON(http.StatusOK, gin.H{"configurable": false})
		return
	}

	mainJsonPath := filepath.Join(scriptPath, "lua", "scripts", "main.json")
	if _, err := os.Stat(mainJsonPath); err == nil {
		c.JSON(http.StatusOK, gin.H{"configurable": true})
	} else {
		c.JSON(http.StatusOK, gin.H{"configurable": false})
	}
}

// scriptConfigGetHandler handles GET /api/scripts/config
func scriptConfigGetHandler(c *gin.Context) {
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	resolved, err := resolveScriptPath(name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mainJsonPath := filepath.Join(resolved.absPath, "lua", "scripts", "main.json")

	data, err := os.ReadFile(mainJsonPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "main.json not found"})
		return
	}

	var config interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse main.json"})
		return
	}

	c.JSON(http.StatusOK, config)
}

// scriptConfigSaveHandler handles POST /api/scripts/config
func scriptConfigSaveHandler(c *gin.Context) {
	var req struct {
		Name   string                 `json:"name"`
		Config map[string]interface{} `json:"config"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	resolved, err := resolveScriptPath(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mainJsonPath := filepath.Join(resolved.absPath, "lua", "scripts", "main.json")

	data, err := os.ReadFile(mainJsonPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "main.json not found"})
		return
	}

	var mainObj map[string]interface{}
	if err := json.Unmarshal(data, &mainObj); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse main.json"})
		return
	}

	mainObj["Config"] = req.Config

	newData, err := json.MarshalIndent(mainObj, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal json"})
		return
	}

	if err := os.WriteFile(mainJsonPath, newData, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
