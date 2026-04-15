package main

import (
	"archive/zip"
	"os"
	"path/filepath"
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
	if err := os.MkdirAll(dest, 0755); err != nil {
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
	if err := os.WriteFile(sourceBinary, []byte("bin"), 0755); err != nil {
		t.Fatalf("write source binary failed: %v", err)
	}
	if err := os.MkdirAll(sourceFrontendDir, 0755); err != nil {
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
		if err := os.MkdirAll(dir, 0755); err != nil {
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
		if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
			t.Fatalf("write %s failed: %v", path, err)
		}
	}
	for _, path := range []string{keepStaging, oldStaging} {
		if err := os.MkdirAll(path, 0755); err != nil {
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
