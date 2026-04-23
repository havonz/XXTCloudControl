package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCompareVersionStrings(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{name: "timestamp newer", a: "v202602210930", b: "v202602210800", want: 1},
		{name: "timestamp older", a: "v202602210700", b: "v202602210800", want: -1},
		{name: "equal", a: "v202602210800", b: "v202602210800", want: 0},
		{name: "semver", a: "v1.2.0", b: "v1.1.9", want: 1},
		{name: "prerelease lower", a: "v1.2.0-beta.1", b: "v1.2.0", want: -1},
		{name: "dev lower", a: "dev", b: "v202602210800", want: -1},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := compareVersionStrings(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("compareVersionStrings(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestSelectManifestAsset(t *testing.T) {
	assets := []UpdateAsset{
		{OS: "linux", Arch: "amd64", Name: "linux-amd64.zip"},
		{OS: "darwin", Arch: "arm64", Name: "darwin-arm64.zip"},
	}
	asset, err := selectManifestAsset(assets, "darwin", "arm64")
	if err != nil {
		t.Fatalf("selectManifestAsset returned error: %v", err)
	}
	if asset.Name != "darwin-arm64.zip" {
		t.Fatalf("unexpected asset: %+v", asset)
	}
}

func TestResolveManifestURLsPriority(t *testing.T) {
	originalDefaults := DefaultUpdateManifestURLsCSV
	DefaultUpdateManifestURLsCSV = "https://r2.example.com/releases/latest/download/update-manifest.json, https://github.com/org/repo/releases/latest/download/update-manifest.json"
	defer func() {
		DefaultUpdateManifestURLsCSV = originalDefaults
	}()

	got := resolveManifestURLs(UpdateSourceConfig{
		ManifestURLs: []string{
			"https://priority-1.example.com/update-manifest.json",
			"https://priority-2.example.com/update-manifest.json",
		},
		ManifestURL: "https://single.example.com/update-manifest.json",
		Repository:  "custom/repo",
	})
	want := []string{
		"https://priority-1.example.com/update-manifest.json",
		"https://priority-2.example.com/update-manifest.json",
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("resolveManifestURLs preferred unexpected urls: %#v", got)
	}

	got = resolveManifestURLs(UpdateSourceConfig{
		ManifestURL: "https://single.example.com/update-manifest.json",
		Repository:  "custom/repo",
	})
	if len(got) != 1 || got[0] != "https://single.example.com/update-manifest.json" {
		t.Fatalf("resolveManifestURLs should prefer single manifestUrl, got %#v", got)
	}

	got = resolveManifestURLs(UpdateSourceConfig{Repository: "custom/repo"})
	want = []string{
		"https://r2.example.com/releases/latest/download/update-manifest.json",
		"https://github.com/org/repo/releases/latest/download/update-manifest.json",
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("resolveManifestURLs should use injected defaults, got %#v", got)
	}

	DefaultUpdateManifestURLsCSV = ""
	got = resolveManifestURLs(UpdateSourceConfig{Repository: "custom/repo"})
	if len(got) != 1 || got[0] != "https://github.com/custom/repo/releases/latest/download/update-manifest.json" {
		t.Fatalf("resolveManifestURLs should fall back to repository, got %#v", got)
	}
}

func TestSelectBestManifestCandidateFallsBackToGitHub(t *testing.T) {
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/r2/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "r2 unavailable", http.StatusBadGateway)
	})
	mux.HandleFunc("/github/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testManifestJSON("v202602211930", server.URL+"/github/pkg.zip", "")))
	})

	u := &UpdaterService{httpClient: server.Client()}
	candidate, err := u.selectBestManifestCandidate(context.Background(), []string{
		server.URL + "/r2/update-manifest.json",
		server.URL + "/github/update-manifest.json",
	})
	if err != nil {
		t.Fatalf("selectBestManifestCandidate failed: %v", err)
	}
	if candidate.manifestURL != server.URL+"/github/update-manifest.json" {
		t.Fatalf("unexpected manifest source: %s", candidate.manifestURL)
	}
	if candidate.manifest.Version != "v202602211930" {
		t.Fatalf("unexpected manifest version: %s", candidate.manifest.Version)
	}
}

