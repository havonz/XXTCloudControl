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
