//go:build windows

package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed all:web
var webFS embed.FS

const (
	defaultPort = 51780
	appTitle    = "Color AFVI Teach"
)

// ModelInfo mirrors the JSON shape produced by teach-app/server.ts.
type ModelInfo struct {
	ID        string    `json:"id"`
	Host      string    `json:"host"`
	Model     string    `json:"model"`
	Side      string    `json:"side"`
	Version   string    `json:"version"`
	Files     ModelFile `json:"files"`
	AlignSpec *string   `json:"alignSpec"`
}

// ModelFile lists the reference files for a model, relative to the reference root.
type ModelFile struct {
	Metal   string  `json:"metal"`
	SR      string  `json:"sr"`
	Open    string  `json:"open"`
	Median  string  `json:"median"`
	Pattern *string `json:"pattern"`
}

var hosts = []string{"FM1", "FM2", "BM"}

func toPosix(p string) string {
	return strings.ReplaceAll(p, string(filepath.Separator), "/")
}

func isInside(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return false
	}
	return true
}

func listDirs(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular()
}

func normalizeModelKey(name string) string {
	s := strings.ToUpper(name)
	if strings.HasSuffix(s, "-00") {
		s = s[:len(s)-3]
	}
	return s
}

func findAlignSpec(repoRoot, host, model, side string) *string {
	specRoot := filepath.Join(repoRoot, host, "PxInventory", "INSPECT_SPEC")
	target := normalizeModelKey(model)
	for _, dir := range listDirs(specRoot) {
		if normalizeModelKey(dir) != target {
			continue
		}
		candidate := filepath.Join(specRoot, dir, side, "AlignSpec.xml")
		if fileExists(candidate) {
			rel, err := filepath.Rel(repoRoot, candidate)
			if err != nil {
				continue
			}
			s := toPosix(rel)
			return &s
		}
	}
	return nil
}

func findVersionWithMedian(modelDir, side, preferred string) (string, bool) {
	versions := listDirs(modelDir)
	hasMedian := func(v string) bool {
		return fileExists(filepath.Join(modelDir, v, "Line", side, "Layer", "MEDIAN", "Median_0_1_0.tif"))
	}
	for _, v := range versions {
		if v == preferred && hasMedian(v) {
			return v, true
		}
	}
	for _, v := range versions {
		if hasMedian(v) {
			return v, true
		}
	}
	return "", false
}

func scanModels(refRoot string) ([]ModelInfo, error) {
	out := []ModelInfo{}
	if refRoot == "" {
		return out, nil
	}
	refDir := refRoot
	for _, host := range hosts {
		hostDir := filepath.Join(refDir, host)
		if info, err := os.Stat(hostDir); err != nil || !info.IsDir() {
			continue
		}
		repoDir := filepath.Join(hostDir, "PxRepository")
		models := listDirs(repoDir)
		sort.Strings(models)
		for _, model := range models {
			modelDir := filepath.Join(repoDir, model)
			metal := filepath.Join(modelDir, "Metal.tif")
			sr := filepath.Join(modelDir, "SR.tif")
			open := filepath.Join(modelDir, "Open.tif")
			if !fileExists(metal) || !fileExists(sr) || !fileExists(open) {
				continue
			}
			side := "TOP"
			preferred := "2.0"
			if host == "BM" {
				side = "BOTTOM"
				preferred = "3.5"
			}
			version, ok := findVersionWithMedian(modelDir, side, preferred)
			if !ok {
				continue
			}
			medianAbs := filepath.Join(modelDir, version, "Line", side, "Layer", "MEDIAN", "Median_0_1_0.tif")
			patternAbs := filepath.Join(modelDir, version, "Line", side, "Layer", "GB", "Pattern.tif")
			var pattern *string
			if fileExists(patternAbs) {
				rel, err := filepath.Rel(refDir, patternAbs)
				if err == nil {
					s := toPosix(rel)
					pattern = &s
				}
			}
			relMetal, err1 := filepath.Rel(refDir, metal)
			relSR, err2 := filepath.Rel(refDir, sr)
			relOpen, err3 := filepath.Rel(refDir, open)
			relMedian, err4 := filepath.Rel(refDir, medianAbs)
			if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
				continue
			}
			out = append(out, ModelInfo{
				ID:      host + "/" + model,
				Host:    host,
				Model:   model,
				Side:    side,
				Version: version,
				Files: ModelFile{
					Metal:   toPosix(relMetal),
					SR:      toPosix(relSR),
					Open:    toPosix(relOpen),
					Median:  toPosix(relMedian),
					Pattern: pattern,
				},
				AlignSpec: findAlignSpec(refRoot, host, model, side),
			})
		}
	}
	return out, nil
}