func TestSelectBestManifestCandidateUsesHigherVersion(t *testing.T) {
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/r2/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testManifestJSON("v202602211900", server.URL+"/r2/pkg.zip", "")))
	})
	mux.HandleFunc("/github/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testManifestJSON("v202602211930", server.URL+"/github/pkg.zip", "")))
	})

	u := &UpdaterService{httpClient: server.Client()}
	candidate, err := u.selectBestManifestCandidate(context.Background(), []string{
		server.URL + "/r2/update-manifest.json",
		server.URL + "/github/update-manifest.json",
	})
	if err != nil {
		t.Fatalf("selectBestManifestCandidate failed: %v", err)
	}
	if candidate.manifestURL != server.URL+"/github/update-manifest.json" {
		t.Fatalf("higher version should win, got source %s", candidate.manifestURL)
	}
}

func TestSelectBestManifestCandidateReturnsAggregateError(t *testing.T) {
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/r2/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "r2 unavailable", http.StatusBadGateway)
	})
	mux.HandleFunc("/github/update-manifest.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"","assets":[]}`))
	})

	u := &UpdaterService{httpClient: server.Client()}
	_, err := u.selectBestManifestCandidate(context.Background(), []string{
		server.URL + "/r2/update-manifest.json",
		server.URL + "/github/update-manifest.json",
	})
	if err == nil {
		t.Fatalf("expected aggregate manifest error")
	}
	if !strings.Contains(err.Error(), server.URL+"/r2/update-manifest.json") || !strings.Contains(err.Error(), server.URL+"/github/update-manifest.json") {
		t.Fatalf("aggregate error should include failed sources, got: %v", err)
	}
}

func TestDownloadAssetWithFallbackURL(t *testing.T) {
	goodPayload := []byte("release-payload")
	goodSHA := sha256.Sum256(goodPayload)

	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/primary/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	mux.HandleFunc("/fallback/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(goodPayload)
	})

	u := &UpdaterService{httpClient: server.Client()}
	target := filepath.Join(t.TempDir(), "pkg.zip")
	err := u.downloadAssetWithFallback(context.Background(), UpdateAsset{
		Name:        "pkg.zip",
		URL:         server.URL + "/primary/pkg.zip",
		FallbackURL: server.URL + "/fallback/pkg.zip",
		SHA256:      hex.EncodeToString(goodSHA[:]),
	}, target)
	if err != nil {
		t.Fatalf("downloadAssetWithFallback failed: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read downloaded file failed: %v", err)
	}
	if !bytes.Equal(got, goodPayload) {
		t.Fatalf("unexpected downloaded payload: %q", string(got))
	}
}

func TestDownloadAssetWithFallbackAfterChecksumFailure(t *testing.T) {
	badPayload := []byte("corrupted")
	goodPayload := []byte("release-payload")
	goodSHA := sha256.Sum256(goodPayload)

	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/primary/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(badPayload)
	})
	mux.HandleFunc("/fallback/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(goodPayload)
	})

	u := &UpdaterService{httpClient: server.Client()}
	target := filepath.Join(t.TempDir(), "pkg.zip")
	err := u.downloadAssetWithFallback(context.Background(), UpdateAsset{
		Name:        "pkg.zip",
		URL:         server.URL + "/primary/pkg.zip",
		FallbackURL: server.URL + "/fallback/pkg.zip",
		SHA256:      hex.EncodeToString(goodSHA[:]),
	}, target)
	if err != nil {
		t.Fatalf("downloadAssetWithFallback failed: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read downloaded file failed: %v", err)
	}
	if !bytes.Equal(got, goodPayload) {
		t.Fatalf("unexpected downloaded payload after checksum fallback: %q", string(got))
	}
}

func TestDownloadAssetWithFallbackReturnsAggregateError(t *testing.T) {
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	defer server.Close()

	mux.HandleFunc("/primary/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "missing", http.StatusNotFound)
	})
	mux.HandleFunc("/fallback/pkg.zip", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})

	u := &UpdaterService{httpClient: server.Client()}
	target := filepath.Join(t.TempDir(), "pkg.zip")
	err := u.downloadAssetWithFallback(context.Background(), UpdateAsset{
		Name:        "pkg.zip",
		URL:         server.URL + "/primary/pkg.zip",
		FallbackURL: server.URL + "/fallback/pkg.zip",
	}, target)
	if err == nil {
		t.Fatalf("expected aggregate download error")
	}
	if !strings.Contains(err.Error(), server.URL+"/primary/pkg.zip") || !strings.Contains(err.Error(), server.URL+"/fallback/pkg.zip") {
		t.Fatalf("aggregate download error should include attempted urls, got: %v", err)
	}
}

func TestVerifyFileSHA256Mismatch(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "payload.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write payload failed: %v", err)
	}
	sum := sha256.Sum256([]byte("world"))
	expected := hex.EncodeToString(sum[:])
	if err := verifyFileSHA256(filePath, expected); err == nil {
		t.Fatalf("expected checksum mismatch error")
	}
}

