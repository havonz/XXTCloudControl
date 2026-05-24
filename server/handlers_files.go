package main

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gin-gonic/gin"
)

// isValidCategory checks if a category is valid
func isValidCategory(category string) bool {
	for _, c := range AllowedCategories {
		if c == category {
			return true
		}
	}
	return false
}

func classifyEntry(parentPath string, entry os.DirEntry, includeMeta bool) (fileType string, size int64, modTime string, isSymlink bool) {
	fileType = "file"
	entryPath := filepath.Join(parentPath, entry.Name())
	entryType := entry.Type()

	// DirEntry.Type() may be unknown on some filesystems, so use Lstat fallback.
	if entryType&os.ModeSymlink != 0 {
		isSymlink = true
	} else if entryType == 0 {
		if info, lstatErr := os.Lstat(entryPath); lstatErr == nil && info.Mode()&os.ModeSymlink != 0 {
			isSymlink = true
		}
	}

	// Follow symlink targets so linked directories can be browsed like normal folders.
	info, err := os.Stat(entryPath)
	if err != nil {
		if entry.IsDir() {
			fileType = "dir"
		}
		if includeMeta {
			if fallbackInfo, fallbackErr := os.Lstat(entryPath); fallbackErr == nil {
				size = fallbackInfo.Size()
				modTime = fallbackInfo.ModTime().Format("2006-01-02 15:04:05")
			} else if fallbackInfo, fallbackErr := entry.Info(); fallbackErr == nil {
				size = fallbackInfo.Size()
				modTime = fallbackInfo.ModTime().Format("2006-01-02 15:04:05")
			}
		}
		return
	}

	if info.IsDir() {
		fileType = "dir"
	}
	if includeMeta {
		size = info.Size()
		modTime = info.ModTime().Format("2006-01-02 15:04:05")
	}
	return
}

func isPathWithinAbsBase(absBaseDir, absTargetPath string) bool {
	base := filepath.Clean(absBaseDir)
	target := filepath.Clean(absTargetPath)

	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." {
		return false
	}
	if filepath.IsAbs(rel) {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// sanitizeRelativeItemPath validates a relative path used by batch operations.
// It rejects absolute paths and parent traversal segments.
func sanitizeRelativeItemPath(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("item path is required")
	}

	// Treat both slash styles as separators for user input.
	normalized := strings.ReplaceAll(trimmed, "\\", "/")
	if strings.HasPrefix(normalized, "/") {
		return "", fmt.Errorf("item path must be relative")
	}
	// Reject Windows drive-absolute paths (e.g. C:/...).
	if len(normalized) >= 2 && normalized[1] == ':' {
		return "", fmt.Errorf("item path must be relative")
	}

	cleaned := path.Clean(normalized)
	if cleaned == "." || cleaned == "/" {
		return "", fmt.Errorf("item path is invalid")
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("item path traversal detected")
	}

	return filepath.FromSlash(cleaned), nil
}

// validatePath validates a path within a category and returns the absolute path
func validatePath(category, subPath string) (string, error) {
	if !isValidCategory(category) {
		return "", fmt.Errorf("invalid category: %s", category)
	}

	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}

	cleanSubPath := filepath.Clean("/" + subPath)
	if cleanSubPath == "/" {
		cleanSubPath = ""
	}

	targetPath := filepath.Join(absBaseDir, cleanSubPath)
	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		return "", err
	}

	if !isPathWithinAbsBase(absBaseDir, absTargetPath) {
		return "", fmt.Errorf("path traversal detected")
	}

	return absTargetPath, nil
}

// validateFileName ensures a name does not contain path separators or traversal.
func validateFileName(name string) error {
	if name == "" {
		return fmt.Errorf("name is required")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("invalid name")
	}
	// Reject path separators to avoid traversal like ../
	if strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return fmt.Errorf("name cannot contain path separators")
	}
	return nil
}

