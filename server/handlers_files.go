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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"files": []ServerFileItem{}})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is not a directory"})
		return
	}

	entries, err := os.ReadDir(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
		return
	}
	defer file.Close()

	fileName := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	if err := validateFileName(fileName); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetFilePath := filepath.Join(targetDir, fileName)

	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve base path"})
		return
	}
	absTargetFile, err := filepath.Abs(targetFilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve file path"})
		return
	}
	if !isPathWithinAbsBase(absBaseDir, absTargetFile) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}

	dst, err := os.Create(absTargetFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	fullPath = strings.TrimPrefix(fullPath, "/")
	parts := strings.SplitN(fullPath, "/", 2)
	if len(parts) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path format"})
		return
	}

	category := parts[0]
	filePath := parts[1]

	targetPath, err := validatePath(category, filePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot download a directory"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	baseDir := filepath.Join(serverConfig.DataDir, category)
	absBaseDir, _ := filepath.Abs(baseDir)
	if targetPath == absBaseDir {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete root category directory"})
		return
	}

	info, err := os.Lstat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file or directory not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if err := validateFileName(req.Name); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Type != "file" && req.Type != "dir" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be 'file' or 'dir'"})
		return
	}

	targetDir, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create parent directory"})
		return
	}

	targetPath := filepath.Join(targetDir, req.Name)

	baseDir := filepath.Join(serverConfig.DataDir, req.Category)
	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve base path"})
		return
	}
	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve target path"})
		return
	}
	if !isPathWithinAbsBase(absBaseDir, absTargetPath) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
		return
	}

	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file or directory already exists"})
		return
	}

	if req.Type == "dir" {
		if err := os.MkdirAll(targetPath, 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
			return
		}
		debugLogf("📁 Created directory: %s/%s/%s", req.Category, req.Path, req.Name)
	} else {
		file, err := os.Create(targetPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
			return
		}
		defer file.Close()

		if req.Content != "" {
			if _, err := file.WriteString(req.Content); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file content"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.OldName == "" || req.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oldName and newName are required"})
		return
	}
	if err := validateFileName(req.OldName); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateFileName(req.NewName); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetDir, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	oldPath := filepath.Join(targetDir, req.OldName)
	newPath := filepath.Join(targetDir, req.NewName)

	if err := os.Rename(oldPath, newPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rename"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(category, subPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read a directory"})
		return
	}

	if info.Size() > MaxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 5MB)"})
		return
	}

	content, err := os.ReadFile(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.Category == "" || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category and path are required"})
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	info, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot write to a directory"})
		return
	}

	if err := os.WriteFile(targetPath, []byte(req.Content), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
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
		c.JSON(http.StatusForbidden, gin.H{"error": "only allowed from local machine"})
		return
	}

	var req struct {
		Category string `json:"category"`
		Path     string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetPath, err := validatePath(req.Category, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open: " + err.Error()})
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

// serverFilesBatchCopyHandler handles POST /api/server-files/batch-copy
func serverFilesBatchCopyHandler(c *gin.Context) {
	var req struct {
		Category    string   `json:"category"`    // Deprecated: for backwards compatibility
		SrcCategory string   `json:"srcCategory"` // Source category (scripts/files/reports)
		DstCategory string   `json:"dstCategory"` // Destination category
		Items       []string `json:"items"`       // Items to copy (relative paths in source)
		SrcPath     string   `json:"srcPath"`     // Source directory
		DstPath     string   `json:"dstPath"`     // Destination directory
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if len(req.Items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no items to copy"})
		return
	}

	// Support both old (category) and new (srcCategory/dstCategory) API
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dstDir, err := validatePath(dstCategory, req.DstPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Ensure destination directory exists
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create destination directory"})
		return
	}

	srcBaseDir := filepath.Join(serverConfig.DataDir, srcCategory)
	absSrcBaseDir, err := filepath.Abs(srcBaseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve source base path"})
		return
	}
	dstBaseDir := filepath.Join(serverConfig.DataDir, dstCategory)
	absDstBaseDir, err := filepath.Abs(dstBaseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve destination base path"})
		return
	}

	successCount := 0
	var errors []string

	for _, item := range req.Items {
		cleanItem, cleanErr := sanitizeRelativeItemPath(item)
		if cleanErr != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, cleanErr))
			continue
		}
		srcPath := filepath.Join(srcDir, cleanItem)
		dstPath := filepath.Join(dstDir, cleanItem)

		// Validate source path doesn't escape
		absSrcPath, err := filepath.Abs(srcPath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: failed to resolve source path", item))
			continue
		}
		if !isPathWithinAbsBase(absSrcBaseDir, absSrcPath) {
			errors = append(errors, fmt.Sprintf("%s: source path traversal detected", item))
			continue
		}

		// Validate destination path doesn't escape
		absDstPath, err := filepath.Abs(dstPath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: failed to resolve destination path", item))
			continue
		}
		if !isPathWithinAbsBase(absDstBaseDir, absDstPath) {
			errors = append(errors, fmt.Sprintf("%s: destination path traversal detected", item))
			continue
		}

		_, err = os.Lstat(srcPath)
		if os.IsNotExist(err) {
			errors = append(errors, fmt.Sprintf("%s: not found", item))
			continue
		}
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, err))
			continue
		}

		// Check if destination already exists
		if _, err := os.Lstat(dstPath); !os.IsNotExist(err) {
			errors = append(errors, fmt.Sprintf("%s: already exists at destination", item))
			continue
		}

		if err := copyPathPreserveSymlink(srcPath, dstPath); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, err))
			continue
		}

		successCount++
	}

	debugLogf("📋 Batch copy: %d/%d items copied from %s/%s to %s/%s", successCount, len(req.Items), srcCategory, req.SrcPath, dstCategory, req.DstPath)

	c.JSON(http.StatusOK, gin.H{
		"success":      successCount == len(req.Items),
		"successCount": successCount,
		"totalCount":   len(req.Items),
		"errors":       errors,
	})
}

