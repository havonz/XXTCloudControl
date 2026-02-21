package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	updateStageIdle        = "idle"
	updateStageChecking    = "checking"
	updateStageAvailable   = "update_available"
	updateStageDownloading = "downloading"
	updateStageDownloaded  = "downloaded"
	updateStageApplying    = "applying"
	updateStageFailed      = "failed"
)

// UpdateAsset describes a single update artifact in update-manifest.json.
type UpdateAsset struct {
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	LatestURL string `json:"latestUrl"`
	SHA256    string `json:"sha256"`
}

// UpdateManifest describes the release metadata used by updater.
type UpdateManifest struct {
	Version      string        `json:"version"`
	Channel      string        `json:"channel"`
	BuildTime    string        `json:"buildTime"`
	Commit       string        `json:"commit"`
	PublishedAt  string        `json:"publishedAt"`
	ChecksumsURL string        `json:"checksumsUrl"`
	Assets       []UpdateAsset `json:"assets"`
}

// UpdaterState is persisted in data/updater/state.json.
type UpdaterState struct {
	Stage             string      `json:"stage"`
	LastError         string      `json:"lastError,omitempty"`
	LastCheckedAt     int64       `json:"lastCheckedAt,omitempty"`
	ManifestURL       string      `json:"manifestUrl,omitempty"`
	LatestVersion     string      `json:"latestVersion,omitempty"`
	LatestPublishedAt string      `json:"latestPublishedAt,omitempty"`
	HasUpdate         bool        `json:"hasUpdate"`
	Ignored           bool        `json:"ignored"`
	LatestAsset       UpdateAsset `json:"latestAsset,omitempty"`
	DownloadedVersion string      `json:"downloadedVersion,omitempty"`
	DownloadedAsset   string      `json:"downloadedAsset,omitempty"`
	DownloadedFile    string      `json:"downloadedFile,omitempty"`
	StagingDir        string      `json:"stagingDir,omitempty"`
	SourceBinary      string      `json:"sourceBinary,omitempty"`
	SourceFrontendDir string      `json:"sourceFrontendDir,omitempty"`
	AppliedVersion    string      `json:"appliedVersion,omitempty"`
}

// UpdateStatusResponse is returned by updater APIs.
type UpdateStatusResponse struct {
	CurrentVersion string       `json:"currentVersion"`
	BuildTime      string       `json:"buildTime"`
	Commit         string       `json:"commit"`
	PlatformOS     string       `json:"platformOS"`
	PlatformArch   string       `json:"platformArch"`
	Config         UpdateConfig `json:"config"`
	State          UpdaterState `json:"state"`
}

type UpdaterService struct {
	mu          sync.RWMutex
	state       UpdaterState
	httpClient  *http.Client
	updaterDir  string
	cacheDir    string
	stagingRoot string
	workerDir   string
	stateFile   string
	execPath    string
	frontendDir string
	workingDir  string
	restartArgs []string
}

var updaterService *UpdaterService

func initUpdaterService() error {
	service, err := newUpdaterService()
	if err != nil {
		return err
	}
	updaterService = service
	return nil
}