func TestUnzipSecureRejectsPathTraversal(t *testing.T) {
	tempDir := t.TempDir()
	zipPath := filepath.Join(tempDir, "bad.zip")
	outZip, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("create zip failed: %v", err)
	}
	zw := zip.NewWriter(outZip)
	entry, err := zw.Create("../evil.txt")
	if err != nil {
		t.Fatalf("create zip entry failed: %v", err)
	}
	if _, err := entry.Write([]byte("bad")); err != nil {
		t.Fatalf("write zip entry failed: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip writer failed: %v", err)
	}
	if err := outZip.Close(); err != nil {
		t.Fatalf("close zip file failed: %v", err)
	}

	dest := filepath.Join(tempDir, "out")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := unzipSecure(zipPath, dest); err == nil {
		t.Fatalf("expected unzipSecure to reject path traversal")
	}
}

func TestReconcileStateOnStartupClearsAppliedDownloadArtifacts(t *testing.T) {
	u := &UpdaterService{
		state: UpdaterState{
			Stage:              updateStageApplying,
			LastError:          "old error",
			HasUpdate:          true,
			Ignored:            true,
			DownloadedVersion:  Version,
			DownloadedAsset:    "XXTCloudControl-vNext-linux-amd64.zip",
			DownloadedFile:     "/tmp/update.zip",
			StagingDir:         "/tmp/staging",
			SourceBinary:       "/tmp/staging/xxtcloudserver-linux-amd64",
			SourceFrontendDir:  "/tmp/staging/frontend",
			DownloadedBytes:    12,
			DownloadTotalBytes: 24,
		},
	}

	u.reconcileStateOnStartup()

	if u.state.Stage != updateStageIdle {
		t.Fatalf("unexpected stage: %s", u.state.Stage)
	}
	if u.state.HasUpdate {
		t.Fatalf("hasUpdate should be false after successful apply")
	}
	if u.state.Ignored {
		t.Fatalf("ignored should be false after successful apply")
	}
	if u.state.DownloadedVersion != "" {
		t.Fatalf("downloaded version should be cleared, got %q", u.state.DownloadedVersion)
	}
	if u.state.DownloadedAsset != "" {
		t.Fatalf("downloaded asset should be cleared, got %q", u.state.DownloadedAsset)
	}
	if u.state.DownloadedFile != "" {
		t.Fatalf("downloaded file should be cleared, got %q", u.state.DownloadedFile)
	}
	if u.state.StagingDir != "" {
		t.Fatalf("staging dir should be cleared, got %q", u.state.StagingDir)
	}
	if u.state.SourceBinary != "" {
		t.Fatalf("source binary should be cleared, got %q", u.state.SourceBinary)
	}
	if u.state.SourceFrontendDir != "" {
		t.Fatalf("source frontend dir should be cleared, got %q", u.state.SourceFrontendDir)
	}
	if u.state.AppliedVersion != Version {
		t.Fatalf("unexpected applied version: %s", u.state.AppliedVersion)
	}
}

func TestReconcileStateOnStartupRestoresDownloadedStateAfterInterruptedApply(t *testing.T) {
	stagingDir := t.TempDir()
	sourceBinary := filepath.Join(stagingDir, "xxtcloudserver-linux-amd64")
	sourceFrontendDir := filepath.Join(stagingDir, "frontend")
	if err := os.WriteFile(sourceBinary, []byte("bin"), 0o755); err != nil {
		t.Fatalf("write source binary failed: %v", err)
	}
	if err := os.MkdirAll(sourceFrontendDir, 0o755); err != nil {
		t.Fatalf("mkdir frontend failed: %v", err)
	}

	u := &UpdaterService{
		state: UpdaterState{
			Stage:             updateStageApplying,
			HasUpdate:         true,
			DownloadedVersion: "v999999999999",
			DownloadedAsset:   "XXTCloudControl-v999999999999-linux-amd64.zip",
			StagingDir:        stagingDir,
			SourceBinary:      sourceBinary,
			SourceFrontendDir: sourceFrontendDir,
		},
	}

	u.reconcileStateOnStartup()

	if u.state.Stage != updateStageDownloaded {
		t.Fatalf("unexpected stage: %s", u.state.Stage)
	}
	if u.state.LastError == "" {
		t.Fatalf("expected retry guidance error message")
	}
	if u.state.StagingDir != stagingDir {
		t.Fatalf("staging dir should be preserved, got %q", u.state.StagingDir)
	}
	if u.state.SourceBinary != sourceBinary {
		t.Fatalf("source binary should be preserved, got %q", u.state.SourceBinary)
	}
	if u.state.SourceFrontendDir != sourceFrontendDir {
		t.Fatalf("source frontend dir should be preserved, got %q", u.state.SourceFrontendDir)
	}
}

