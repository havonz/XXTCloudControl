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
	"net"
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
	Stage              string      `json:"stage"`
	LastError          string      `json:"lastError,omitempty"`
	LastCheckedAt      int64       `json:"lastCheckedAt,omitempty"`
	ManifestURL        string      `json:"manifestUrl,omitempty"`
	LatestVersion      string      `json:"latestVersion,omitempty"`
	LatestPublishedAt  string      `json:"latestPublishedAt,omitempty"`
	HasUpdate          bool        `json:"hasUpdate"`
	Ignored            bool        `json:"ignored"`
	LatestAsset        UpdateAsset `json:"latestAsset,omitempty"`
	DownloadTotalBytes int64       `json:"downloadTotalBytes,omitempty"`
	DownloadedBytes    int64       `json:"downloadedBytes,omitempty"`
	DownloadedVersion  string      `json:"downloadedVersion,omitempty"`
	DownloadedAsset    string      `json:"downloadedAsset,omitempty"`
	DownloadedFile     string      `json:"downloadedFile,omitempty"`
	StagingDir         string      `json:"stagingDir,omitempty"`
	SourceBinary       string      `json:"sourceBinary,omitempty"`
	SourceFrontendDir  string      `json:"sourceFrontendDir,omitempty"`
	AppliedVersion     string      `json:"appliedVersion,omitempty"`
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
	mu             sync.RWMutex
	state          UpdaterState
	httpClient     *http.Client
	downloadCancel context.CancelFunc
	downloadJobID  uint64
	updaterDir     string
	cacheDir       string
	stagingRoot    string
	workerDir      string
	stateFile      string
	execPath       string
	frontendDir    string
	workingDir     string
	restartArgs    []string
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

	connectTimeoutSeconds := serverConfig.Update.Source.DownloadConnectTimeoutSeconds
	if connectTimeoutSeconds <= 0 {
		connectTimeoutSeconds = 60
	}
	connectTimeout := time.Duration(connectTimeoutSeconds) * time.Second
	transport := &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		ForceAttemptHTTP2: true,
	}
	if baseTransport, ok := http.DefaultTransport.(*http.Transport); ok && baseTransport != nil {
		transport = baseTransport.Clone()
	}
	transport.DialContext = (&net.Dialer{
		Timeout:   connectTimeout,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = connectTimeout

	httpClient := &http.Client{
		Transport: transport,
	}

	service := &UpdaterService{
		httpClient:  httpClient,
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
		u.state.DownloadTotalBytes = 0
		u.state.DownloadedBytes = 0
		u.state.AppliedVersion = Version
	}
	if u.state.Stage != updateStageDownloading {
		u.state.DownloadTotalBytes = 0
		u.state.DownloadedBytes = 0
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
	u.state.DownloadTotalBytes = 0
	u.state.DownloadedBytes = 0
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

func (u *UpdaterService) Download() (UpdateStatusResponse, error) {
	if !serverConfig.Update.Enabled {
		return u.Status(), fmt.Errorf("update is disabled")
	}

	u.mu.RLock()
	needCheck := u.state.LatestVersion == "" || u.state.LatestAsset.Name == ""
	u.mu.RUnlock()
	if needCheck {
		checkCtx, cancel := context.WithTimeout(context.Background(), getUpdateCheckTimeout())
		_, err := u.Check(checkCtx)
		cancel()
		if err != nil {
			return u.Status(), err
		}
	}

	u.mu.Lock()
	if u.state.Stage == updateStageDownloading {
		u.mu.Unlock()
		return u.Status(), fmt.Errorf("download already in progress")
	}
	if !u.state.HasUpdate {
		u.mu.Unlock()
		return u.Status(), fmt.Errorf("no update available")
	}
	asset := u.state.LatestAsset
	version := u.state.LatestVersion
	u.state.Stage = updateStageDownloading
	u.state.LastError = ""
	u.state.DownloadTotalBytes = 0
	u.state.DownloadedBytes = 0
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

	downloadCtx, cancel := context.WithCancel(context.Background())
	u.mu.Lock()
	u.downloadJobID++
	jobID := u.downloadJobID
	u.downloadCancel = cancel
	u.mu.Unlock()

	go u.runDownloadJob(jobID, downloadCtx, cancel, asset, version, assetURL)
	return u.Status(), nil
}

func (u *UpdaterService) runDownloadJob(jobID uint64, ctx context.Context, cancel context.CancelFunc, asset UpdateAsset, version string, assetURL string) {
	defer func() {
		cancel()
		u.mu.Lock()
		if u.downloadJobID == jobID {
			u.downloadCancel = nil
		}
		u.mu.Unlock()
	}()

	targetFile := filepath.Join(u.cacheDir, asset.Name)
	if err := u.downloadFile(ctx, assetURL, targetFile, u.updateDownloadProgress); err != nil {
		if errors.Is(err, context.Canceled) {
			_, _ = u.markDownloadError("download canceled")
			return
		}
		_, _ = u.markDownloadError(err.Error())
		return
	}
	if err := verifyFileSHA256(targetFile, asset.SHA256); err != nil {
		_, _ = u.markDownloadError(err.Error())
		return
	}

	stagingDir := filepath.Join(u.stagingRoot, sanitizeVersion(version)+"-"+time.Now().UTC().Format("20060102150405"))
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		_, _ = u.markDownloadError(err.Error())
		return
	}
	if err := unzipSecure(targetFile, stagingDir); err != nil {
		_, _ = u.markDownloadError(err.Error())
		return
	}

	contentRoot := filepath.Join(stagingDir, "XXTCloudControl")
	if fi, err := os.Stat(contentRoot); err != nil || !fi.IsDir() {
		contentRoot = stagingDir
	}
	expectedBinary := releaseBinaryNameForPlatform(runtime.GOOS, runtime.GOARCH)
	sourceBinary := filepath.Join(contentRoot, expectedBinary)
	if fi, err := os.Stat(sourceBinary); err != nil || fi.IsDir() {
		_, _ = u.markDownloadError(fmt.Sprintf("binary not found in package: %s", expectedBinary))
		return
	}
	sourceFrontend := filepath.Join(contentRoot, "frontend")
	if fi, err := os.Stat(sourceFrontend); err != nil || !fi.IsDir() {
		_, _ = u.markDownloadError("frontend directory not found in package")
		return
	}

	if runtime.GOOS == "darwin" {
		if err := removeMacOSQuarantine(stagingDir); err != nil {
			_, _ = u.markDownloadError(err.Error())
			return
		}
	}

	u.mu.Lock()
	u.state.Stage = updateStageDownloaded
	u.state.LastError = ""
	u.state.DownloadTotalBytes = u.state.DownloadedBytes
	u.state.DownloadedVersion = version
	u.state.DownloadedAsset = asset.Name
	u.state.DownloadedFile = targetFile
	u.state.StagingDir = stagingDir
	u.state.SourceBinary = sourceBinary
	u.state.SourceFrontendDir = sourceFrontend
	if err := u.saveStateLocked(); err != nil {
		u.state.Stage = updateStageFailed
		u.state.LastError = err.Error()
		_ = u.saveStateLocked()
	}
	u.mu.Unlock()
}

func (u *UpdaterService) CancelDownload() (UpdateStatusResponse, error) {
	u.mu.RLock()
	cancel := u.downloadCancel
	stage := u.state.Stage
	u.mu.RUnlock()
	if stage != updateStageDownloading || cancel == nil {
		return u.Status(), fmt.Errorf("no active download")
	}
	cancel()
	return u.Status(), nil
}

func (u *UpdaterService) updateDownloadProgress(downloadedBytes int64, totalBytes int64) {
	if downloadedBytes < 0 {
		downloadedBytes = 0
	}
	if totalBytes < 0 {
		totalBytes = 0
	}
	u.mu.Lock()
	if u.state.Stage == updateStageDownloading {
		u.state.DownloadedBytes = downloadedBytes
		u.state.DownloadTotalBytes = totalBytes
	}
	u.mu.Unlock()
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

	if isDockerRuntime() {
		go u.applyInDocker(job)
		return u.Status(), nil
	}

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

func (u *UpdaterService) applyInDocker(job updateWorkerJob) {
	// Let HTTP handler flush response before replacing/executing current binary.
	time.Sleep(300 * time.Millisecond)

	if err := validateDownloadedBinaryForExec(job.SourceBinary, job.TargetVersion); err != nil {
		_, _ = u.markApplyError(err)
		return
	}
	if err := applyUpdateReplacement(job); err != nil {
		if isPermissionOrReadonlyError(err) {
			err = fmt.Errorf("docker 文件系统不可写，请拉取新镜像并重建容器完成更新: %w", err)
		}
		_, _ = u.markApplyError(err)
		return
	}
	if err := execUpdatedBinary(job.TargetBinary, job.RestartArgs, job.WorkingDir); err != nil {
		rollbackFromBackup(job)
		_, _ = u.markApplyError(err)
		return
	}
}

func validateDownloadedBinaryForExec(binaryPath string, expectedVersion string) error {
	info, err := os.Stat(binaryPath)
	if err != nil {
		return fmt.Errorf("downloaded binary not found: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("downloaded binary is a directory: %s", binaryPath)
	}

	if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
		if err := os.Chmod(binaryPath, 0755); err != nil {
			return fmt.Errorf("downloaded binary is not executable: %w", err)
		}
	}

	detectedVersion, err := probeBinaryVersion(binaryPath)
	if err != nil {
		return err
	}

	expectedVersion = strings.TrimSpace(expectedVersion)
	if expectedVersion != "" && compareVersionStrings(detectedVersion, expectedVersion) != 0 {
		return fmt.Errorf("downloaded binary version mismatch: got %s, expected %s", detectedVersion, expectedVersion)
	}
	if compareVersionStrings(detectedVersion, Version) <= 0 {
		return fmt.Errorf("downloaded binary (%s) is not newer than current version (%s)", detectedVersion, Version)
	}
	return nil
}

func probeBinaryVersion(binaryPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, binaryPath, "-v")
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("version probe timed out for %s", filepath.Base(binaryPath))
	}
	trimmed := strings.TrimSpace(string(output))
	if err != nil {
		if trimmed == "" {
			trimmed = err.Error()
		}
		return "", fmt.Errorf("version probe failed: %s", trimmed)
	}
	if trimmed == "" {
		return "", fmt.Errorf("version probe returned empty output")
	}
	line := strings.TrimSpace(strings.Split(trimmed, "\n")[0])
	if line == "" {
		return "", fmt.Errorf("version probe returned empty first line")
	}
	if !strings.HasPrefix(strings.ToLower(line), "v") {
		line = "v" + line
	}
	return line, nil
}

func execUpdatedBinary(binaryPath string, args []string, workingDir string) error {
	if strings.TrimSpace(binaryPath) == "" {
		return fmt.Errorf("binary path is empty")
	}
	if workingDir != "" {
		if err := os.Chdir(workingDir); err != nil {
			return fmt.Errorf("failed to switch working directory: %w", err)
		}
	}
	argv := append([]string{binaryPath}, args...)
	if err := execReplaceProcess(binaryPath, argv, os.Environ()); err != nil {
		return fmt.Errorf("failed to exec updated binary: %w", err)
	}
	return nil
}

func isPermissionOrReadonlyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrPermission) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") || strings.Contains(msg, "read-only file system")
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

