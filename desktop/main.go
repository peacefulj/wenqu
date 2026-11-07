/* 研墨 · 免安装桌面版外壳
 *
 * 把整站静态文件嵌入单个 exe，在本机 127.0.0.1 起一个只读 HTTP 服务，
 * 再用系统自带的 Edge / Chrome 以「应用窗口」（--app）打开，看起来就是一个独立程序。
 * 数据放在 exe 同目录的 YanMoData（浏览器配置目录），删掉这个文件夹即清除全部数据。
 */
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed all:web
var webFS embed.FS

// 由构建脚本通过 -ldflags "-X main.appVersion=x.y.z" 注入
var appVersion = "dev"

// 由构建脚本通过 -ldflags "-X main.aiUpstream=https://…/v1" 注入；留空则关闭本机中转
var aiUpstream = ""

/* 同源反向代理：/__ai/v1/chat/completions → {aiUpstream}/chat/completions
   流式（SSE）逐块 flush，避免整段等完才显示。 */
func aiProxy() http.Handler {
	up, err := url.Parse(aiUpstream)
	if err != nil || up.Host == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusNotImplemented)
			_, _ = io.WriteString(w, `{"error":{"message":"桌面版未配置 AI 中转地址（构建时缺少 upstream）"}}`)
		})
	}
	rp := httputil.NewSingleHostReverseProxy(up)
	rp.Director = func(r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/__ai/v1")
		if rest == "" {
			rest = "/"
		}
		r.URL.Scheme = up.Scheme
		r.URL.Host = up.Host
		r.URL.Path = strings.TrimSuffix(up.Path, "/") + rest
		r.Host = up.Host
		r.Header.Del("Origin")
		r.Header.Del("Referer")
	}
	rp.FlushInterval = -1
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]string{"message": "本机中转连不上上游：" + e.Error()},
		})
	}
	return rp
}

const (
	appTag   = "yanmo-desktop"
	basePort = 17823
	dataName = "YanMoData"
)

const swStub = `/* 桌面版：不注册离线缓存，避免版本升级后读到旧文件 */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(
    self.registration.unregister().then(function () {
      return self.clients.matchAll();
    }).then(function (cs) {
      cs.forEach(function (c) { c.navigate(c.url); });
    }).catch(function () {})
  );
});
`

func main() {
	flag.Parse()

	if os.Getenv("YANMO_NO_BROWSER") == "1" {
		// 仅用于本机冒烟测试：只起服务，不拉起浏览器
		if _, _, err := startServer(); err != nil {
			fail(err)
		}
		select {}
	}

	// 已有同版本实例：直接把窗口再打开一次
	// 版本不同（例如旧版 exe 还开着）则不复用——否则双击新版 exe 看到的还是旧版页面
	if port, ver, ok := runningInstance(); ok {
		if ver == appVersion {
			if err := openDefault(fmt.Sprintf("http://127.0.0.1:%d/index.html", port)); err != nil {
				messageBox("研墨", "研墨已经在运行，但没能打开窗口：\n"+err.Error())
			}
			return
		}
	}

	srv, url, err := startServer()
	if err != nil {
		fail(err)
	}
	defer srv.Close()

	wait, err := openAppWindow(url, dataDir())
	if err != nil {
		// 找不到 Edge / Chrome：退回默认浏览器
		if err2 := openDefault(url); err2 != nil {
			messageBox("研墨", "没能打开浏览器。\n\n请先安装 Microsoft Edge，或手动访问：\n"+url)
			return
		}
		messageBox("研墨", "已用默认浏览器打开研墨。\n\n注意：请保持「"+exeName()+"」运行，关闭后页面将无法再加载。")
		select {}
	}

	// 等应用窗口关闭再退出；若浏览器进程秒退（移交给了已有实例），改用默认浏览器并常驻
	start := time.Now()
	wait()
	if time.Since(start) < 2*time.Second {
		if err := openDefault(url); err == nil {
			select {}
		}
	}
}

func startServer() (*http.Server, string, error) {
	var ln net.Listener
	var port int
	for p := basePort; p < basePort+20; p++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			ln, port = l, p
			break
		}
	}
	if ln == nil {
		return nil, "", fmt.Errorf("本机端口 %d–%d 都被占用，无法启动", basePort, basePort+19)
	}
	srv := &http.Server{Handler: handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	return srv, fmt.Sprintf("http://127.0.0.1:%d/index.html", port), nil
}

func runningInstance() (int, string, bool) {
	client := &http.Client{Timeout: 600 * time.Millisecond}
	for p := basePort; p < basePort+20; p++ {
		res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/__health", p))
		if err != nil {
			continue
		}
		var m map[string]string
		dec := json.NewDecoder(io.LimitReader(res.Body, 4096))
		_ = dec.Decode(&m)
		res.Body.Close()
		if m["app"] == appTag {
			return p, m["version"], true
		}
	}
	return 0, "", false
}

func handler() http.Handler {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(sub))

	mux := http.NewServeMux()
	mux.HandleFunc("/__health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"app": appTag, "version": appVersion, "proxy": aiUpstream})
	})
	/* 本机 AI 中转：浏览器带着 Authorization 直连第三方会被预检拦掉（很多服务商 OPTIONS 返回 405），
	   这里在 127.0.0.1 上同源转发，页面用 /__ai/v1 作 base 即可，不再有跨域问题。 */
	mux.Handle("/__ai/", aiProxy())
	mux.HandleFunc("/sw.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, swStub)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/" || strings.HasSuffix(p, ".html"):
			w.Header().Set("Cache-Control", "no-store")
		case strings.HasSuffix(p, ".js"), strings.HasSuffix(p, ".css"), strings.HasSuffix(p, ".webmanifest"):
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
	return mux
}

func exePath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return p
}

func exeName() string {
	if n := filepath.Base(exePath()); n != "" && n != "." {
		return n
	}
	return "研墨.exe"
}

// 数据目录：优先 exe 同目录（真正可搬运），不可写时退回用户缓存目录
func dataDir() string {
	if p := exePath(); p != "" {
		d := filepath.Join(filepath.Dir(p), dataName)
		if os.MkdirAll(d, 0o755) == nil {
			t := filepath.Join(d, ".probe")
			if os.WriteFile(t, []byte("ok"), 0o644) == nil {
				_ = os.Remove(t)
				return d
			}
		}
	}
	if base, err := os.UserCacheDir(); err == nil {
		d := filepath.Join(base, "YanMo")
		_ = os.MkdirAll(d, 0o755)
		return d
	}
	d := filepath.Join(os.TempDir(), "YanMo")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func fail(err error) {
	messageBox("研墨启动失败", err.Error()+"\n\n如果反复失败，请把本文件单独放到一个可写目录（例如 D:\\研墨\\）再试。")
	os.Exit(1)
}
