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

const (
	scriptStartPhasePreparing       = "preparing"
	scriptStartPhaseWaitingTransfer = "waiting_transfer"
	scriptStartPhaseStarting        = "starting"

	scriptStartCancelReasonNoActive      = "没有活动启动流程"
	scriptStartCancelReasonNotCancelable = "已不再可取消"
)

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

type pendingScriptFetchRequest struct {
	requestID  string
	targetPath string
}

type scriptStartState struct {
	Active     bool   `json:"active"`
	Cancelable bool   `json:"cancelable"`
	Phase      string `json:"phase,omitempty"`
}

type scriptStartSession struct {
	runPayload             []byte
	runPayloadPrepared     bool
	runName                string
	remainingFetchRequests map[string]string // requestID -> targetPath
	generation             uint64
	state                  scriptStartState
}

type readyScriptStart struct {
	runPayload         []byte
	runPayloadPrepared bool
	runName            string
	generation         uint64
}

type scriptStartCancelResult struct {
	Canceled bool
	Reason   string
}

var scriptPackageCache = struct {
	sync.RWMutex
	entries map[string]scriptPackageCacheEntry
}{
	entries: make(map[string]scriptPackageCacheEntry),
}

var scriptStartSessions = struct {
	sync.Mutex
	seq     uint64
	entries map[string]*scriptStartSession
}{
	entries: make(map[string]*scriptStartSession),
}

func buildScriptStartFetchRequestMap(fetchRequests []pendingScriptFetchRequest) map[string]string {
	if len(fetchRequests) == 0 {
		return nil
	}

	remainingFetchRequests := make(map[string]string, len(fetchRequests))
	for _, fetchRequest := range fetchRequests {
		requestID := strings.TrimSpace(fetchRequest.requestID)
		targetPath := strings.TrimSpace(fetchRequest.targetPath)
		if requestID == "" || targetPath == "" {
			continue
		}
		remainingFetchRequests[requestID] = targetPath
	}
	if len(remainingFetchRequests) == 0 {
		return nil
	}
	return remainingFetchRequests
}

func broadcastScriptStartState(deviceID string, state scriptStartState) {
	controllerList := snapshotControllerConns()
	if len(controllerList) == 0 {
		return
	}

	msg := Message{
		Type: "script/start/state",
		Body: gin.H{
			"udid":       deviceID,
			"active":     state.Active,
			"cancelable": state.Cancelable,
			"phase":      state.Phase,
		},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	for _, conn := range controllerList {
		writeTextMessageAsync(conn, data)
	}
}

func createScriptStartSession(
	deviceID string,
	runPayload []byte,
	runPayloadPrepared bool,
	runName string,
	phase string,
	fetchRequests []pendingScriptFetchRequest,
) (uint64, bool) {
	if deviceID == "" {
		return 0, false
	}
	remainingFetchRequests := buildScriptStartFetchRequestMap(fetchRequests)
	if len(fetchRequests) > 0 && len(remainingFetchRequests) == 0 {
		return 0, false
	}

	session := &scriptStartSession{
		runPayload:             append([]byte(nil), runPayload...),
		runPayloadPrepared:     runPayloadPrepared,
		runName:                runName,
		remainingFetchRequests: remainingFetchRequests,
		state: scriptStartState{
			Active:     true,
			Cancelable: true,
			Phase:      phase,
		},
	}

	scriptStartSessions.Lock()
	current := scriptStartSessions.entries[deviceID]
	if current != nil && current.state.Active {
		scriptStartSessions.Unlock()
		return 0, false
	}
	scriptStartSessions.seq++
	session.generation = scriptStartSessions.seq
	scriptStartSessions.entries[deviceID] = session
	generation := session.generation
	state := session.state
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, state)

	if len(session.remainingFetchRequests) > 0 && scriptStartWaitTimeout > 0 {
		go func(device string, gen uint64, wait time.Duration) {
			time.Sleep(wait)

			scriptStartSessions.Lock()
			current := scriptStartSessions.entries[device]
			if current == nil || current.generation != gen || len(current.remainingFetchRequests) == 0 {
				scriptStartSessions.Unlock()
				return
			}
			delete(scriptStartSessions.entries, device)
			scriptStartSessions.Unlock()

			broadcastScriptStartState(device, scriptStartState{})
			broadcastDeviceMessage(device, "脚本启动失败: 大文件传输超时")
		}(deviceID, generation, scriptStartWaitTimeout)
	}

	return generation, true
}

