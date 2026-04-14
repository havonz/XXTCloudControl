package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	lanControlArchiveExt          = ".xxtlca"
	lanControlArchiveManifestPath = ".xxtlca/manifest.json"
	lanControlArchiveMainPath     = "lua/scripts/main.xxt"
	lanControlArchiveConfigPath   = "lua/scripts/main.json"
	lanControlArchiveMaxBytes     = 256 * 1024 * 1024
	lanControlArchiveMaxEntries   = 16
)

var lanControlArchiveAllowedPaths = map[string]bool{
	lanControlArchiveManifestPath: true,
	lanControlArchiveMainPath:     true,
	lanControlArchiveConfigPath:   true,
}

type LanControlArchiveMeta struct {
	Format          string `json:"format"`
	FormatVersion   int    `json:"formatVersion"`
	Name            string `json:"name,omitempty"`
	Version         string `json:"version,omitempty"`
	Author          string `json:"author,omitempty"`
	Description     string `json:"description,omitempty"`
	MinXXTLCVersion string `json:"minXXTLCVersion,omitempty"`
	MaxXXTLCVersion string `json:"maxXXTLCVersion,omitempty"`
}

type lanControlArchiveManifestFile struct {
	Format          string `json:"format"`
	FormatVersion   int    `json:"formatVersion"`
	MinXXTLCVersion string `json:"minXXTLCVersion,omitempty"`
	MaxXXTLCVersion string `json:"maxXXTLCVersion,omitempty"`
}

type lanControlArchiveInspectResult struct {
	Ok          bool                  `json:"ok"`
	Meta        LanControlArchiveMeta `json:"meta"`
	InstallName string                `json:"installName"`
	Exists      bool                  `json:"exists"`
	SourceName  string                `json:"sourceName,omitempty"`
}

type lanControlArchiveInstallResult struct {
	Ok          bool                  `json:"ok"`
	Meta        LanControlArchiveMeta `json:"meta"`
	InstallName string                `json:"installName"`
	ScriptPath  string                `json:"scriptPath"`
	Overwritten bool                  `json:"overwritten"`
}