func TestReconcileStateOnStartupMarksInterruptedApplyFailedWhenArtifactsMissing(t *testing.T) {
	u := &UpdaterService{
		state: UpdaterState{
			Stage:             updateStageApplying,
			HasUpdate:         true,
			DownloadedVersion: "v999999999999",
			DownloadedAsset:   "XXTCloudControl-v999999999999-linux-amd64.zip",
			StagingDir:        filepath.Join(t.TempDir(), "missing-staging"),
			SourceBinary:      filepath.Join(t.TempDir(), "missing-bin"),
			SourceFrontendDir: filepath.Join(t.TempDir(), "missing-frontend"),
		},
	}

	u.reconcileStateOnStartup()

	if u.state.Stage != updateStageFailed {
		t.Fatalf("unexpected stage: %s", u.state.Stage)
	}
	if u.state.LastError == "" {
		t.Fatalf("expected failure message")
	}
	if u.state.StagingDir != "" {
		t.Fatalf("staging dir should be cleared, got %q", u.state.StagingDir)
	}
	if u.state.SourceBinary != "" {
		t.Fatalf("source binary should be cleared, got %q", u.state.SourceBinary)
	}
	if u.state.SourceFrontendDir != "" {
		t.Fatalf("source frontend dir should be cleared, got %q", u.state.SourceFrontendDir)
	}
}

func TestCleanupUpdaterArtifactsPreservesCurrentDownload(t *testing.T) {
	updaterDir := filepath.Join(t.TempDir(), "updater")
	cacheDir := filepath.Join(updaterDir, "cache")
	stagingDir := filepath.Join(updaterDir, "staging")
	workerDir := filepath.Join(updaterDir, "worker")
	for _, dir := range []string{cacheDir, stagingDir, workerDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s failed: %v", dir, err)
		}
	}

	keepDownload := filepath.Join(cacheDir, "keep.zip")
	oldDownload := filepath.Join(cacheDir, "old.zip")
	keepStaging := filepath.Join(stagingDir, "keep")
	oldStaging := filepath.Join(stagingDir, "old")
	workerHelper := filepath.Join(workerDir, "xxtcc-worker-old")
	workerJob := filepath.Join(workerDir, "job-old.json")

	for _, path := range []string{keepDownload, oldDownload, workerHelper, workerJob} {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatalf("write %s failed: %v", path, err)
		}
	}
	for _, path := range []string{keepStaging, oldStaging} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatalf("mkdir %s failed: %v", path, err)
		}
	}

	if err := cleanupUpdaterArtifacts(updaterDir, updaterCleanupKeep{
		downloadedFile: keepDownload,
		stagingDir:     keepStaging,
	}); err != nil {
		t.Fatalf("cleanup updater artifacts failed: %v", err)
	}

	if _, err := os.Stat(keepDownload); err != nil {
		t.Fatalf("keep download should remain: %v", err)
	}
	if _, err := os.Stat(keepStaging); err != nil {
		t.Fatalf("keep staging should remain: %v", err)
	}
	if _, err := os.Stat(oldDownload); !os.IsNotExist(err) {
		t.Fatalf("old download should be removed, got: %v", err)
	}
	if _, err := os.Stat(oldStaging); !os.IsNotExist(err) {
		t.Fatalf("old staging should be removed, got: %v", err)
	}
	if _, err := os.Stat(workerHelper); !os.IsNotExist(err) {
		t.Fatalf("worker helper should be removed, got: %v", err)
	}
	if _, err := os.Stat(workerJob); !os.IsNotExist(err) {
		t.Fatalf("worker job should be removed, got: %v", err)
	}
}

func testManifestJSON(version string, assetURL string, fallbackURL string) string {
	return fmt.Sprintf(`{
		"version": %q,
		"channel": "stable",
		"buildTime": "2026-02-21T19:30:00Z",
		"commit": "abc1234",
		"publishedAt": "2026-02-21T19:35:00Z",
		"checksumsUrl": "https://example.com/checksums.txt",
		"latestChecksumsUrl": "https://example.com/latest-checksums.txt",
		"assets": [
			{
				"os": %q,
				"arch": %q,
				"name": "pkg.zip",
				"url": %q,
				"fallbackUrl": %q,
				"latestUrl": "https://example.com/latest/pkg.zip",
				"sha256": "placeholder"
			}
		]
	}`, version, runtime.GOOS, runtime.GOARCH, assetURL, fallbackURL)
}
