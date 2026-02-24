package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// generateGroupID generates a unique group ID
func generateGroupID() string {
	return fmt.Sprintf("g%d", time.Now().UnixNano())
}

// groupsListHandler handles GET /api/groups
func groupsListHandler(c *gin.Context) {
	deviceGroupsMu.RLock()
	defer deviceGroupsMu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"groups": deviceGroups})
}

// groupsCreateHandler handles POST /api/groups
func groupsCreateHandler(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group name cannot be empty"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	newGroup := GroupInfo{
		ID:        generateGroupID(),
		Name:      name,
		DeviceIDs: []string{},
		SortOrder: len(deviceGroups),
	}
	deviceGroups = append(deviceGroups, newGroup)
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true, "group": newGroup})
}

// groupsUpdateHandler handles PUT /api/groups/:id
func groupsUpdateHandler(c *gin.Context) {
	groupID := c.Param("id")
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Group name cannot be empty"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	found := false
	for i := range deviceGroups {
		if deviceGroups[i].ID == groupID {
			deviceGroups[i].Name = name
			found = true
			break
		}
	}

	if !found {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsDeleteHandler handles DELETE /api/groups/:id
func groupsDeleteHandler(c *gin.Context) {
	groupID := c.Param("id")

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	found := false
	newGroups := make([]GroupInfo, 0, len(deviceGroups))
	for _, g := range deviceGroups {
		if g.ID != groupID {
			newGroups = append(newGroups, g)
		} else {
			found = true
		}
	}

	if !found {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	deviceGroups = newGroups
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsReorderHandler handles PUT /api/groups/reorder
func groupsReorderHandler(c *gin.Context) {
	var req struct {
		Order []string `json:"order"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if len(req.Order) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order cannot be empty"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	if len(req.Order) != len(deviceGroups) {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order must include all groups"})
		return
	}

	groupByID := make(map[string]GroupInfo, len(deviceGroups))
	for _, group := range deviceGroups {
		groupByID[group.ID] = group
	}
	seen := make(map[string]struct{}, len(req.Order))
	reorderedGroups := make([]GroupInfo, 0, len(req.Order))
	for i, id := range req.Order {
		if _, exists := seen[id]; exists {
			deviceGroupsMu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Order contains duplicate group IDs"})
			return
		}
		group, ok := groupByID[id]
		if !ok {
			deviceGroupsMu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Order contains unknown group ID"})
			return
		}
		seen[id] = struct{}{}
		group.SortOrder = i
		reorderedGroups = append(reorderedGroups, group)
	}

	deviceGroups = reorderedGroups
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsAddDevicesHandler handles POST /api/groups/:id/devices
func groupsAddDevicesHandler(c *gin.Context) {
	groupID := c.Param("id")
	var req struct {
		DeviceIDs []string `json:"deviceIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	found := false
	for i := range deviceGroups {
		if deviceGroups[i].ID == groupID {
			existing := make(map[string]bool)
			for _, id := range deviceGroups[i].DeviceIDs {
				existing[id] = true
			}
			for _, id := range req.DeviceIDs {
				if !existing[id] {
					deviceGroups[i].DeviceIDs = append(deviceGroups[i].DeviceIDs, id)
					existing[id] = true
				}
			}
			found = true
			break
		}
	}

	if !found {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsRemoveDevicesHandler handles DELETE /api/groups/:id/devices
func groupsRemoveDevicesHandler(c *gin.Context) {
	groupID := c.Param("id")
	var req struct {
		DeviceIDs []string `json:"deviceIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	found := false
	for i := range deviceGroups {
		if deviceGroups[i].ID == groupID {
			toRemove := make(map[string]bool)
			for _, id := range req.DeviceIDs {
				toRemove[id] = true
			}
			newDeviceIDs := make([]string, 0)
			for _, id := range deviceGroups[i].DeviceIDs {
				if !toRemove[id] {
					newDeviceIDs = append(newDeviceIDs, id)
				}
			}
			deviceGroups[i].DeviceIDs = newDeviceIDs
			found = true
			break
		}
	}

	if !found {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsBindScriptHandler handles PUT /api/groups/:id/script
func groupsBindScriptHandler(c *gin.Context) {
	groupID := c.Param("id")
	var req struct {
		ScriptPath string `json:"scriptPath"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	deviceGroupsMu.Lock()
	backupGroups := cloneGroupInfos(deviceGroups)

	found := false
	for i := range deviceGroups {
		if deviceGroups[i].ID == groupID {
			deviceGroups[i].ScriptPath = req.ScriptPath
			found = true
			break
		}
	}

	if !found {
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}
	if err := saveGroupsSnapshot(deviceGroups); err != nil {
		deviceGroups = backupGroups
		deviceGroupsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save groups"})
		return
	}
	deviceGroupsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsGetScriptConfigHandler handles GET /api/groups/:id/script-config
func groupsGetScriptConfigHandler(c *gin.Context) {
	groupID := c.Param("id")
	scriptPath := c.Query("script")

	if scriptPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "script is required"})
		return
	}

	groupScriptConfigsMu.RLock()
	defer groupScriptConfigsMu.RUnlock()

	if scripts, ok := groupScriptConfigs[groupID]; ok {
		if config, ok := scripts[scriptPath]; ok {
			c.JSON(http.StatusOK, config)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{})
}

// groupsSetScriptConfigHandler handles POST /api/groups/:id/script-config
func groupsSetScriptConfigHandler(c *gin.Context) {
	groupID := c.Param("id")
	var req struct {
		ScriptPath string                 `json:"scriptPath"`
		Config     map[string]interface{} `json:"config"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	groupScriptConfigsMu.Lock()
	backupConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	if _, ok := groupScriptConfigs[groupID]; !ok {
		groupScriptConfigs[groupID] = make(map[string]map[string]interface{})
	}
	groupScriptConfigs[groupID][req.ScriptPath] = req.Config

	if err := saveGroupScriptConfigsLocked(); err != nil {
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config"})
		return
	}
	groupScriptConfigsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// groupsDeleteScriptConfigHandler handles DELETE /api/groups/:id/script-config
func groupsDeleteScriptConfigHandler(c *gin.Context) {
	groupID := c.Param("id")
	scriptPath := c.Query("script")

	if scriptPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "script is required"})
		return
	}

	groupScriptConfigsMu.Lock()
	backupConfigs := cloneGroupScriptConfigsSnapshot(groupScriptConfigs)
	if scripts, ok := groupScriptConfigs[groupID]; ok {
		delete(scripts, scriptPath)
		if len(scripts) == 0 {
			delete(groupScriptConfigs, groupID)
		}
	}

	if err := saveGroupScriptConfigsLocked(); err != nil {
		groupScriptConfigs = backupConfigs
		groupScriptConfigsMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config"})
		return
	}
	groupScriptConfigsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true})
}