func lanControlArchiveInspectHandler(c *gin.Context) {
	archivePath, sourceName, cleanup, err := resolveLanControlArchiveRequestSource(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cleanup != nil {
		defer cleanup()
	}

	result, err := inspectLanControlArchivePath(serverConfig.DataDir, archivePath, sourceName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func lanControlArchiveInstallHandler(c *gin.Context) {
	archivePath, sourceName, cleanup, err := resolveLanControlArchiveRequestSource(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cleanup != nil {
		defer cleanup()
	}

	installName := strings.TrimSpace(firstNonEmpty(c.Query("installName"), c.PostForm("installName")))
	overwrite := parseBoolString(firstNonEmpty(c.Query("overwrite"), c.PostForm("overwrite")))
	result, err := installLanControlArchivePath(serverConfig.DataDir, archivePath, sourceName, installName, overwrite)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "already exists") {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func parseBoolString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func isLanControlArchiveFileName(name string) bool {
	return strings.EqualFold(filepath.Ext(strings.TrimSpace(name)), lanControlArchiveExt)
}

func resolveLanControlArchiveRequestSource(c *gin.Context) (archivePath string, sourceName string, cleanup func(), err error) {
	relPath := strings.TrimSpace(c.Query("path"))
	category := strings.TrimSpace(c.Query("category"))
	if relPath != "" {
		if category == "" {
			category = "scripts"
		}
		location, locErr := validatePath(category, relPath)
		if locErr != nil {
			return "", "", nil, locErr
		}
		info, statErr := os.Stat(location)
		if statErr != nil {
			return "", "", nil, statErr
		}
		if info.IsDir() {
			return "", "", nil, fmt.Errorf("LanControl script package must be a file")
		}
		locationName := filepath.Base(location)
		if !isLanControlArchiveFileName(locationName) {
			return "", "", nil, fmt.Errorf("unsupported LanControl script package extension")
		}
		return location, locationName, nil, nil
	}

	fileHeader, formErr := c.FormFile("file")
	if formErr != nil {
		fileHeader, formErr = c.FormFile("archive")
	}
	if formErr != nil {
		return "", "", nil, fmt.Errorf("LanControl script package file is required")
	}
	if !isLanControlArchiveFileName(fileHeader.Filename) {
		return "", "", nil, fmt.Errorf("unsupported LanControl script package extension")
	}
	if fileHeader.Size > lanControlArchiveMaxBytes {
		return "", "", nil, fmt.Errorf("LanControl script package is too large")
	}
	file, openErr := fileHeader.Open()
	if openErr != nil {
		return "", "", nil, openErr
	}
	defer file.Close()

	tmpPath, copyErr := copyLanControlArchiveReaderToTemp(file)
	if copyErr != nil {
		return "", "", nil, copyErr
	}
	return tmpPath, fileHeader.Filename, func() { _ = os.Remove(tmpPath) }, nil
}

func copyLanControlArchiveReaderToTemp(reader io.Reader) (string, error) {
	tmp, err := os.CreateTemp("", "xxtlca-*.xxtlca")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
	}()

	limited := &io.LimitedReader{R: reader, N: lanControlArchiveMaxBytes + 1}
	n, err := io.Copy(tmp, limited)
	if err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if n > lanControlArchiveMaxBytes {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("LanControl script package is too large")
	}
	if err := tmp.Sync(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return tmpPath, nil
}

func inspectLanControlArchivePath(dataDir, archivePath, sourceName string) (lanControlArchiveInspectResult, error) {
	meta, _, err := readLanControlArchive(archivePath)
	if err != nil {
		return lanControlArchiveInspectResult{}, err
	}
	meta = applyLanControlArchiveDisplayFallback(meta, sourceName)
	installName := suggestLanControlArchiveInstallName(meta.Name, sourceName)
	exists := false
	if installName != "" {
		target := filepath.Join(dataDir, "scripts", installName)
		if info, statErr := os.Stat(target); statErr == nil && info != nil {
			exists = true
		}
	}
	return lanControlArchiveInspectResult{
		Ok:          true,
		Meta:        meta,
		InstallName: installName,
		Exists:      exists,
		SourceName:  filepath.Base(sourceName),
	}, nil
}

func installLanControlArchiveFromReader(dataDir, sourceName string, reader io.Reader, installName string, overwrite bool) (lanControlArchiveInstallResult, error) {
	tmpPath, err := copyLanControlArchiveReaderToTemp(reader)
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	defer os.Remove(tmpPath)
	return installLanControlArchivePath(dataDir, tmpPath, sourceName, installName, overwrite)
}

func installLanControlArchivePath(dataDir, archivePath, sourceName, installName string, overwrite bool) (lanControlArchiveInstallResult, error) {
	meta, files, err := readLanControlArchive(archivePath)
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	if strings.TrimSpace(installName) == "" {
		installName = suggestLanControlArchiveInstallName(meta.Name, sourceName)
	}
	installName, err = validateLanControlArchiveInstallName(installName)
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}

	scriptsDir := filepath.Join(dataDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	targetDir := filepath.Join(scriptsDir, installName)
	absScriptsDir, err := filepath.Abs(scriptsDir)
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	absTargetDir, err := filepath.Abs(targetDir)
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	if !isPathWithinAbsBase(absScriptsDir, absTargetDir) {
		return lanControlArchiveInstallResult{}, fmt.Errorf("invalid install name")
	}

	tmpDir, err := os.MkdirTemp(scriptsDir, ".xxtlca-install-*")
	if err != nil {
		return lanControlArchiveInstallResult{}, err
	}
	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			_ = os.RemoveAll(tmpDir)
		}
	}()

	for _, archiveEntry := range []string{lanControlArchiveMainPath, lanControlArchiveConfigPath} {
		data, ok := files[archiveEntry]
		if !ok {
			continue
		}
		if err := writeLanControlArchiveFile(filepath.Join(tmpDir, filepath.FromSlash(archiveEntry)), data); err != nil {
			return lanControlArchiveInstallResult{}, err
		}
	}

	overwritten := false
	var backupDir string
	if _, statErr := os.Stat(targetDir); statErr == nil {
		if !overwrite {
			return lanControlArchiveInstallResult{}, fmt.Errorf("script %q already exists", installName)
		}
		overwritten = true
		backupDir = fmt.Sprintf("%s.bak-%d", targetDir, time.Now().UnixNano())
		if err := os.Rename(targetDir, backupDir); err != nil {
			return lanControlArchiveInstallResult{}, err
		}
	} else if !os.IsNotExist(statErr) {
		return lanControlArchiveInstallResult{}, statErr
	}

	if err := os.Rename(tmpDir, targetDir); err != nil {
		if backupDir != "" {
			_ = restoreFromBackup(targetDir, backupDir)
		}
		return lanControlArchiveInstallResult{}, err
	}
	cleanupTmp = false
	if backupDir != "" {
		_ = os.RemoveAll(backupDir)
	}

	return lanControlArchiveInstallResult{
		Ok:          true,
		Meta:        applyLanControlArchiveDisplayFallback(meta, sourceName),
		InstallName: installName,
		ScriptPath:  filepath.ToSlash(installName),
		Overwritten: overwritten,
	}, nil
}

func readLanControlArchive(archivePath string) (LanControlArchiveMeta, map[string][]byte, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return LanControlArchiveMeta{}, nil, fmt.Errorf("invalid LanControl script package")
	}
	defer reader.Close()

	files := make(map[string][]byte)
	var extractedSize uint64
	fileCount := 0
	for _, file := range reader.File {
		archiveName, err := normalizeLanControlArchiveEntryPath(file.Name)
		if err != nil {
			return LanControlArchiveMeta{}, nil, err
		}
		if archiveName == "" {
			continue
		}
		if file.FileInfo().IsDir() {
			continue
		}
		if file.FileInfo().Mode()&os.ModeSymlink != 0 {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package must not contain symlinks")
		}
		if !lanControlArchiveAllowedPaths[archiveName] {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package contains unsupported file: %s", archiveName)
		}
		if _, exists := files[archiveName]; exists {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package contains duplicate file: %s", archiveName)
		}
		fileCount++
		if fileCount > lanControlArchiveMaxEntries {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package contains too many files")
		}
		extractedSize += file.UncompressedSize64
		if extractedSize > lanControlArchiveMaxBytes {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package is too large")
		}
		data, err := readLanControlArchiveFile(file, lanControlArchiveMaxBytes)
		if err != nil {
			return LanControlArchiveMeta{}, nil, err
		}
		files[archiveName] = data
	}

	var meta LanControlArchiveMeta
	if manifestData, ok := files[lanControlArchiveManifestPath]; ok {
		if len(manifestData) > 64*1024 {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package file is too large: %s", lanControlArchiveManifestPath)
		}
		var manifest lanControlArchiveManifestFile
		if err := json.Unmarshal(manifestData, &manifest); err != nil {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package metadata is invalid")
		}
		meta.Format = strings.TrimSpace(manifest.Format)
		meta.FormatVersion = manifest.FormatVersion
		meta.MinXXTLCVersion = strings.TrimSpace(manifest.MinXXTLCVersion)
		meta.MaxXXTLCVersion = strings.TrimSpace(manifest.MaxXXTLCVersion)
		if !strings.EqualFold(meta.Format, "xxtlca") {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package format is unsupported")
		}
		if meta.FormatVersion != 1 {
			return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package version is unsupported")
		}
		if err := validateLanControlArchiveControllerVersion(meta); err != nil {
			return LanControlArchiveMeta{}, nil, err
		}
	}
	if _, ok := files[lanControlArchiveMainPath]; !ok {
		return LanControlArchiveMeta{}, nil, fmt.Errorf("LanControl script package runtime file is missing")
	}
	meta = applyLanControlArchiveScriptInfo(meta, files)
	return meta, files, nil
}

func validateLanControlArchiveControllerVersion(meta LanControlArchiveMeta) error {
	currentVersion := strings.TrimSpace(Version)
	if currentVersion == "" {
		currentVersion = "dev"
	}
	if meta.MinXXTLCVersion != "" && meta.MaxXXTLCVersion != "" && compareVersionStrings(meta.MinXXTLCVersion, meta.MaxXXTLCVersion) > 0 {
		return fmt.Errorf("LanControl script package controller version range is invalid")
	}
	if meta.MinXXTLCVersion != "" && compareVersionStrings(currentVersion, meta.MinXXTLCVersion) < 0 {
		return fmt.Errorf("LanControl script package requires controller version %s or later (current %s)", meta.MinXXTLCVersion, currentVersion)
	}
	if meta.MaxXXTLCVersion != "" && compareVersionStrings(currentVersion, meta.MaxXXTLCVersion) > 0 {
		return fmt.Errorf("LanControl script package requires controller version %s or earlier (current %s)", meta.MaxXXTLCVersion, currentVersion)
	}
	return nil
}

func applyLanControlArchiveDisplayFallback(meta LanControlArchiveMeta, sourceName string) LanControlArchiveMeta {
	if strings.TrimSpace(meta.Name) == "" {
		meta.Name = suggestLanControlArchiveInstallName("", sourceName)
	}
	return meta
}

func applyLanControlArchiveScriptInfo(meta LanControlArchiveMeta, files map[string][]byte) LanControlArchiveMeta {
	data, ok := files[lanControlArchiveConfigPath]
	if !ok || len(data) == 0 {
		return meta
	}
	var payload struct {
		ScriptInfo map[string]any `json:"ScriptInfo"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return meta
	}
	pick := func(keys ...string) string {
		for _, key := range keys {
			value, ok := payload.ScriptInfo[key]
			if !ok {
				continue
			}
			text, ok := value.(string)
			if !ok {
				continue
			}
			if text = strings.TrimSpace(text); text != "" {
				return text
			}
		}
		return ""
	}
	meta.Name = pick("Name")
	meta.Version = pick("Version")
	meta.Author = pick("Developer", "Author")
	meta.Description = pick("Instructions", "Description")
	return meta
}

func normalizeLanControlArchiveEntryPath(raw string) (string, error) {
	value := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	if value == "" {
		return "", nil
	}
	if strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("LanControl script package contains invalid path: %s", raw)
	}
	clean := path.Clean(value)
	if clean == "." {
		return "", nil
	}
	if strings.HasPrefix(clean, "../") || clean == ".." {
		return "", fmt.Errorf("LanControl script package contains invalid path: %s", raw)
	}
	return clean, nil
}

func readLanControlArchiveFile(file *zip.File, limit int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(limit) {
		return nil, fmt.Errorf("LanControl script package file is too large: %s", file.Name)
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	limited := &io.LimitedReader{R: reader, N: limit + 1}
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("LanControl script package file is too large: %s", file.Name)
	}
	return data, nil
}

func writeLanControlArchiveFile(targetPath string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(targetPath), ".xxtlca-entry-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func suggestLanControlArchiveInstallName(metaName, sourceName string) string {
	candidates := []string{metaName, strings.TrimSuffix(filepath.Base(sourceName), filepath.Ext(sourceName))}
	for _, candidate := range candidates {
		value := strings.TrimSpace(candidate)
		if value == "" {
			continue
		}
		if isLanControlArchiveFileName(value) {
			value = strings.TrimSuffix(value, filepath.Ext(value))
		}
		value = strings.ReplaceAll(value, "\\", "-")
		value = strings.ReplaceAll(value, "/", "-")
		value = strings.Trim(value, " .")
		if value != "" && value != "." && value != ".." && !containsInvalidDirChars(value) {
			return value
		}
	}
	return "lancontrol-script"
}

func validateLanControlArchiveInstallName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if isLanControlArchiveFileName(name) {
		name = strings.TrimSuffix(name, filepath.Ext(name))
	}
	name = strings.Trim(name, " .")
	if name == "" || name == "." || name == ".." {
		return "", fmt.Errorf("invalid install name")
	}
	if strings.ContainsAny(name, `/\`) || containsInvalidDirChars(name) {
		return "", fmt.Errorf("invalid install name")
	}
	return name, nil
}

func containsInvalidDirChars(path string) bool {
	if strings.ContainsRune(path, rune(0)) {
		return true
	}
	for _, r := range path {
		if r < 32 {
			return true
		}
	}
	if runtime.GOOS != "windows" {
		return false
	}
	var prev rune
	for idx, r := range path {
		switch r {
		case '<', '>', '"', '|', '?', '*':
			return true
		case ':':
			if idx != 1 || !((prev >= 'a' && prev <= 'z') || (prev >= 'A' && prev <= 'Z')) {
				return true
			}
		}
		prev = r
	}
	return false
}

func restoreFromBackup(dst, bak string) error {
	if _, err := os.Lstat(bak); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("rollback backup not found: %s", bak)
		}
		return fmt.Errorf("rollback stat backup failed: %w", err)
	}
	if _, err := os.Lstat(dst); err == nil {
		if err := os.RemoveAll(dst); err != nil {
			return fmt.Errorf("rollback cleanup target failed: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("rollback stat target failed: %w", err)
	}
	if err := os.Rename(bak, dst); err != nil {
		return fmt.Errorf("rollback restore backup failed: %w", err)
	}
	return nil
}