// serverFilesListHandler handles GET /api/server-files/list
func serverFilesListHandler(c *gin.Context) {
	category := c.DefaultQuery("category", "scripts")
	subPath := c.DefaultQuery("path", "")
	includeMeta := false
	if metaParam, ok := c.GetQuery("meta"); ok {
		switch strings.ToLower(metaParam) {
		case "0", "false", "no":
			includeMeta = false
		case "1", "true", "yes":
			includeMeta = true
		}
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"files": []ServerFileItem{}})
		return
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	if !info.IsDir() {
		jsonError(c, http.StatusBadRequest, "path is not a directory")
		return
	}

	entries, err := os.ReadDir(targetPath)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	files := make([]ServerFileItem, 0, len(entries))
	for _, entry := range entries {
		fileType, size, modTime, isSymlink := classifyEntry(targetPath, entry, includeMeta)

		files = append(files, ServerFileItem{
			Name:      entry.Name(),
			Type:      fileType,
			Size:      size,
			ModTime:   modTime,
			IsSymlink: isSymlink,
		})
	}

	c.JSON(http.StatusOK, gin.H{"files": files, "path": subPath, "category": category})
}

// serverFilesUploadHandler handles POST /api/server-files/upload
func serverFilesUploadHandler(c *gin.Context) {
	category := c.DefaultPostForm("category", "scripts")
	subPath := c.DefaultPostForm("path", "")

	targetDir, err := validatePath(category, subPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to create directory")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		jsonError(c, http.StatusBadRequest, "no file uploaded")
		return
	}
	defer file.Close()

	fileName := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	if err := validateFileName(fileName); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	if category == "scripts" && isLanControlArchiveFileName(fileName) {
		result, err := installLanControlArchiveFromReader(serverConfig.DataDir, fileName, file, "", false)
		if err != nil {
			status := http.StatusBadRequest
			if strings.Contains(err.Error(), "already exists") {
				status = http.StatusConflict
			}
			jsonError(c, status, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"filename":    fileName,
			"path":        result.ScriptPath,
			"category":    category,
			"installed":   true,
			"installName": result.InstallName,
			"scriptPath":  result.ScriptPath,
		})
		return
	}

	targetFilePath := filepath.Join(targetDir, fileName)

	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve base path")
		return
	}
	absTargetFile, err := filepath.Abs(targetFilePath)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve file path")
		return
	}
	if !isPathWithinAbsBase(absBaseDir, absTargetFile) {
		jsonError(c, http.StatusBadRequest, "invalid file path")
		return
	}

	dst, err := os.Create(absTargetFile)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to create file")
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to save file")
		return
	}

	debugLogf("📤 File uploaded: %s/%s/%s", category, subPath, header.Filename)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"filename": fileName,
		"path":     filepath.Join(subPath, fileName),
		"category": category,
	})
}