func sendText(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func sendJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func contentTypeFor(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".ts":
		return "text/javascript; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

func serveEmbedded(w http.ResponseWriter, webFS fs.FS, name string) {
	data, err := fs.ReadFile(webFS, name)
	if err != nil {
		sendText(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(name))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func newHandler(webFS fs.FS, refRoot string) http.Handler {
	refDir := ""
	if refRoot != "" {
		refDir = refRoot
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			sendText(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		pathname := r.URL.Path

		switch {
		case pathname == "/" || pathname == "/index.html":
			serveEmbedded(w, webFS, "web/index.html")
			return
		case pathname == "/styles.css":
			serveEmbedded(w, webFS, "web/styles.css")
			return
		case strings.HasPrefix(pathname, "/teach-app/src/") || strings.HasPrefix(pathname, "/teach-core/src/"):
			isApp := strings.HasPrefix(pathname, "/teach-app/src/")
			prefix := "/teach-core/src/"
			base := "web/teach-core/src/"
			if isApp {
				prefix = "/teach-app/src/"
				base = "web/teach-app/src/"
			}
			rel := strings.TrimPrefix(pathname, prefix)
			if !strings.HasSuffix(rel, ".ts") {
				sendText(w, http.StatusForbidden, "only .ts modules are served")
				return
			}
			clean := path.Clean(rel)
			if strings.HasPrefix(clean, "..") || strings.Contains(clean, "/../") {
				sendText(w, http.StatusForbidden, "path escapes module root")
				return
			}
			serveEmbedded(w, webFS, base+clean)
			return
		case pathname == "/api/models":
			models, err := scanModels(refRoot)
			if err != nil {
				sendText(w, http.StatusInternalServerError, "server error")
				return
			}
			sendJSON(w, http.StatusOK, models)
			return
		case pathname == "/api/file":
			rel := r.URL.Query().Get("path")
			if rel == "" {
				sendText(w, http.StatusBadRequest, "missing path")
				return
			}
			ext := strings.ToLower(path.Ext(rel))
			if ext != ".tif" && ext != ".tiff" && ext != ".xml" {
				sendText(w, http.StatusForbidden, "extension not allowed: "+ext)
				return
			}
			if refDir == "" {
				sendText(w, http.StatusNotFound, "not found")
				return
			}
			clean := filepath.Clean(filepath.FromSlash(rel))
			if filepath.IsAbs(clean) || strings.Contains(clean, "..") {
				sendText(w, http.StatusForbidden, "path escapes reference root")
				return
			}
			abs := filepath.Join(refDir, clean)
			if !isInside(refDir, abs) {
				sendText(w, http.StatusForbidden, "path escapes reference root")
				return
			}
			f, err := os.Open(abs)
			if err != nil {
				sendText(w, http.StatusNotFound, "not found")
				return
			}
			defer f.Close()
			info, err := f.Stat()
			if err != nil || !info.Mode().IsRegular() {
				sendText(w, http.StatusNotFound, "not found")
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			http.ServeContent(w, r, info.Name(), info.ModTime(), f)
			return
		default:
			sendText(w, http.StatusNotFound, "not found")
			return
		}
	})
}

func resolveRefRoot() string {
	if env := os.Getenv("AFVI_REFERENCE_DIR"); env != "" {
		if info, err := os.Stat(env); err == nil && info.IsDir() {
			return env
		}
	}
	exe, err := os.Executable()
	if err == nil {
		exeDir := filepath.Dir(exe)
		candidate := filepath.Join(exeDir, "reference")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		dir := exeDir
		for i := 0; i < 5; i++ {
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
			candidate := filepath.Join(dir, "reference")
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				return candidate
			}
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		candidate := filepath.Join(cwd, "reference")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return ""
}

func listenLocal(port int) (net.Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err == nil {
		return ln, nil
	}
	if port == 0 {
		return nil, err
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

func attachConsole() {
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	attach := kernel32.NewProc("AttachConsole")
	const attachParentProcess = ^uintptr(0) // (DWORD)-1
	r, _, _ := attach.Call(attachParentProcess)
	if r == 0 {
		return
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout = f
		os.Stderr = f
	}
}

func runServe(port int) int {
	attachConsole()
	refRoot := resolveRefRoot()
	handler := newHandler(webFS, refRoot)
	ln, err := listenLocal(port)
	if err != nil {
		fmt.Fprintf(os.Stderr, "listen failed: %v\n", err)
		return 1
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	server := &http.Server{Handler: handler}
	go func() {
		_ = server.Serve(ln)
	}()
	fmt.Printf("AFVI teach app: http://127.0.0.1:%d/\n", actual)
	os.Stdout.Sync()
	waitForInterrupt()
	_ = server.Close()
	return 0
}

func waitForInterrupt() {
	// Block until the process is terminated. On Windows, os/signal does not
	// deliver console control events reliably for GUI subsystem binaries, so
	// we simply sleep in a loop; the parent process kills us when done.
	for {
		time.Sleep(time.Hour)
	}
}

func runWindow(port int) int {
	refRoot := resolveRefRoot()
	handler := newHandler(webFS, refRoot)
	ln, err := listenLocal(port)
	if err != nil {
		showError("无法启动本地服务。\nFailed to start local server: " + err.Error())
		return 1
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	server := &http.Server{Handler: handler}
	go func() {
		_ = server.Serve(ln)
	}()
	defer func() {
		_ = server.Close()
	}()

	dataPath := filepath.Join(os.Getenv("LOCALAPPDATA"), "ColorAfviTeach", "WebView2")
	_ = os.MkdirAll(dataPath, 0o755)
	debug := os.Getenv("TEACH_DEBUG") == "1"

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:    debug,
		DataPath: dataPath,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  appTitle,
			Width:  1600,
			Height: 1000,
			Center: true,
		},
	})
	if w == nil {
		showError("未找到 WebView2 运行时。\n请安装 Microsoft Edge WebView2 Runtime 后重试。\n\nWebView2 Runtime not found.\nPlease install the Microsoft Edge WebView2 Runtime and try again.")
		return 1
	}
	defer w.Destroy()

	w.Navigate(fmt.Sprintf("http://127.0.0.1:%d/", actual))
	w.Run()
	return 0
}

func showError(message string) {
	title, _ := syscall.UTF16PtrFromString(appTitle)
	text, _ := syscall.UTF16PtrFromString(message)
	_, _ = windows.MessageBox(0, text, title, windows.MB_OK|windows.MB_ICONERROR)
}

func main() {
	serve := flag.Bool("serve", false, "start the HTTP server only (no window)")
	port := flag.Int("port", defaultPort, "HTTP port (0 = random)")
	flag.Parse()

	if *serve {
		os.Exit(runServe(*port))
	}
	os.Exit(runWindow(*port))
}

var _ = errors.New