func newUpdaterService() (*UpdaterService, error) {
	execPath, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if resolved, err := filepath.EvalSymlinks(execPath); err == nil {
		execPath = resolved
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	dataDir := serverConfig.DataDir
	if !filepath.IsAbs(dataDir) {
		dataDir = filepath.Join(workingDir, dataDir)
	}
	frontendDir := serverConfig.FrontendDir
	if !filepath.IsAbs(frontendDir) {
		frontendDir = filepath.Join(workingDir, frontendDir)
	}

	timeout := serverConfig.Update.Source.RequestTimeoutSeconds
	if timeout <= 0 {
		timeout = 15
	}

	service := &UpdaterService{
		httpClient: &http.Client{
			Timeout: time.Duration(timeout) * time.Second,
		},
		updaterDir:  filepath.Join(dataDir, "updater"),
		cacheDir:    filepath.Join(dataDir, "updater", "cache"),
		stagingRoot: filepath.Join(dataDir, "updater", "staging"),
		workerDir:   filepath.Join(dataDir, "updater", "worker"),
		stateFile:   filepath.Join(dataDir, "updater", "state.json"),
		execPath:    execPath,
		frontendDir: frontendDir,
		workingDir:  workingDir,
		restartArgs: append([]string(nil), os.Args[1:]...),
		state: UpdaterState{
			Stage: updateStageIdle,
		},
	}

	if err := service.ensureDirs(); err != nil {
		return nil, err
	}
	if err := service.loadState(); err != nil {
		return nil, err
	}
	service.reconcileStateOnStartup()
	if err := service.saveState(); err != nil {
		return nil, err
	}
	return service, nil
}

func (u *UpdaterService) ensureDirs() error {
	for _, dir := range []string{u.updaterDir, u.cacheDir, u.stagingRoot, u.workerDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	return nil
}

func (u *UpdaterService) loadState() error {
	state, err := readUpdaterStateFile(u.stateFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if state.Stage == "" {
		state.Stage = updateStageIdle
	}
	u.state = state
	return nil
}

func (u *UpdaterService) saveState() error {
	u.mu.RLock()
	state := u.state
	u.mu.RUnlock()
	return writeUpdaterStateFile(u.stateFile, state)
}

func (u *UpdaterService) saveStateLocked() error {
	return writeUpdaterStateFile(u.stateFile, u.state)
}

func (u *UpdaterService) reconcileStateOnStartup() {
	if u.state.Stage == "" {
		u.state.Stage = updateStageIdle
	}
	if u.state.Stage == updateStageApplying && u.state.DownloadedVersion == Version {
		u.state.Stage = updateStageIdle
		u.state.LastError = ""
		u.state.HasUpdate = false
		u.state.Ignored = false
		u.state.AppliedVersion = Version
	}
	if u.state.StagingDir != "" {
		if _, err := os.Stat(u.state.StagingDir); err != nil {
			u.state.StagingDir = ""
			u.state.SourceBinary = ""
			u.state.SourceFrontendDir = ""
		}
	}
}

func readUpdaterStateFile(path string) (UpdaterState, error) {
	var state UpdaterState
	data, err := os.ReadFile(path)
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, err
	}
	return state, nil
}

func writeUpdaterStateFile(path string, state UpdaterState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (u *UpdaterService) Status() UpdateStatusResponse {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return UpdateStatusResponse{
		CurrentVersion: Version,
		BuildTime:      BuildTime,
		Commit:         Commit,
		PlatformOS:     runtime.GOOS,
		PlatformArch:   runtime.GOARCH,
		Config:         serverConfig.Update,
		State:          u.state,
	}
}

func (u *UpdaterService) Check(ctx context.Context) (UpdateStatusResponse, error) {
	if !serverConfig.Update.Enabled {
		return u.Status(), fmt.Errorf("update is disabled")
	}

	manifestURL := resolveManifestURL(serverConfig.Update.Source)
	u.mu.Lock()
	u.state.Stage = updateStageChecking
	u.state.LastError = ""
	u.state.ManifestURL = manifestURL
	if err := u.saveStateLocked(); err != nil {
		u.mu.Unlock()
		return u.Status(), err
	}
	u.mu.Unlock()

	manifest, err := u.fetchManifest(ctx, manifestURL)
	nowUnix := time.Now().Unix()
	if err != nil {
		u.mu.Lock()
		u.state.Stage = updateStageFailed
		u.state.LastError = err.Error()
		u.state.LastCheckedAt = nowUnix
		_ = u.saveStateLocked()
		u.mu.Unlock()
		return u.Status(), err
	}

	asset, err := selectManifestAsset(manifest.Assets, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		u.mu.Lock()
		u.state.Stage = updateStageFailed
		u.state.LastError = err.Error()
		u.state.LastCheckedAt = nowUnix
		_ = u.saveStateLocked()
		u.mu.Unlock()
		return u.Status(), err
	}

	cmp := compareVersionStrings(manifest.Version, Version)
	ignored := isIgnoredVersion(serverConfig.Update.IgnoredVersions, manifest.Version)
	hasUpdate := cmp > 0 && !ignored

	u.mu.Lock()
	u.state.LastCheckedAt = nowUnix
	u.state.LastError = ""
	u.state.LatestVersion = manifest.Version
	u.state.LatestPublishedAt = manifest.PublishedAt
	u.state.LatestAsset = asset
	u.state.HasUpdate = hasUpdate
	u.state.Ignored = ignored
	if hasUpdate {
		u.state.Stage = updateStageAvailable
	} else {
		u.state.Stage = updateStageIdle
	}
	if err := u.saveStateLocked(); err != nil {
		u.mu.Unlock()
		return u.Status(), err
	}
	u.mu.Unlock()

	return u.Status(), nil
}

func (u *UpdaterService) Download(ctx context.Context) (UpdateStatusResponse, error) {
	if !serverConfig.Update.Enabled {
		return u.Status(), fmt.Errorf("update is disabled")
	}

	u.mu.RLock()
	needCheck := u.state.LatestVersion == "" || u.state.LatestAsset.Name == ""
	u.mu.RUnlock()
	if needCheck {
		if _, err := u.Check(ctx); err != nil {
			return u.Status(), err
		}
	}

	u.mu.Lock()
	if !u.state.HasUpdate {
		u.mu.Unlock()
		return u.Status(), fmt.Errorf("no update available")
	}
	asset := u.state.LatestAsset
	version := u.state.LatestVersion
	u.state.Stage = updateStageDownloading
	u.state.LastError = ""
	if err := u.saveStateLocked(); err != nil {
		u.mu.Unlock()
		return u.Status(), err
	}
	u.mu.Unlock()

	if asset.Name == "" {
		return u.markDownloadError("missing asset name")
	}
	assetURL := strings.TrimSpace(asset.URL)
	if assetURL == "" {
		assetURL = strings.TrimSpace(asset.LatestURL)
	}
	if assetURL == "" {
		return u.markDownloadError("missing asset download url")
	}

	targetFile := filepath.Join(u.cacheDir, asset.Name)
	if err := u.downloadFile(ctx, assetURL, targetFile); err != nil {
		return u.markDownloadError(err.Error())
	}
	if err := verifyFileSHA256(targetFile, asset.SHA256); err != nil {
		return u.markDownloadError(err.Error())
	}

	stagingDir := filepath.Join(u.stagingRoot, sanitizeVersion(version)+"-"+time.Now().UTC().Format("20060102150405"))
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		return u.markDownloadError(err.Error())
	}
	if err := unzipSecure(targetFile, stagingDir); err != nil {
		return u.markDownloadError(err.Error())
	}

	contentRoot := filepath.Join(stagingDir, "XXTCloudControl")
	if fi, err := os.Stat(contentRoot); err != nil || !fi.IsDir() {
		contentRoot = stagingDir
	}
	expectedBinary := releaseBinaryNameForPlatform(runtime.GOOS, runtime.GOARCH)
	sourceBinary := filepath.Join(contentRoot, expectedBinary)
	if fi, err := os.Stat(sourceBinary); err != nil || fi.IsDir() {
		return u.markDownloadError(fmt.Sprintf("binary not found in package: %s", expectedBinary))
	}
	sourceFrontend := filepath.Join(contentRoot, "frontend")
	if fi, err := os.Stat(sourceFrontend); err != nil || !fi.IsDir() {
		return u.markDownloadError("frontend directory not found in package")
	}

	if runtime.GOOS == "darwin" {
		if err := removeMacOSQuarantine(stagingDir); err != nil {
			return u.markDownloadError(err.Error())
		}
	}

	u.mu.Lock()
	u.state.Stage = updateStageDownloaded
	u.state.LastError = ""
	u.state.DownloadedVersion = version
	u.state.DownloadedAsset = asset.Name
	u.state.DownloadedFile = targetFile
	u.state.StagingDir = stagingDir
	u.state.SourceBinary = sourceBinary
	u.state.SourceFrontendDir = sourceFrontend
	if err := u.saveStateLocked(); err != nil {
		u.mu.Unlock()
		return u.Status(), err
	}
	u.mu.Unlock()
	return u.Status(), nil
}

func (u *UpdaterService) markDownloadError(message string) (UpdateStatusResponse, error) {
	u.mu.Lock()
	u.state.Stage = updateStageFailed
	u.state.LastError = message
	_ = u.saveStateLocked()
	u.mu.Unlock()
	return u.Status(), errors.New(message)
}

func (u *UpdaterService) Apply() (UpdateStatusResponse, error) {
	if !serverConfig.Update.Enabled {
		return u.Status(), fmt.Errorf("update is disabled")
	}

	u.mu.Lock()
	if u.state.Stage != updateStageDownloaded {
		u.mu.Unlock()
		return u.Status(), fmt.Errorf("no downloaded update to apply")
	}
	job := updateWorkerJob{
		ParentPID:         os.Getpid(),
		StateFile:         u.stateFile,
		SourceBinary:      u.state.SourceBinary,
		SourceFrontendDir: u.state.SourceFrontendDir,
		StagingDir:        u.state.StagingDir,
		TargetBinary:      u.execPath,
		TargetFrontendDir: u.frontendDir,
		BackupBinary:      u.execPath + ".bak",
		BackupFrontendDir: u.frontendDir + ".bak",
		WorkingDir:        u.workingDir,
		RestartArgs:       append([]string(nil), u.restartArgs...),
		TargetVersion:     u.state.DownloadedVersion,
	}
	u.state.Stage = updateStageApplying
	u.state.LastError = ""
	if err := u.saveStateLocked(); err != nil {
		u.mu.Unlock()
		return u.Status(), err
	}
	u.mu.Unlock()

	helperName := "update-helper-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if runtime.GOOS == "windows" {
		helperName += ".exe"
	}
	helperPath := filepath.Join(u.workerDir, helperName)
	if err := copyFile(u.execPath, helperPath); err != nil {
		return u.markApplyError(err)
	}

	jobPath := filepath.Join(u.workerDir, "job-"+strconv.FormatInt(time.Now().UnixNano(), 10)+".json")
	jobData, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return u.markApplyError(err)
	}
	if err := os.WriteFile(jobPath, jobData, 0644); err != nil {
		return u.markApplyError(err)
	}

	cmd := exec.Command(helperPath, "-update-worker", jobPath)
	cmd.Dir = u.workingDir
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return u.markApplyError(err)
	}

	go func() {
		time.Sleep(1200 * time.Millisecond)
		os.Exit(0)
	}()

	return u.Status(), nil
}