// serverFilesDownloadHandler handles GET /api/server-files/download/*path
func serverFilesDownloadHandler(c *gin.Context) {
	fullPath := c.Param("path")
	if fullPath == "" || fullPath == "/" {
		jsonError(c, http.StatusBadRequest, "path is required")
		return
	}

	fullPath = strings.TrimPrefix(fullPath, "/")
	parts := strings.SplitN(fullPath, "/", 2)
	if len(parts) < 2 {
		jsonError(c, http.StatusBadRequest, "invalid path format")
		return
	}

	category := parts[0]
	filePath := parts[1]

	targetPath, err := validatePath(category, filePath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		jsonError(c, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	if info.IsDir() {
		jsonError(c, http.StatusBadRequest, "cannot download a directory")
		return
	}

	fileName := filepath.Base(targetPath)
	ext := filepath.Ext(fileName)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	c.Header("Content-Type", mimeType)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	// Large browser downloads can legitimately exceed the server global WriteTimeout.
	// Clear per-request deadlines for this response to avoid mid-transfer truncation.
	clearTransferRequestDeadlines(c)
	c.File(targetPath)
}

// serverFilesDeleteHandler handles DELETE /api/server-files/delete
func serverFilesDeleteHandler(c *gin.Context) {
	category := c.Query("category")
	subPath := c.Query("path")

	if category == "" || subPath == "" {
		jsonError(c, http.StatusBadRequest, "category and path are required")
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, _ := filepath.Abs(baseDir)
	if targetPath == absBaseDir {
		jsonError(c, http.StatusBadRequest, "cannot delete root category directory")
		return
	}

	info, err := os.Lstat(targetPath)
	if os.IsNotExist(err) {
		jsonError(c, http.StatusNotFound, "file or directory not found")
		return
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	// Never recurse into symlink targets; remove the symlink itself only.
	if info.Mode()&os.ModeSymlink != 0 {
		err = os.Remove(targetPath)
	} else if info.IsDir() {
		err = os.RemoveAll(targetPath)
	} else {
		err = os.Remove(targetPath)
	}

	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to delete")
		return
	}

	debugLogf("🗑️ Deleted: %s/%s", category, subPath)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"path":     subPath,
		"category": category,
	})
}

// serverFilesCreateHandler handles POST /api/server-files/create
func serverFilesCreateHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		Name     string `json:"name"`
		Type     string `json:"type"`
		Content  string `json:"content,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}

	if req.Name == "" {
		jsonError(c, http.StatusBadRequest, "name is required")
		return
	}
	if err := validateFileName(req.Name); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Type != "file" && req.Type != "dir" {
		jsonError(c, http.StatusBadRequest, "type must be 'file' or 'dir'")
		return
	}

	targetDir, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to create parent directory")
		return
	}

	targetPath := filepath.Join(targetDir, req.Name)

	baseDir := filepath.Join(serverConfig.DataDir, req.Category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve base path")
		return
	}
	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve target path")
		return
	}
	if !isPathWithinAbsBase(absBaseDir, absTargetPath) {
		jsonError(c, http.StatusBadRequest, "invalid path")
		return
	}

	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		jsonError(c, http.StatusBadRequest, "file or directory already exists")
		return
	}

	if req.Type == "dir" {
		if err := os.MkdirAll(targetPath, 0755); err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create directory")
			return
		}
		debugLogf("📁 Created directory: %s/%s/%s", req.Category, req.Path, req.Name)
	} else {
		file, err := os.Create(targetPath)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create file")
			return
		}
		defer file.Close()

		if req.Content != "" {
			if _, err := file.WriteString(req.Content); err != nil {
				jsonError(c, http.StatusInternalServerError, "failed to write file content")
				return
			}
		}
		debugLogf("📄 Created file: %s/%s/%s", req.Category, req.Path, req.Name)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"name":     req.Name,
		"type":     req.Type,
		"path":     req.Path,
		"category": req.Category,
	})
}

// serverFilesRenameHandler handles POST /api/server-files/rename
func serverFilesRenameHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		OldName  string `json:"oldName"`
		NewName  string `json:"newName"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}

	if req.OldName == "" || req.NewName == "" {
		jsonError(c, http.StatusBadRequest, "oldName and newName are required")
		return
	}
	if err := validateFileName(req.OldName); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateFileName(req.NewName); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	targetDir, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	oldPath := filepath.Join(targetDir, req.OldName)
	newPath := filepath.Join(targetDir, req.NewName)

	if err := os.Rename(oldPath, newPath); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to rename")
		return
	}

	debugLogf("📝 Renamed: %s/%s -> %s", req.Category, req.OldName, req.NewName)

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// serverFilesReadHandler handles GET /api/server-files/read
func serverFilesReadHandler(c *gin.Context) {
	category := c.Query("category")
	subPath := c.Query("path")

	if category == "" || subPath == "" {
		jsonError(c, http.StatusBadRequest, "category and path are required")
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		jsonError(c, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	if info.IsDir() {
		jsonError(c, http.StatusBadRequest, "cannot read a directory")
		return
	}

	if info.Size() > MaxFileSize {
		jsonError(c, http.StatusBadRequest, "file too large (max 5MB)")
		return
	}

	content, err := os.ReadFile(targetPath)
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to read file")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"content": string(content),
		"size":    info.Size(),
	})
}

// serverFilesSaveHandler handles POST /api/server-files/save
func serverFilesSaveHandler(c *gin.Context) {
	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
		Content  string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return
	}

	if req.Category == "" || req.Path == "" {
		jsonError(c, http.StatusBadRequest, "category and path are required")
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		jsonError(c, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		jsonError(c, http.StatusInternalServerError, err.Error())
		return
	}

	if info.IsDir() {
		jsonError(c, http.StatusBadRequest, "cannot write to a directory")
		return
	}

	if err := os.WriteFile(targetPath, []byte(req.Content), 0644); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to save file")
		return
	}

	debugLogf("💾 Saved file: %s/%s", req.Category, req.Path)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"path":    req.Path,
	})
}

// serverFilesOpenLocalHandler handles POST /api/server-files/open-local
func serverFilesOpenLocalHandler(c *gin.Context) {
	if !isLocalRequest(c) {
		jsonError(c, http.StatusForbidden, "only allowed from local machine")
		return
	}

	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", targetPath)
	case "darwin":
		cmd = exec.Command("open", targetPath)
	default:
		cmd = exec.Command("xdg-open", targetPath)
	}

	if err := cmd.Start(); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to open: "+err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func copySymlink(src, dst string) error {
	target, err := os.Readlink(src)
	if err != nil {
		return err
	}
	return os.Symlink(target, dst)
}