func (u *UpdaterService) downloadFile(ctx context.Context, url string, target string, onProgress func(downloadedBytes int64, totalBytes int64)) error {
	tempFile := target + ".part"
	_ = os.Remove(tempFile)
	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = os.Remove(tempFile)
		}
	}()

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
	totalBytes := resp.ContentLength
	if totalBytes < 0 {
		totalBytes = 0
	}
	if onProgress != nil {
		onProgress(0, totalBytes)
	}

	out, err := os.OpenFile(tempFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	buf := make([]byte, 128*1024)
	var downloadedBytes int64
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := out.Write(buf[:n]); err != nil {
				out.Close()
				return err
			}
			downloadedBytes += int64(n)
			if onProgress != nil {
				onProgress(downloadedBytes, totalBytes)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return readErr
		}
	}
	if err := out.Close(); err != nil {
		return err
	}
	cleanupTemp = false
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

func getUpdateCheckTimeout() time.Duration {
	timeoutSeconds := serverConfig.Update.Source.RequestTimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 60
	}
	return time.Duration(timeoutSeconds) * time.Second
}

func isDockerRuntime() bool {
	runtimeFlag := strings.TrimSpace(os.Getenv("XXTCC_RUNTIME"))
	if strings.EqualFold(runtimeFlag, "docker") {
		return true
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	cgroupData, err := os.ReadFile("/proc/1/cgroup")
	if err != nil {
		return false
	}
	content := string(cgroupData)
	return strings.Contains(content, "docker") ||
		strings.Contains(content, "containerd") ||
		strings.Contains(content, "kubepods")
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