func (u *UpdaterService) markApplyError(err error) (UpdateStatusResponse, error) {
	u.mu.Lock()
	u.state.Stage = updateStageFailed
	u.state.LastError = err.Error()
	_ = u.saveStateLocked()
	u.mu.Unlock()
	return u.Status(), err
}

func (u *UpdaterService) fetchManifest(ctx context.Context, manifestURL string) (UpdateManifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return UpdateManifest{}, err
	}
	req.Header.Set("User-Agent", "XXTCloudControl-Updater/"+Version)

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return UpdateManifest{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return UpdateManifest{}, fmt.Errorf("manifest request failed: %s", resp.Status)
	}
	var manifest UpdateManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return UpdateManifest{}, err
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return UpdateManifest{}, fmt.Errorf("manifest missing version")
	}
	if len(manifest.Assets) == 0 {
		return UpdateManifest{}, fmt.Errorf("manifest has no assets")
	}
	return manifest, nil
}

func (u *UpdaterService) downloadFile(ctx context.Context, url string, target string) error {
	tempFile := target + ".part"
	_ = os.Remove(tempFile)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "XXTCloudControl-Updater/"+Version)

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	out, err := os.OpenFile(tempFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tempFile, target)
}

func verifyFileSHA256(path string, expected string) error {
	expected = strings.TrimSpace(strings.ToLower(expected))
	if expected == "" {
		return nil
	}

	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != expected {
		return fmt.Errorf("checksum mismatch for %s", filepath.Base(path))
	}
	return nil
}