func updateScriptStartSessionPhase(deviceID string, generation uint64, phase string, cancelable bool) bool {
	if deviceID == "" {
		return false
	}
	scriptStartSessions.Lock()
	current := scriptStartSessions.entries[deviceID]
	if current == nil || current.generation != generation || !current.state.Active {
		scriptStartSessions.Unlock()
		return false
	}
	if current.state.Phase == phase && current.state.Cancelable == cancelable {
		scriptStartSessions.Unlock()
		return true
	}
	current.state.Phase = phase
	current.state.Cancelable = cancelable
	state := current.state
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, state)
	return true
}

func snapshotScriptStartStates(deviceIDs []string) map[string]scriptStartState {
	scriptStartSessions.Lock()
	defer scriptStartSessions.Unlock()

	states := make(map[string]scriptStartState)
	if len(deviceIDs) == 0 {
		for deviceID, session := range scriptStartSessions.entries {
			if session == nil || !session.state.Active {
				continue
			}
			states[deviceID] = session.state
		}
		return states
	}

	for _, deviceID := range deviceIDs {
		session := scriptStartSessions.entries[deviceID]
		if session == nil || !session.state.Active {
			continue
		}
		states[deviceID] = session.state
	}
	return states
}

func clearScriptStartSession(deviceID string) bool {
	if deviceID == "" {
		return false
	}
	scriptStartSessions.Lock()
	if _, exists := scriptStartSessions.entries[deviceID]; !exists {
		scriptStartSessions.Unlock()
		return false
	}
	delete(scriptStartSessions.entries, deviceID)
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, scriptStartState{})
	return true
}

func clearScriptStartSessionIfGeneration(deviceID string, generation uint64) bool {
	if deviceID == "" {
		return false
	}
	scriptStartSessions.Lock()
	current := scriptStartSessions.entries[deviceID]
	if current == nil || current.generation != generation {
		scriptStartSessions.Unlock()
		return false
	}
	delete(scriptStartSessions.entries, deviceID)
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, scriptStartState{})
	return true
}

func isCurrentScriptStartSession(deviceID string, generation uint64) bool {
	scriptStartSessions.Lock()
	current := scriptStartSessions.entries[deviceID]
	ok := current != nil && current.generation == generation && current.state.Active
	scriptStartSessions.Unlock()
	return ok
}

func cancelScriptStartSession(deviceID string) scriptStartCancelResult {
	if deviceID == "" {
		return scriptStartCancelResult{Reason: scriptStartCancelReasonNoActive}
	}
	scriptStartSessions.Lock()
	current := scriptStartSessions.entries[deviceID]
	if current == nil || !current.state.Active {
		scriptStartSessions.Unlock()
		return scriptStartCancelResult{Reason: scriptStartCancelReasonNoActive}
	}
	if !current.state.Cancelable {
		scriptStartSessions.Unlock()
		return scriptStartCancelResult{Reason: scriptStartCancelReasonNotCancelable}
	}
	delete(scriptStartSessions.entries, deviceID)
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, scriptStartState{})
	return scriptStartCancelResult{Canceled: true}
}

func failScriptStartSession(deviceID string, generation uint64, message string) {
	if clearScriptStartSessionIfGeneration(deviceID, generation) {
		broadcastDeviceMessage(deviceID, message)
	}
}

func startScriptOnDevice(
	deviceID string,
	generation uint64,
	runPayload []byte,
	runPayloadPrepared bool,
	runName string,
	delay time.Duration,
) {
	go func() {
		if delay > 0 {
			time.Sleep(delay)
		}
		if !isCurrentScriptStartSession(deviceID, generation) {
			return
		}

		mu.RLock()
		conn, exists := deviceLinks[deviceID]
		mu.RUnlock()
		if !exists {
			failScriptStartSession(deviceID, generation, "脚本启动失败: 设备已离线")
			return
		}

		var err error
		if runPayloadPrepared {
			err = writeTextMessage(conn, runPayload)
		} else {
			err = sendMessage(conn, Message{
				Type: "script/run",
				Body: gin.H{
					"name": runName,
				},
			})
		}
		if err != nil {
			failScriptStartSession(deviceID, generation, "脚本启动失败: 发送启动命令失败")
			return
		}
		if !clearScriptStartSessionIfGeneration(deviceID, generation) {
			return
		}

		broadcastDeviceMessage(deviceID, "脚本已启动")
	}()
}

