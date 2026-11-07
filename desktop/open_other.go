//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// 仅用于在 Linux / macOS 上做冒烟测试（真正交付物是 Windows exe）
func openAppWindow(url, profile string) (func(), error) {
	if err := openDefault(url); err != nil {
		return nil, err
	}
	return func() {}, nil
}

func openDefault(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return errors.New("no browser: " + err.Error())
	}
	return nil
}

func messageBox(title, text string) {
	fmt.Fprintf(os.Stderr, "[%s] %s\n", title, text)
}