func unzipSecure(zipPath string, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	destClean := filepath.Clean(destDir)
	destPrefix := destClean + string(os.PathSeparator)
	for _, f := range r.File {
		filePath := filepath.Join(destClean, f.Name)
		cleanPath := filepath.Clean(filePath)
		if cleanPath != destClean && !strings.HasPrefix(cleanPath, destPrefix) {
			return fmt.Errorf("illegal zip entry path: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanPath, f.Mode()); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(cleanPath), 0755); err != nil {
			return err
		}
		in, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(cleanPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
		if err != nil {
			in.Close()
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			in.Close()
			return err
		}
		if err := out.Close(); err != nil {
			in.Close()
			return err
		}
		if err := in.Close(); err != nil {
			return err
		}
	}
	return nil
}

func releaseBinaryNameForPlatform(goos, goarch string) string {
	name := fmt.Sprintf("xxtcloudserver-%s-%s", goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

func resolveManifestURL(source UpdateSourceConfig) string {
	manifestURL := strings.TrimSpace(source.ManifestURL)
	if manifestURL != "" {
		return manifestURL
	}
	repo := strings.TrimSpace(source.Repository)
	if repo == "" {
		repo = "havonz/XXTCloudControl"
	}
	return "https://github.com/" + repo + "/releases/latest/download/update-manifest.json"
}

func selectManifestAsset(assets []UpdateAsset, goos, goarch string) (UpdateAsset, error) {
	for _, asset := range assets {
		if asset.OS == goos && asset.Arch == goarch {
			return asset, nil
		}
	}
	return UpdateAsset{}, fmt.Errorf("no update asset for %s/%s", goos, goarch)
}

func sanitizeVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	return replacer.Replace(version)
}

func isIgnoredVersion(ignored []string, version string) bool {
	version = strings.TrimSpace(version)
	for _, v := range ignored {
		if strings.TrimSpace(v) == version {
			return true
		}
	}
	return false
}

func compareVersionStrings(a, b string) int {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == b {
		return 0
	}
	if a == "" || a == "dev" || a == "unknown" {
		return -1
	}
	if b == "" || b == "dev" || b == "unknown" {
		return 1
	}

	ta := normalizeVersionTag(a)
	tb := normalizeVersionTag(b)

	if ia, ok := parseNumericVersion(ta); ok {
		if ib, ok := parseNumericVersion(tb); ok {
			if ia < ib {
				return -1
			}
			if ia > ib {
				return 1
			}
			return 0
		}
	}

	sa, okA := parseSemverLike(ta)
	sb, okB := parseSemverLike(tb)
	if okA && okB {
		return compareSemverLike(sa, sb)
	}

	if ta < tb {
		return -1
	}
	return 1
}

func normalizeVersionTag(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	v = strings.TrimPrefix(v, "v")
	return v
}

func parseNumericVersion(v string) (int64, bool) {
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			return 0, false
		}
	}
	num, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return num, true
}

type semverLike struct {
	major int64
	minor int64
	patch int64
	pre   string
}

func parseSemverLike(v string) (semverLike, bool) {
	main := v
	pre := ""
	if idx := strings.Index(v, "-"); idx >= 0 {
		main = v[:idx]
		pre = v[idx+1:]
	}
	parts := strings.Split(main, ".")
	if len(parts) != 3 {
		return semverLike{}, false
	}
	major, err1 := strconv.ParseInt(parts[0], 10, 64)
	minor, err2 := strconv.ParseInt(parts[1], 10, 64)
	patch, err3 := strconv.ParseInt(parts[2], 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return semverLike{}, false
	}
	return semverLike{
		major: major,
		minor: minor,
		patch: patch,
		pre:   pre,
	}, true
}

func compareSemverLike(a, b semverLike) int {
	if a.major != b.major {
		if a.major < b.major {
			return -1
		}
		return 1
	}
	if a.minor != b.minor {
		if a.minor < b.minor {
			return -1
		}
		return 1
	}
	if a.patch != b.patch {
		if a.patch < b.patch {
			return -1
		}
		return 1
	}
	if a.pre == b.pre {
		return 0
	}
	if a.pre == "" && b.pre != "" {
		return 1
	}
	if a.pre != "" && b.pre == "" {
		return -1
	}
	if a.pre < b.pre {
		return -1
	}
	return 1
}

func removeMacOSQuarantine(path string) error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	cmdPath, err := exec.LookPath("xattr")
	if err != nil {
		return fmt.Errorf("xattr command not found: %w", err)
	}
	cmd := exec.Command(cmdPath, "-dr", "com.apple.quarantine", path)
	if output, err := cmd.CombinedOutput(); err != nil {
		text := strings.TrimSpace(string(output))
		if text == "" {
			text = err.Error()
		}
		return fmt.Errorf("failed to clear macOS quarantine: %s", text)
	}
	return nil
}