func copyPathPreserveSymlink(src, dst string) error {
	srcInfo, err := os.Lstat(src)
	if err != nil {
		return err
	}

	if srcInfo.Mode()&os.ModeSymlink != 0 {
		return copySymlink(src, dst)
	}
	if srcInfo.IsDir() {
		return copyDirRecursive(src, dst)
	}
	return copyFile(src, dst)
}

// copyDirRecursive recursively copies a directory while preserving symlink entries.
func copyDirRecursive(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		entryInfo, err := os.Lstat(srcPath)
		if err != nil {
			return err
		}

		if entryInfo.Mode()&os.ModeSymlink != 0 {
			if err := copySymlink(srcPath, dstPath); err != nil {
				return err
			}
		} else if entry.IsDir() {
			if err := copyDirRecursive(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// copyFile copies a single file
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return err
	}

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return err
	}

	return os.Chmod(dst, srcInfo.Mode())
}

type serverFilesBatchRequest struct {
	Category    string   `json:"category"`
	SrcCategory string   `json:"srcCategory"`
	DstCategory string   `json:"dstCategory"`
	Items       []string `json:"items"`
	SrcPath     string   `json:"srcPath"`
	DstPath     string   `json:"dstPath"`
}

type serverFilesBatchContext struct {
	request       serverFilesBatchRequest
	srcCategory   string
	dstCategory   string
	srcDir        string
	dstDir        string
	absSrcBaseDir string
	absDstBaseDir string
}

type serverFilesBatchItem struct {
	sourcePath      string
	destinationPath string
}

type serverFilesBatchOperation func(serverFilesBatchItem) error

func resolveServerFilesBatchContext(c *gin.Context, action string) (serverFilesBatchContext, bool) {
	var req serverFilesBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		jsonError(c, http.StatusBadRequest, "invalid request")
		return serverFilesBatchContext{}, false
	}

	if len(req.Items) == 0 {
		jsonError(c, http.StatusBadRequest, "no items to "+action)
		return serverFilesBatchContext{}, false
	}

	srcCategory := req.SrcCategory
	dstCategory := req.DstCategory
	if srcCategory == "" {
		srcCategory = req.Category
	}
	if dstCategory == "" {
		dstCategory = req.Category
	}

	srcDir, err := validatePath(srcCategory, req.SrcPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return serverFilesBatchContext{}, false
	}

	dstDir, err := validatePath(dstCategory, req.DstPath)
	if err != nil {
		jsonError(c, http.StatusBadRequest, err.Error())
		return serverFilesBatchContext{}, false
	}

	if err := os.MkdirAll(dstDir, 0755); err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to create destination directory")
		return serverFilesBatchContext{}, false
	}

	absSrcBaseDir, err := filepath.Abs(filepath.Join(serverConfig.DataDir, srcCategory))
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve source base path")
		return serverFilesBatchContext{}, false
	}
	absDstBaseDir, err := filepath.Abs(filepath.Join(serverConfig.DataDir, dstCategory))
	if err != nil {
		jsonError(c, http.StatusInternalServerError, "failed to resolve destination base path")
		return serverFilesBatchContext{}, false
	}

	return serverFilesBatchContext{
		request:       req,
		srcCategory:   srcCategory,
		dstCategory:   dstCategory,
		srcDir:        srcDir,
		dstDir:        dstDir,
		absSrcBaseDir: absSrcBaseDir,
		absDstBaseDir: absDstBaseDir,
	}, true
}

