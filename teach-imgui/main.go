// Command teach-imgui is the native AFVI teaching app: Dear ImGui (cimgui-go, GLFW +
// OpenGL3) front end over the Go port of teach-core. It replaces the WebView2 shell.
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/AllenDang/cimgui-go/backend"
	"github.com/AllenDang/cimgui-go/backend/glfwbackend"
	"github.com/AllenDang/cimgui-go/imgui"
	_ "github.com/AllenDang/cimgui-go/impl/glfw"
	_ "github.com/AllenDang/cimgui-go/impl/opengl3"
)

// WindowTitle is also used by the self-test to find the window for screenshots.
const WindowTitle = "Color AFVI Master Teach"

func init() {
	// GLFW and OpenGL require all calls from the main OS thread.
	runtime.LockOSThread()
}

func main() {
	ref := flag.String("ref", "", "reference directory (contains FM1/FM2/BM); default: AFVI_REFERENCE_DIR, next to the exe, or the working directory")
	theme := flag.String("theme", ThemeDark, "ui theme: dark | light")
	lang := flag.String("lang", "zh", "ui language: zh | en | ko")
	model := flag.String("model", "", "model id to open first, e.g. FM1/25fbo015-15")
	selftest := flag.Bool("selftest", false, "load the first model, visit every tab in both themes and three languages, save screenshots and metrics, then exit")
	out := flag.String("out", ".", "output directory for -selftest screenshots and metrics")
	exitAfter := flag.Duration("exitafter", 0, "close the window after this duration")
	flag.Parse()

	SetLang(ParseLang(*lang))
	if *theme != ThemeLight {
		*theme = ThemeDark
	}
	refRoot, refErr := FindReferenceRoot(*ref)
	var models []ModelInfo
	if refErr == nil {
		models = ScanModels(refRoot)
	}
	a := NewApp(refRoot, models, refErr, *theme)
	a.exitAfter = *exitAfter
	if *selftest {
		a.selftest = NewSelftest(a, *out)
	}

	be, err := backend.CreateBackend(glfwbackend.NewGLFWBackend())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	a.be = be
	be.SetAfterCreateContextHook(setupFonts)
	be.SetAfterRenderHook(func() {
		if a.selftest != nil {
			a.selftest.AfterRender()
		}
	})
	be.SetBgColor(imgui.NewVec4(0.17, 0.17, 0.17, 1))
	be.CreateWindow(WindowTitle, 1600, 1000)
	if a.selftest != nil {
		be.SetTargetFPS(1000)
	} else {
		be.SetTargetFPS(60)
	}

	first := 0
	for i, m := range models {
		if m.ID == *model {
			first = i
		}
	}
	a.LoadModel(first)
	be.Run(func() { loop(a) })
}

func loop(a *App) {
	if a.frame == 0 {
		// The GLFW backend force-enables multi-viewport after our hook; this fixed layout must
		// stay inside the main window, otherwise edge panels pop out as separate OS windows.
		io := imgui.CurrentIO()
		io.SetConfigFlags(io.ConfigFlags() &^ imgui.ConfigFlagsViewportsEnable)
	}
	if a.selftest != nil && a.frame == 1 {
		_ = a.be.SetSwapInterval(glfwbackend.GLFWSwapIntervalImmediate)
	}
	a.Frame()
	if a.selftest != nil {
		a.selftest.Step()
	}
	if a.exitAfter > 0 && time.Since(a.start) > a.exitAfter {
		a.be.SetShouldClose(true)
	}
}

// setupFonts merges Tahoma (Latin), Microsoft YaHei (CJK) and Malgun Gothic (Hangul);
// ImGui 1.92+ bakes glyphs on demand, so no glyph ranges are needed.
func setupFonts() {
	atlas := imgui.CurrentIO().Fonts()
	base := true
	for _, path := range []string{`C:\Windows\Fonts\tahoma.ttf`, `C:\Windows\Fonts\msyh.ttc`, `C:\Windows\Fonts\malgun.ttf`} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		cfg := imgui.NewFontConfig()
		if !base {
			cfg.SetMergeMode(true)
		}
		atlas.AddFontFromFileTTFV(path, 14, cfg, nil)
		base = false
	}
}
