//go:build windows

package main

import "fmt"

func execReplaceProcess(binaryPath string, args []string, env []string) error {
	return fmt.Errorf("exec replace is not supported on windows")
}