// resolveAndCompletePendingFetch locates a pending fetch request in the session
// (by requestID directly, or by targetPath reverse-lookup) and marks it complete.
func resolveAndCompletePendingFetch(
	deviceID string,
	requestID string,
	targetPath string,
	success bool,
	errMsg string,
) (ready *readyScriptStart, cancelMsg string, handled bool) {
	scriptStartSessions.Lock()
	entry := scriptStartSessions.entries[deviceID]
	if entry == nil {
		scriptStartSessions.Unlock()
		return nil, "", false
	}

	// Resolve the requestID: either given directly or looked up via targetPath.
	resolvedID := requestID
	resolvedPath := ""
	if resolvedID != "" {
		var exists bool
		resolvedPath, exists = entry.remainingFetchRequests[resolvedID]
		if !exists {
			scriptStartSessions.Unlock()
			return nil, "", false
		}
	} else {
		for id, pendingPath := range entry.remainingFetchRequests {
			if pendingPath == targetPath {
				resolvedID = id
				resolvedPath = pendingPath
				break
			}
		}
		if resolvedID == "" {
			scriptStartSessions.Unlock()
			return nil, "", false
		}
	}

	if !success {
		delete(scriptStartSessions.entries, deviceID)
		scriptStartSessions.Unlock()

		broadcastScriptStartState(deviceID, scriptStartState{})

		errMsg = strings.TrimSpace(errMsg)
		if errMsg == "" {
			errMsg = "未知错误"
		}
		if resolvedPath != "" {
			return nil, fmt.Sprintf("%s (%s)", errMsg, resolvedPath), true
		}
		return nil, errMsg, true
	}

	delete(entry.remainingFetchRequests, resolvedID)
	if len(entry.remainingFetchRequests) > 0 {
		scriptStartSessions.Unlock()
		return nil, "", true
	}

	entry.state.Phase = scriptStartPhaseStarting
	state := entry.state
	ready = &readyScriptStart{
		runPayload:         append([]byte(nil), entry.runPayload...),
		runPayloadPrepared: entry.runPayloadPrepared,
		runName:            entry.runName,
		generation:         entry.generation,
	}
	scriptStartSessions.Unlock()

	broadcastScriptStartState(deviceID, state)

	return ready, "", true
}

func completePendingScriptStart(
	deviceID string,
	requestID string,
	success bool,
	errMsg string,
) (ready *readyScriptStart, cancelMsg string, handled bool) {
	if deviceID == "" || requestID == "" {
		return nil, "", false
	}
	return resolveAndCompletePendingFetch(deviceID, requestID, "", success, errMsg)
}

func completePendingScriptStartByTargetPath(
	deviceID string,
	targetPath string,
	success bool,
	errMsg string,
) (ready *readyScriptStart, cancelMsg string, handled bool) {
	if deviceID == "" || targetPath == "" {
		return nil, "", false
	}
	return resolveAndCompletePendingFetch(deviceID, "", targetPath, success, errMsg)
}

func clearPendingScriptStart(deviceID string) {
	clearScriptStartSession(deviceID)
}

func hasPendingScriptStart(deviceID string) bool {
	if deviceID == "" {
		return false
	}
	scriptStartSessions.Lock()
	entry := scriptStartSessions.entries[deviceID]
	exists := entry != nil && entry.state.Active && len(entry.remainingFetchRequests) > 0
	scriptStartSessions.Unlock()
	return exists
}

