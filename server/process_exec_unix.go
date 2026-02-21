//go:build !windows

package main

import "syscall"

func execReplaceProcess(binaryPath string, args []string, env []string) error {
	return syscall.Exec(binaryPath, args, env)
}