func prepareServerFilesBatchItem(ctx serverFilesBatchContext, item string) (serverFilesBatchItem, error) {
	cleanItem, err := sanitizeRelativeItemPath(item)
	if err != nil {
		return serverFilesBatchItem{}, err
	}

	sourcePath := filepath.Join(ctx.srcDir, cleanItem)
	destinationPath := filepath.Join(ctx.dstDir, cleanItem)

	absSrcPath, err := filepath.Abs(sourcePath)
	if err != nil {
		return serverFilesBatchItem{}, fmt.Errorf("failed to resolve source path")
	}
	if !isPathWithinAbsBase(ctx.absSrcBaseDir, absSrcPath) {
		return serverFilesBatchItem{}, fmt.Errorf("source path traversal detected")
	}

	absDstPath, err := filepath.Abs(destinationPath)
	if err != nil {
		return serverFilesBatchItem{}, fmt.Errorf("failed to resolve destination path")
	}
	if !isPathWithinAbsBase(ctx.absDstBaseDir, absDstPath) {
		return serverFilesBatchItem{}, fmt.Errorf("destination path traversal detected")
	}

	if _, err := os.Lstat(sourcePath); os.IsNotExist(err) {
		return serverFilesBatchItem{}, fmt.Errorf("not found")
	} else if err != nil {
		return serverFilesBatchItem{}, err
	}

	if _, err := os.Lstat(destinationPath); !os.IsNotExist(err) {
		return serverFilesBatchItem{}, fmt.Errorf("already exists at destination")
	}

	return serverFilesBatchItem{sourcePath: sourcePath, destinationPath: destinationPath}, nil
}

func runServerFilesBatch(ctx serverFilesBatchContext, operate serverFilesBatchOperation) (int, []string) {
	successCount := 0
	var errors []string

	for _, item := range ctx.request.Items {
		batchItem, err := prepareServerFilesBatchItem(ctx, item)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, err))
			continue
		}

		if err := operate(batchItem); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, err))
			continue
		}

		successCount++
	}

	return successCount, errors
}

func respondServerFilesBatch(c *gin.Context, totalCount, successCount int, errors []string) {
	c.JSON(http.StatusOK, gin.H{
		"success":      successCount == totalCount,
		"successCount": successCount,
		"totalCount":   totalCount,
		"errors":       errors,
	})
}

func copyServerFilesBatchItem(item serverFilesBatchItem) error {
	return copyPathPreserveSymlink(item.sourcePath, item.destinationPath)
}

func moveServerFilesBatchItem(item serverFilesBatchItem) error {
	if err := os.Rename(item.sourcePath, item.destinationPath); err != nil {
		return movePathPreserveSymlink(item.sourcePath, item.destinationPath, err)
	}
	return nil
}

func movePathPreserveSymlink(srcPath, dstPath string, renameErr error) error {
	srcInfo, statErr := os.Lstat(srcPath)
	if os.IsNotExist(statErr) {
		return fmt.Errorf("not found")
	}
	if statErr != nil {
		return renameErr
	}
	if copyErr := copyPathPreserveSymlink(srcPath, dstPath); copyErr != nil {
		return copyErr
	}

	return removeMovedSource(srcPath, srcInfo)
}

func removeMovedSource(srcPath string, srcInfo os.FileInfo) error {
	switch {
	case srcInfo.Mode()&os.ModeSymlink != 0:
		if removeErr := os.Remove(srcPath); removeErr != nil {
			return fmt.Errorf("failed to remove source symlink: %v", removeErr)
		}
	case srcInfo.IsDir():
		if removeErr := os.RemoveAll(srcPath); removeErr != nil {
			return fmt.Errorf("failed to remove source directory: %v", removeErr)
		}
	default:
		if removeErr := os.Remove(srcPath); removeErr != nil {
			return fmt.Errorf("failed to remove source file: %v", removeErr)
		}
	}

	return nil
}

// serverFilesBatchCopyHandler handles POST /api/server-files/batch-copy
func serverFilesBatchCopyHandler(c *gin.Context) {
	ctx, ok := resolveServerFilesBatchContext(c, "copy")
	if !ok {
		return
	}

	successCount, errors := runServerFilesBatch(ctx, copyServerFilesBatchItem)

	debugLogf("📋 Batch copy: %d/%d items copied from %s/%s to %s/%s", successCount, len(ctx.request.Items), ctx.srcCategory, ctx.request.SrcPath, ctx.dstCategory, ctx.request.DstPath)

	respondServerFilesBatch(c, len(ctx.request.Items), successCount, errors)
}

// serverFilesBatchMoveHandler handles POST /api/server-files/batch-move
func serverFilesBatchMoveHandler(c *gin.Context) {
	ctx, ok := resolveServerFilesBatchContext(c, "move")
	if !ok {
		return
	}

	successCount, errors := runServerFilesBatch(ctx, moveServerFilesBatchItem)

	debugLogf("✂️ Batch move: %d/%d items moved from %s/%s to %s/%s", successCount, len(ctx.request.Items), ctx.srcCategory, ctx.request.SrcPath, ctx.dstCategory, ctx.request.DstPath)

	respondServerFilesBatch(c, len(ctx.request.Items), successCount, errors)
}
