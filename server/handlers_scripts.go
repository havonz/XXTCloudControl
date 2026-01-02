package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// isSelectableScript checks if a file/directory is a selectable script
func isSelectableScript(basePath string, name string, isDir bool) bool {
	fullPath := filepath.Join(basePath, name)

	if !isDir {
		ext := strings.ToLower(filepath.Ext(name))
		return ext == ".lua" || ext == ".xxt"
	}

	// Directory: check if it's a .xpp
	if strings.ToLower(filepath.Ext(name)) == ".xpp" {
		return true
	}

	// Directory: check if it's a piled script with lua/scripts/main.lua or main.xxt
	mainLua := filepath.Join(fullPath, "lua", "scripts", "main.lua")
	if _, err := os.Stat(mainLua); err == nil {
		return true
	}
	mainXxt := filepath.Join(fullPath, "lua", "scripts", "main.xxt")
	if _, err := os.Stat(mainXxt); err == nil {
		return true
	}

	return false
}

// selectableScriptsHandler handles GET /api/scripts/selectable
func selectableScriptsHandler(c *gin.Context) {
	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")

	if _, err := os.Stat(scriptsDir); os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"scripts": []string{}})
		return
	}

	entries, err := os.ReadDir(scriptsDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read scripts directory"})
		return
	}

	selectableScripts := make([]string, 0)
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		if isSelectableScript(scriptsDir, name, entry.IsDir()) {
			selectableScripts = append(selectableScripts, name)
		}
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

// scriptsSendAndStartHandler handles POST /api/scripts/send-and-start
func scriptsSendAndStartHandler(c *gin.Context) {
	var req struct {
		Devices        []string `json:"devices"`
		Name           string   `json:"name"`
		SelectedGroups []string `json:"selectedGroups"`
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
		mu.Lock()
		defer mu.Unlock()

		for _, udid := range req.Devices {
			if conn, exists := deviceLinks[udid]; exists {
				runMsg := Message{
					Type: "script/run",
					Body: gin.H{"name": ""},
				}
				go sendMessage(conn, runMsg)
			}
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "device_selected": true})
		return
	}

	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")
	scriptPath := filepath.Join(scriptsDir, req.Name)

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

	type FileData struct {
		Path string
		Data string
	}
	filesToSend := make([]FileData, 0)

	if !isDir {
		content, err := os.ReadFile(scriptPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read script file"})
			return
		}
		filesToSend = append(filesToSend, FileData{
			Path: filepath.Join("lua", "scripts", req.Name),
			Data: base64.StdEncoding.EncodeToString(content),
		})
	} else if isPiled {
		err := filepath.Walk(scriptPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return err
			}
			relPath, _ := filepath.Rel(scriptPath, path)
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			filesToSend = append(filesToSend, FileData{
				Path: relPath,
				Data: base64.StdEncoding.EncodeToString(content),
			})
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read script directory"})
			return
		}
	} else {
		err := filepath.Walk(scriptPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return err
			}
			relPath, _ := filepath.Rel(scriptPath, path)
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			filesToSend = append(filesToSend, FileData{
				Path: filepath.Join("lua", "scripts", req.Name, relPath),
				Data: base64.StdEncoding.EncodeToString(content),
			})
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read script directory"})
			return
		}
	}

	mu.Lock()
	defer mu.Unlock()

	for _, udid := range req.Devices {
		if conn, exists := deviceLinks[udid]; exists {
			groupConfig := resolveDeviceScriptConfig(udid, req.Name, req.SelectedGroups)

			for _, f := range filesToSend {
				finalData := f.Data

				// Check if this is main.json and we have group-specific config
				// Use forward slashes for path comparison (iOS uses /)
				normalizedPath := strings.ReplaceAll(f.Path, "\\", "/")
				isMainJson := normalizedPath == "lua/scripts/main.json" ||
					strings.HasSuffix(normalizedPath, "/main.json")

				if isMainJson && groupConfig != nil {
					rawJson, decodeErr := base64.StdEncoding.DecodeString(f.Data)
					if decodeErr == nil {
						var mainObj map[string]interface{}
						if json.Unmarshal(rawJson, &mainObj) == nil {
							configObj, ok := mainObj["Config"].(map[string]interface{})
							if !ok {
								configObj = make(map[string]interface{})
							}
							for k, v := range groupConfig {
								configObj[k] = v
							}
							mainObj["Config"] = configObj

							newJson, _ := json.Marshal(mainObj)
							finalData = base64.StdEncoding.EncodeToString(newJson)
						}
					}
				}

				putMsg := Message{
					Type: "file/put",
					Body: gin.H{
						"path": f.Path,
						"data": finalData,
					},
				}
				go sendMessage(conn, putMsg)
			}

			runName := req.Name
			if isPiled {
				if _, err := os.Stat(filepath.Join(scriptPath, "lua", "scripts", "main.lua")); err == nil {
					runName = "main.lua"
				} else {
					runName = "main.xxt"
				}
			}

			runMsg := Message{
				Type: "script/run",
				Body: gin.H{
					"name": runName,
				},
			}
			go func(c *SafeConn, m Message) {
				time.Sleep(ScriptStartDelay)
				sendMessage(c, m)
			}(conn, runMsg)
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

	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")
	scriptPath := filepath.Join(scriptsDir, name)

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

	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")
	mainJsonPath := filepath.Join(scriptsDir, name, "lua", "scripts", "main.json")

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

	scriptsDir := filepath.Join(serverConfig.DataDir, "scripts")
	mainJsonPath := filepath.Join(scriptsDir, req.Name, "lua", "scripts", "main.json")

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