func handleTransferFetchCompletionForScriptStart(deviceID string, body interface{}) {
	bodyMap, ok := body.(map[string]interface{})
	if !ok {
		return
	}

	requestID, _ := bodyMap["requestId"].(string)
	if strings.TrimSpace(requestID) == "" {
		requestID, _ = bodyMap["requestID"].(string)
	}
	requestID = strings.TrimSpace(requestID)

	targetPath, _ := bodyMap["targetPath"].(string)
	targetPath = strings.TrimSpace(targetPath)

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

	var (
		ready     *readyScriptStart
		cancelMsg string
		handled   bool
	)
	if requestID != "" {
		ready, cancelMsg, handled = completePendingScriptStart(deviceID, requestID, success, errMsg)
	} else if targetPath != "" {
		// Backward compatibility: legacy clients do not send requestId.
		ready, cancelMsg, handled = completePendingScriptStartByTargetPath(deviceID, targetPath, success, errMsg)
	}
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
	startScriptOnDevice(deviceID, ready.generation, ready.runPayload, ready.runPayloadPrepared, ready.runName, ScriptStartDelay)
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

// walkScriptFiles visits files under scriptRootPath.
// Directory symlinks are skipped; file symlinks are treated as files (using resolved metadata).
func walkScriptFiles(scriptRootPath string, visit func(path string, info os.FileInfo) error) error {
	rootInfo, err := os.Stat(scriptRootPath)
	if err != nil {
		return err
	}
	if !rootInfo.IsDir() {
		return fmt.Errorf("script root is not a directory: %s", scriptRootPath)
	}

	var walkDir func(dirPath string) error
	walkDir = func(dirPath string) error {
		entries, readErr := os.ReadDir(dirPath)
		if readErr != nil {
			return readErr
		}

		for _, entry := range entries {
			entryPath := filepath.Join(dirPath, entry.Name())
			lstatInfo, lstatErr := os.Lstat(entryPath)
			if lstatErr != nil {
				return lstatErr
			}

			if lstatInfo.Mode()&os.ModeSymlink != 0 {
				resolvedInfo, statErr := os.Stat(entryPath)
				if statErr != nil {
					return statErr
				}
				if resolvedInfo.IsDir() {
					// Skip nested directory symlinks to avoid traversing outside trees.
					continue
				}
				if err := visit(entryPath, resolvedInfo); err != nil {
					return err
				}
				continue
			}

			if lstatInfo.IsDir() {
				if err := walkDir(entryPath); err != nil {
					return err
				}
				continue
			}

			if err := visit(entryPath, lstatInfo); err != nil {
				return err
			}
		}

		return nil
	}

	return walkDir(scriptRootPath)
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

	walkErr := walkScriptFiles(scriptRootPath, func(path string, info os.FileInfo) error {
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

	walkErr := walkScriptFiles(scriptRootPath, func(path string, info os.FileInfo) error {
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

func resolveEntryIsDir(basePath string, entry os.DirEntry) bool {
	if entry.IsDir() {
		return true
	}
	// Follow symlink targets so linked script directories can be selectable.
	info, err := os.Stat(filepath.Join(basePath, entry.Name()))
	if err != nil {
		return false
	}
	return info.IsDir()
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

		scriptPath, selectable := getSelectableScriptPath(scriptsDir, name, resolveEntryIsDir(scriptsDir, entry))
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

// scriptSendRequest is the shared request type for send and send-and-start handlers.
type scriptSendRequest struct {
	Devices        []string `json:"devices"`
	Name           string   `json:"name"`
	SelectedGroups []string `json:"selectedGroups"`
	ServerBaseUrl  string   `json:"serverBaseUrl"`
}

// buildMergedMainJSON merges a group config into a main.json template,
// returning the base64-encoded result. Pure function with no shared state.
func buildMergedMainJSON(template map[string]interface{}, groupConfig map[string]interface{}) (string, bool) {
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

// scriptFileSender caches per-send payloads and handles main.json config merging.
type scriptFileSender struct {
	files             []scriptFileData
	deviceConfigIndex map[string]map[string]interface{}

	basePutPayloadCache   map[string][]byte
	mergedPutPayloadCache map[string][]byte
	groupConfigKeyCache   map[uintptr]string
	groupConfigKeySeq     int
	mainJSONTemplates     map[string]map[string]interface{}
	mainJSONParsed        map[string]bool
}

func newScriptFileSender(files []scriptFileData, configIndex map[string]map[string]interface{}) *scriptFileSender {
	return &scriptFileSender{
		files:                 files,
		deviceConfigIndex:     configIndex,
		basePutPayloadCache:   make(map[string][]byte, len(files)),
		mergedPutPayloadCache: make(map[string][]byte),
		groupConfigKeyCache:   make(map[uintptr]string),
		mainJSONTemplates:     make(map[string]map[string]interface{}),
		mainJSONParsed:        make(map[string]bool),
	}
}

func (s *scriptFileSender) groupConfigKey(groupConfig map[string]interface{}) string {
	if groupConfig == nil {
		return ""
	}
	ptr := reflect.ValueOf(groupConfig).Pointer()
	if key, ok := s.groupConfigKeyCache[ptr]; ok {
		return key
	}
	s.groupConfigKeySeq++
	key := strconv.Itoa(s.groupConfigKeySeq)
	s.groupConfigKeyCache[ptr] = key
	return key
}

func (s *scriptFileSender) parseMainJSONTemplate(pathKey string, encoded string) map[string]interface{} {
	if s.mainJSONParsed[pathKey] {
		return s.mainJSONTemplates[pathKey]
	}
	s.mainJSONParsed[pathKey] = true

	rawJSON, decodeErr := base64.StdEncoding.DecodeString(encoded)
	if decodeErr != nil {
		return nil
	}
	var mainObj map[string]interface{}
	if err := json.Unmarshal(rawJSON, &mainObj); err != nil {
		return nil
	}
	s.mainJSONTemplates[pathKey] = mainObj
	return mainObj
}

// sendSmallFile sends a single small file (f.Data != "") to conn, applying config merge if needed.
func (s *scriptFileSender) sendSmallFile(conn *SafeConn, f scriptFileData, groupConfig map[string]interface{}, configKey string) {
	if !f.IsMainJSON || groupConfig == nil {
		payload, ok := s.basePutPayloadCache[f.Path]
		if !ok {
			encoded, buildErr := buildFilePutPayload(f.Path, f.Data)
			if buildErr != nil {
				return
			}
			payload = encoded
			s.basePutPayloadCache[f.Path] = payload
		}
		writeTextMessageAsync(conn, payload)
		return
	}

	cacheKey := ""
	if configKey != "" {
		cacheKey = f.NormalizedPath + "|" + configKey
		if cachedPayload, ok := s.mergedPutPayloadCache[cacheKey]; ok {
			writeTextMessageAsync(conn, cachedPayload)
			return
		}
	}

	finalData := f.Data
	template := s.parseMainJSONTemplate(f.NormalizedPath, f.Data)
	if mergedData, ok := buildMergedMainJSON(template, groupConfig); ok {
		finalData = mergedData
	}

	payload, buildErr := buildFilePutPayload(f.Path, finalData)
	if buildErr != nil {
		return
	}
	if cacheKey != "" {
		s.mergedPutPayloadCache[cacheKey] = payload
	}
	writeTextMessageAsync(conn, payload)
}

// sendSmallFilesToConn sends all small files to a specific device connection.
func (s *scriptFileSender) sendSmallFilesToConn(conn *SafeConn, udid string) {
	groupConfig := s.deviceConfigIndex[udid]
	configKey := s.groupConfigKey(groupConfig)
	for _, f := range s.files {
		if f.Data == "" {
			continue
		}
		s.sendSmallFile(conn, f, groupConfig, configKey)
	}
}

// scriptsSendHandler handles POST /api/scripts/send
// Like scriptsSendAndStartHandler but only sends files, does not run the script
func scriptsSendHandler(c *gin.Context) {
	var req scriptSendRequest

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

	sender := newScriptFileSender(filesToSend, buildDeviceScriptConfigIndex(scriptName, req.SelectedGroups))

	deviceConns := snapshotDeviceConns(req.Devices)
	for _, udid := range req.Devices {
		if conn, exists := deviceConns[udid]; exists {
			broadcastDeviceMessage(udid, fmt.Sprintf("上传脚本 (%d小文件, %d大文件)", smallFilesCount, largeFilesCount))

			sender.sendSmallFilesToConn(conn, udid)

			for _, f := range filesToSend {
				if f.Data != "" {
					continue
				}
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

			broadcastDeviceMessage(udid, "脚本已上传")
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "files_sent": len(filesToSend)})
}

// scriptsSendAndStartHandler handles POST /api/scripts/send-and-start
func scriptsSendAndStartHandler(c *gin.Context) {
	var req scriptSendRequest

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
			if _, exists := deviceConns[udid]; exists {
				generation, ok := createScriptStartSession(udid, nil, false, "", scriptStartPhaseStarting, nil)
				if !ok {
					broadcastDeviceMessage(udid, "脚本启动已取消: 上一次脚本启动尚未完成，请稍后重试")
					continue
				}
				startScriptOnDevice(udid, generation, nil, false, "", 0)
			} else {
				broadcastDeviceMessage(udid, "脚本启动失败: 设备未连接")
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

	sender := newScriptFileSender(filesToSend, buildDeviceScriptConfigIndex(scriptName, req.SelectedGroups))

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
	type plannedLargeFetch struct {
		file      scriptFileData
		requestID string
	}
	for _, udid := range req.Devices {
		if conn, exists := deviceConns[udid]; exists {
			plannedLargeFetches := make([]plannedLargeFetch, 0, largeFilesCount)
			for _, f := range filesToSend {
				if f.Data == "" {
					plannedLargeFetches = append(plannedLargeFetches, plannedLargeFetch{
						file:      f,
						requestID: uuid.New().String(),
					})
				}
			}
			pendingFetchRequests := make([]pendingScriptFetchRequest, 0, len(plannedLargeFetches))
			for _, planned := range plannedLargeFetches {
				pendingFetchRequests = append(pendingFetchRequests, pendingScriptFetchRequest{
					requestID:  planned.requestID,
					targetPath: planned.file.Path,
				})
			}
			largeTransferPrepareFailed := false
			generation, ok := createScriptStartSession(udid, runPayload, runPayloadPrepared, runName, scriptStartPhasePreparing, pendingFetchRequests)
			if !ok {
				broadcastDeviceMessage(udid, "脚本启动已取消: 上一次脚本启动尚未完成，请稍后重试")
				continue
			}

			broadcastDeviceMessage(udid, fmt.Sprintf("发送脚本 (%d小文件, %d大文件)", smallFilesCount, largeFilesCount))

			sender.sendSmallFilesToConn(conn, udid)

			for _, planned := range plannedLargeFetches {
				f := planned.file

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
						"requestId":  planned.requestID,
						"md5":        md5Hash,
						"totalBytes": f.Size,
						"timeout":    300, // 5 minutes
					},
				}
				fetchPayload, marshalErr := json.Marshal(fetchMsg)
				if marshalErr != nil {
					transferTokensMu.Lock()
					delete(transferTokens, token)
					transferTokensMu.Unlock()
					largeTransferPrepareFailed = true
					break
				}
				writeTextMessageAsync(conn, fetchPayload)
			}

			if largeTransferPrepareFailed {
				clearScriptStartSessionIfGeneration(udid, generation)
				broadcastDeviceMessage(udid, "脚本启动已取消: 大文件传输准备失败")
				continue
			}

			if len(pendingFetchRequests) > 0 {
				updateScriptStartSessionPhase(udid, generation, scriptStartPhaseWaitingTransfer, true)
				if hasPendingScriptStart(udid) {
					broadcastDeviceMessage(udid, fmt.Sprintf("等待大文件传输完成后启动脚本 (%d)", len(pendingFetchRequests)))
				}
				continue
			}

			broadcastDeviceMessage(udid, "启动脚本...")
			updateScriptStartSessionPhase(udid, generation, scriptStartPhaseStarting, true)
			startScriptOnDevice(udid, generation, runPayload, runPayloadPrepared, runName, ScriptStartDelay)
		} else {
			broadcastDeviceMessage(udid, "脚本启动失败: 设备未连接")
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "files_sent": len(filesToSend)})
}

// scriptsSendAndStartCancelHandler handles POST /api/scripts/send-and-start/cancel
func scriptsSendAndStartCancelHandler(c *gin.Context) {
	var req struct {
		Devices []string `json:"devices"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if len(req.Devices) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "devices are required"})
		return
	}

	canceled := make([]string, 0, len(req.Devices))
	ignored := make([]gin.H, 0)
	for _, udid := range req.Devices {
		result := cancelScriptStartSession(udid)
		if result.Canceled {
			canceled = append(canceled, udid)
			broadcastDeviceMessage(udid, "脚本启动已取消: 已取消本次启动流程")
			continue
		}
		ignored = append(ignored, gin.H{
			"udid":   udid,
			"reason": result.Reason,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"canceled": canceled,
		"ignored":  ignored,
	})
}

// scriptsStartStateHandler handles GET /api/scripts/start-state
func scriptsStartStateHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"states": snapshotScriptStartStates(nil),
	})
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
