//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// 依次在常见安装位置找 Edge / Chrome（Windows 10/11 自带 Edge）
func findBrowser() string {
	var cands []string
	add := func(root string, rels ...string) {
		if root == "" {
			return
		}
		for _, r := range rels {
			cands = append(cands, filepath.Join(root, r))
		}
	}
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		root := os.Getenv(env)
		add(root,
			`Microsoft\Edge\Application\msedge.exe`,
			`Google\Chrome\Application\chrome.exe`,
			`Chromium\Application\chrome.exe`,
		)
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// 以「应用窗口」方式打开，独立配置目录 → 数据随 exe 同目录走
func openAppWindow(url, profile string) (func(), error) {
	exe := findBrowser()
	if exe == "" {
		return nil, os.ErrNotExist
	}
	_ = os.MkdirAll(profile, 0o755)
	cmd := exec.Command(exe,
		"--app="+url,
		"--user-data-dir="+profile,
		"--window-size=1440,940",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=TranslateUI,Translate",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() { _ = cmd.Wait() }, nil
}

func openDefault(url string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func messageBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = proc.Call(0,
		uintptr(unsafe.Pointer(m)),
		uintptr(unsafe.Pointer(t)),
		uintptr(0x00000040), // MB_ICONINFORMATION
	)
}
