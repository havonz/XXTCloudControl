package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type updateWorkerJob struct {
	ParentPID         int      `json:"parentPid"`
	StateFile         string   `json:"stateFile"`
	SourceBinary      string   `json:"sourceBinary"`
	SourceFrontendDir string   `json:"sourceFrontendDir"`
	StagingDir        string   `json:"stagingDir"`
	TargetBinary      string   `json:"targetBinary"`
	TargetFrontendDir string   `json:"targetFrontendDir"`
	BackupBinary      string   `json:"backupBinary"`
	BackupFrontendDir string   `json:"backupFrontendDir"`
	WorkingDir        string   `json:"workingDir"`
	RestartArgs       []string `json:"restartArgs"`
	TargetVersion     string   `json:"targetVersion"`
}

func runUpdateWorker(jobPath string) error {
	data, err := os.ReadFile(jobPath)
	if err != nil {
		return err
	}
	var job updateWorkerJob
	if err := json.Unmarshal(data, &job); err != nil {
		return err
	}
	updateStateByWorker(job.StateFile, func(state *UpdaterState) {
		state.Stage = updateStageApplying
		state.LastError = ""
	})

	if !waitForProcessExit(job.ParentPID, 30*time.Second) {
		err := fmt.Errorf("timed out waiting parent process (%d) to exit", job.ParentPID)
		updateStateByWorker(job.StateFile, func(state *UpdaterState) {
			state.Stage = updateStageFailed
			state.LastError = err.Error()
		})
		return err
	}

	var replaceErr error
	for attempt := 0; attempt < 200; attempt++ {
		replaceErr = applyUpdateReplacement(job)
		if replaceErr == nil {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if replaceErr != nil {
		updateStateByWorker(job.StateFile, func(state *UpdaterState) {
			state.Stage = updateStageFailed
			state.LastError = replaceErr.Error()
		})
		return replaceErr
	}

	if err := startTargetProcess(job); err != nil {
		rollbackFromBackup(job)
		updateStateByWorker(job.StateFile, func(state *UpdaterState) {
			state.Stage = updateStageFailed
			state.LastError = err.Error()
		})
		return err
	}

	updateStateByWorker(job.StateFile, func(state *UpdaterState) {
		state.Stage = updateStageIdle
		state.LastError = ""
		state.HasUpdate = false
		state.Ignored = false
		state.AppliedVersion = job.TargetVersion
		state.DownloadedVersion = ""
		state.DownloadedAsset = ""
		state.DownloadedFile = ""
		state.StagingDir = ""
		state.SourceBinary = ""
		state.SourceFrontendDir = ""
	})

	if job.StagingDir != "" {
		_ = os.RemoveAll(job.StagingDir)
	}
	_ = os.Remove(jobPath)
	return nil
}

func waitForProcessExit(pid int, timeout time.Duration) bool {
	if pid <= 0 {
		return true
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !isProcessAlive(pid) {
			return true
		}
		time.Sleep(120 * time.Millisecond)
	}
	return !isProcessAlive(pid)
}

func applyUpdateReplacement(job updateWorkerJob) error {
	if err := ensureFile(job.SourceBinary); err != nil {
		return err
	}
	if err := ensureDir(job.SourceFrontendDir); err != nil {
		return err
	}

	targetDir := filepath.Dir(job.TargetBinary)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	tempBinary := job.TargetBinary + ".new"
	_ = os.Remove(tempBinary)
	if err := copyFile(job.SourceBinary, tempBinary); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		_ = os.Chmod(tempBinary, 0755)
	}

	_ = os.Remove(job.BackupBinary)
	if exists(job.TargetBinary) {
		if err := os.Rename(job.TargetBinary, job.BackupBinary); err != nil {
			_ = os.Remove(tempBinary)
			return err
		}
	}
	if err := os.Rename(tempBinary, job.TargetBinary); err != nil {
		if exists(job.BackupBinary) {
			_ = os.Rename(job.BackupBinary, job.TargetBinary)
		}
		_ = os.Remove(tempBinary)
		return err
	}

	tempFrontend := job.TargetFrontendDir + ".new"
	_ = os.RemoveAll(tempFrontend)
	if err := copyDir(job.SourceFrontendDir, tempFrontend); err != nil {
		rollbackBinary(job.TargetBinary, job.BackupBinary)
		return err
	}

	_ = os.RemoveAll(job.BackupFrontendDir)
	if exists(job.TargetFrontendDir) {
		if err := os.Rename(job.TargetFrontendDir, job.BackupFrontendDir); err != nil {
			_ = os.RemoveAll(tempFrontend)
			rollbackBinary(job.TargetBinary, job.BackupBinary)
			return err
		}
	}
	if err := os.Rename(tempFrontend, job.TargetFrontendDir); err != nil {
		if exists(job.BackupFrontendDir) {
			_ = os.Rename(job.BackupFrontendDir, job.TargetFrontendDir)
		}
		_ = os.RemoveAll(tempFrontend)
		rollbackBinary(job.TargetBinary, job.BackupBinary)
		return err
	}

	return nil
}

func startTargetProcess(job updateWorkerJob) error {
	cmd := exec.Command(job.TargetBinary, job.RestartArgs...)
	cmd.Dir = job.WorkingDir
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start updated server: %w", err)
	}
	return nil
}

func rollbackFromBackup(job updateWorkerJob) {
	if exists(job.BackupFrontendDir) {
		_ = os.RemoveAll(job.TargetFrontendDir)
		_ = os.Rename(job.BackupFrontendDir, job.TargetFrontendDir)
	}
	rollbackBinary(job.TargetBinary, job.BackupBinary)
}

func rollbackBinary(target string, backup string) {
	if exists(backup) {
		_ = os.Remove(target)
		_ = os.Rename(backup, target)
	}
}

func updateStateByWorker(stateFile string, mutate func(*UpdaterState)) {
	state, err := readUpdaterStateFile(stateFile)
	if err != nil {
		if !os.IsNotExist(err) {
			return
		}
		state = UpdaterState{Stage: updateStageIdle}
	}
	mutate(&state)
	_ = writeUpdaterStateFile(stateFile, state)
}

func copyDir(src string, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(targetPath, info.Mode())
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink is not supported in update package: %s", path)
		}
		return copyFile(path, targetPath)
	})
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func ensureFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("expected file but got directory: %s", path)
	}
	return nil
}

func ensureDir(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("expected directory but got file: %s", path)
	}
	return nil
}