// serverFilesBatchMoveHandler handles POST /api/server-files/batch-move
func serverFilesBatchMoveHandler(c *gin.Context) {
	var req struct {
		Category    string   `json:"category"`    // Deprecated: for backwards compatibility
		SrcCategory string   `json:"srcCategory"` // Source category (scripts/files/reports)
		DstCategory string   `json:"dstCategory"` // Destination category
		Items       []string `json:"items"`       // Items to move (relative paths in source)
		SrcPath     string   `json:"srcPath"`     // Source directory
		DstPath     string   `json:"dstPath"`     // Destination directory
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if len(req.Items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no items to move"})
		return
	}

	// Support both old (category) and new (srcCategory/dstCategory) API
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dstDir, err := validatePath(dstCategory, req.DstPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Ensure destination directory exists
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create destination directory"})
		return
	}

	srcBaseDir := filepath.Join(serverConfig.DataDir, srcCategory)
	absSrcBaseDir, err := filepath.Abs(srcBaseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve source base path"})
		return
	}
	dstBaseDir := filepath.Join(serverConfig.DataDir, dstCategory)
	absDstBaseDir, err := filepath.Abs(dstBaseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve destination base path"})
		return
	}

	successCount := 0
	var errors []string

	for _, item := range req.Items {
		cleanItem, cleanErr := sanitizeRelativeItemPath(item)
		if cleanErr != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, cleanErr))
			continue
		}
		srcPath := filepath.Join(srcDir, cleanItem)
		dstPath := filepath.Join(dstDir, cleanItem)

		// Validate source path doesn't escape
		absSrcPath, err := filepath.Abs(srcPath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: failed to resolve source path", item))
			continue
		}
		if !isPathWithinAbsBase(absSrcBaseDir, absSrcPath) {
			errors = append(errors, fmt.Sprintf("%s: source path traversal detected", item))
			continue
		}

		// Validate destination path doesn't escape
		absDstPath, err := filepath.Abs(dstPath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: failed to resolve destination path", item))
			continue
		}
		if !isPathWithinAbsBase(absDstBaseDir, absDstPath) {
			errors = append(errors, fmt.Sprintf("%s: destination path traversal detected", item))
			continue
		}

		_, err = os.Lstat(srcPath)
		if os.IsNotExist(err) {
			errors = append(errors, fmt.Sprintf("%s: not found", item))
			continue
		}
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", item, err))
			continue
		}

		// Check if destination already exists
		if _, err := os.Lstat(dstPath); !os.IsNotExist(err) {
			errors = append(errors, fmt.Sprintf("%s: already exists at destination", item))
			continue
		}

		// Move the file/directory (use copy+delete for cross-filesystem moves)
		if err := os.Rename(srcPath, dstPath); err != nil {
			// os.Rename may fail across filesystems, so try copy+delete while preserving symlinks.
			srcInfo, statErr := os.Lstat(srcPath)
			if os.IsNotExist(statErr) {
				errors = append(errors, fmt.Sprintf("%s: not found", item))
				continue
			}
			if statErr != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", item, err))
				continue
			}
			if copyErr := copyPathPreserveSymlink(srcPath, dstPath); copyErr != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", item, copyErr))
				continue
			}
			// Remove source after successful copy.
			if srcInfo.Mode()&os.ModeSymlink != 0 {
				if removeErr := os.Remove(srcPath); removeErr != nil {
					errors = append(errors, fmt.Sprintf("%s: failed to remove source symlink: %v", item, removeErr))
					continue
				}
			} else if srcInfo.IsDir() {
				if removeErr := os.RemoveAll(srcPath); removeErr != nil {
					errors = append(errors, fmt.Sprintf("%s: failed to remove source directory: %v", item, removeErr))
					continue
				}
			} else {
				if removeErr := os.Remove(srcPath); removeErr != nil {
					errors = append(errors, fmt.Sprintf("%s: failed to remove source file: %v", item, removeErr))
					continue
				}
			}
		}

		successCount++
	}

	debugLogf("✂️ Batch move: %d/%d items moved from %s/%s to %s/%s", successCount, len(req.Items), srcCategory, req.SrcPath, dstCategory, req.DstPath)

	c.JSON(http.StatusOK, gin.H{
		"success":      successCount == len(req.Items),
		"successCount": successCount,
		"totalCount":   len(req.Items),
		"errors":       errors,
	})
}
