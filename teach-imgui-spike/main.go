// Command teach-imgui-spike is a feasibility prototype for moving the AFVI teaching
// app from WebView2 to Dear ImGui (cimgui-go): large-image viewer with CPU light
// rendering, 10k-box overlay, 10k-row clipped table, ImPlot histogram, zh/en/ko
// fonts and runtime dark/light themes. Run with -selftest to collect metrics.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"time"

	"github.com/AllenDang/cimgui-go/backend"
	"github.com/AllenDang/cimgui-go/backend/glfwbackend"
	"github.com/AllenDang/cimgui-go/imgui"
	_ "github.com/AllenDang/cimgui-go/impl/glfw"
	_ "github.com/AllenDang/cimgui-go/impl/opengl3"
	"github.com/AllenDang/cimgui-go/implot"
)

const windowTitle = "AFVI Teach ImGui Spike"

func init() {
	runtime.LockOSThread()
}

type loadResult struct {
	scene *Scene
	err   error
	ms    float64
}

type renderResult struct {
	lut  [4][256]uint8
	hist [256]uint32
	ms   float64
}

type ovRect struct {
	x, y, w, h float32
	rejected   bool
	area       string
}

type blobRow struct {
	cells [6]string
	dark  bool
}

type phase struct {
	name   string
	frames int
	enter  func(a *app)
	shot   string
}

type phaseStat struct {
	Frames     int     `json:"frames"`
	MeanMs     float64 `json:"frameMeanMs"`
	P50Ms      float64 `json:"frameP50Ms"`
	P95Ms      float64 `json:"frameP95Ms"`
	MaxMs      float64 `json:"frameMaxMs"`
	LoopMeanMs float64 `json:"uiBuildMeanMs"`
	FPS        float64 `json:"fps"`
	Overlay    int     `json:"overlayDrawn,omitempty"`
}

type app struct {
	be     backend.Backend[glfwbackend.GLFWWindowFlags]
	refDir string

	scene   *Scene
	loadErr string
	loadMs  float64
	loaded  chan loadResult

	light      LightParams
	lightDirty bool
	rendering  bool
	results    chan renderResult
	buf        []byte
	tex        *backend.Texture
	lut        [4][256]uint8
	hist       [256]float32
	renderMs   []float64
	uploadMs   []float64

	zoom, panX, panY float32
	fitZoom          float32
	needFit          bool
	zoomRequest      float32
	overlayOn        bool
	overlay          []ovRect
	drawnOverlay     int
	rows             []blobRow
	clipper          *imgui.ListClipper
	scrollTo         float32
	readout          string

	lang, theme, appliedTheme string

	start        time.Time
	firstImageMs float64
	lastFrame    time.Time
	frameCount   int
	heapMB       float64

	selftest   bool
	outDir     string
	phases     []phase
	phaseIdx   int
	phaseFrame int
	frameMs    []float64
	loopMs     []float64
	lightRuns  int
	maxDrawn   int
	stats      map[string]phaseStat
	shots      []string
	shotErrors []string
	pendingShot string
	capturing   bool
	finished    bool
	statusDebug string
	exitAfter   time.Duration
}

func v2(x, y float32) imgui.Vec2 { return imgui.NewVec2(x, y) }

func msSince(t time.Time) float64 { return float64(time.Since(t).Microseconds()) / 1000 }

func main() {
	ref := flag.String("ref", filepath.Join("..", "reference", "FM1", "PxRepository", "25fbo015-15"), "model directory (Metal/SR/Open + MEDIAN)")
	selftest := flag.Bool("selftest", false, "run scripted phases, capture screenshots, write spike-metrics.json and exit")
	out := flag.String("out", ".", "output directory for -selftest artifacts")
	exitAfter := flag.Duration("exitafter", 0, "close the window after this duration (idle CPU measurement)")
	flag.Parse()

	a := &app{
		refDir:   *ref,
		light:    defaultLight(),
		lang:     "zh",
		theme:    "dark",
		needFit:  true,
		scrollTo: -1,
		selftest: *selftest,
		outDir:   *out,
		start:    time.Now(),
		loaded:   make(chan loadResult, 1),
		results:  make(chan renderResult, 1),
		stats:    map[string]phaseStat{},
		exitAfter: *exitAfter,
	}
	a.rows = makeRows(10000)
	go func() {
		t0 := time.Now()
		s, err := LoadScene(a.refDir)
		a.loaded <- loadResult{scene: s, err: err, ms: msSince(t0)}
	}()

	be, err := backend.CreateBackend(glfwbackend.NewGLFWBackend())
	if err != nil {
		panic(err)
	}
	a.be = be
	be.SetAfterCreateContextHook(func() {
		a.setupFonts()
		implot.CreateContext()
	})
	be.SetBeforeDestroyContextHook(func() {
		implot.DestroyContext()
	})
	// PrintWindow re-enters the GLFW refresh callback (a full frame), so it may only run
	// between frames; the capturing flag keeps the re-entrant frame from stepping phases.
	be.SetAfterRenderHook(func() {
		if a.pendingShot == "" || a.capturing {
			return
		}
		path := a.pendingShot
		a.pendingShot = ""
		a.capturing = true
		if err := captureWindow(windowTitle, path); err != nil {
			a.shotErrors = append(a.shotErrors, filepath.Base(path)+": "+err.Error())
		} else {
			a.shots = append(a.shots, path)
		}
		a.capturing = false
		if a.phaseIdx >= len(a.phases) && !a.finished {
			a.finishSelftest()
		}
	})
	be.SetBgColor(imgui.NewVec4(0.1, 0.1, 0.1, 1))
	be.CreateWindow(windowTitle, 1600, 1000)
	if a.selftest {
		be.SetTargetFPS(1000)
	} else {
		be.SetTargetFPS(60)
	}
	a.initPhases()
	be.Run(a.loop)
}

func (a *app) setupFonts() {
	atlas := imgui.CurrentIO().Fonts()
	atlas.AddFontFromFileTTFV(`C:\Windows\Fonts\tahoma.ttf`, 15, imgui.NewFontConfig(), nil)
	for _, path := range []string{`C:\Windows\Fonts\msyh.ttc`, `C:\Windows\Fonts\malgun.ttf`} {
		cfg := imgui.NewFontConfig()
		cfg.SetMergeMode(true)
		atlas.AddFontFromFileTTFV(path, 15, cfg, nil)
	}
}

func makeRows(n int) []blobRow {
	rng := rand.New(rand.NewSource(7))
	rows := make([]blobRow, n)
	for i := range rows {
		area := 1 + rng.Intn(400)
		peak := 30 + rng.Float64()*120
		rows[i] = blobRow{
			cells: [6]string{
				strconv.Itoa(i + 1),
				"",
				strconv.Itoa(area),
				strconv.FormatFloat(peak, 'f', 1, 64),
				strconv.FormatFloat(peak*0.7, 'f', 1, 64),
				strconv.FormatFloat(rng.Float64()*255, 'f', 1, 64),
			},
			dark: rng.Intn(3) == 0,
		}
	}
	return rows
}

func makeOverlay(w, h, n int) []ovRect {
	rng := rand.New(rand.NewSource(11))
	out := make([]ovRect, n)
	for i := range out {
		rw := float32(2 + rng.Intn(60))
		rh := float32(2 + rng.Intn(60))
		out[i] = ovRect{
			x:        float32(rng.Intn(w - 64)),
			y:        float32(rng.Intn(h - 64)),
			w:        rw,
			h:        rh,
			rejected: rng.Intn(10) != 0,
			area:     strconv.Itoa(int(rw * rh)),
		}
	}
	return out
}

func (a *app) requestRender() {
	if a.scene == nil {
		return
	}
	if a.rendering {
		a.lightDirty = true
		return
	}
	a.rendering = true
	a.lightDirty = false
	p, s, buf := a.light, a.scene, a.buf
	go func() {
		t0 := time.Now()
		lut := s.BuildLUT(p)
		hist := s.Render(&lut, buf)
		a.results <- renderResult{lut: lut, hist: hist, ms: msSince(t0)}
	}()
}

func (a *app) pollAsync() {
	select {
	case r := <-a.loaded:
		a.loadMs = r.ms
		if r.err != nil {
			a.loadErr = r.err.Error()
		} else {
			a.scene = r.scene
			a.buf = make([]byte, 4*r.scene.W*r.scene.H)
			a.overlay = makeOverlay(r.scene.W, r.scene.H, 10000)
			a.requestRender()
		}
	default:
	}
	select {
	case r := <-a.results:
		t0 := time.Now()
		if a.tex != nil {
			a.tex.Release()
		}
		w, h := a.scene.W, a.scene.H
		a.tex = backend.NewTextureFromRgba(&image.RGBA{Pix: a.buf, Stride: 4 * w, Rect: image.Rect(0, 0, w, h)})
		a.uploadMs = append(a.uploadMs, msSince(t0))
		a.renderMs = append(a.renderMs, r.ms)
		a.lut = r.lut
		for i, v := range r.hist {
			a.hist[i] = float32(math.Log10(float64(v) + 1))
		}
		a.rendering = false
		if a.firstImageMs == 0 {
			a.firstImageMs = msSince(a.start)
		}
		if a.lightDirty {
			a.requestRender()
		}
	default:
	}
}

func (a *app) loop() {
	now := time.Now()
	if !a.lastFrame.IsZero() {
		a.frameMs = append(a.frameMs, float64(now.Sub(a.lastFrame).Microseconds())/1000)
	}
	a.lastFrame = now
	a.frameCount++
	if a.frameCount == 1 {
		// The GLFW backend force-enables multi-viewport after our hook; a fixed industrial
		// layout must stay inside the main window, otherwise edge panels pop out as OS windows.
		io := imgui.CurrentIO()
		io.SetConfigFlags(io.ConfigFlags() &^ imgui.ConfigFlagsViewportsEnable)
	}
	if a.selftest && a.frameCount == 2 {
		_ = a.be.SetSwapInterval(glfwbackend.GLFWSwapIntervalImmediate)
	}
	if a.frameCount%60 == 0 {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		a.heapMB = float64(ms.HeapAlloc) / (1 << 20)
	}
	a.pollAsync()
	if a.appliedTheme != a.theme {
		applyTheme(a.theme)
		a.appliedTheme = a.theme
	}
	a.drawUI()
	a.loopMs = append(a.loopMs, msSince(now))
	if a.exitAfter > 0 && time.Since(a.start) > a.exitAfter {
		a.be.SetShouldClose(true)
	}
	if a.selftest && !a.capturing && a.pendingShot == "" {
		a.stepSelftest()
	}
}

func applyTheme(name string) {
	style := imgui.CurrentStyle()
	if name == "light" {
		imgui.StyleColorsLight()
	} else {
		imgui.StyleColorsDark()
	}
	style.SetWindowRounding(0)
	style.SetChildRounding(0)
	style.SetFrameRounding(0)
	style.SetPopupRounding(0)
	style.SetScrollbarRounding(0)
	style.SetGrabRounding(0)
	style.SetTabRounding(0)
	style.SetWindowBorderSize(1)
	style.SetChildBorderSize(1)
	style.SetFrameBorderSize(1)
	style.SetWindowPadding(v2(6, 6))
	style.SetFramePadding(v2(4, 2))
	style.SetItemSpacing(v2(6, 3))
	style.SetScrollbarSize(14)
	style.SetGrabMinSize(10)
	style.SetWindowMinSize(v2(8, 8))
	c := style.Colors()
	rgb := func(r, g, b int) imgui.Vec4 { return imgui.NewVec4(float32(r)/255, float32(g)/255, float32(b)/255, 1) }
	if name == "light" {
		c[imgui.ColWindowBg] = rgb(212, 208, 200)
		c[imgui.ColChildBg] = rgb(212, 208, 200)
		c[imgui.ColPopupBg] = rgb(255, 255, 255)
		c[imgui.ColBorder] = rgb(128, 128, 128)
		c[imgui.ColFrameBg] = rgb(255, 255, 255)
		c[imgui.ColFrameBgHovered] = rgb(240, 240, 240)
		c[imgui.ColFrameBgActive] = rgb(230, 230, 230)
		c[imgui.ColButton] = rgb(212, 208, 200)
		c[imgui.ColButtonHovered] = rgb(228, 226, 220)
		c[imgui.ColButtonActive] = rgb(190, 186, 178)
		c[imgui.ColHeader] = rgb(166, 184, 214)
		c[imgui.ColHeaderHovered] = rgb(186, 202, 228)
		c[imgui.ColHeaderActive] = rgb(150, 170, 205)
		c[imgui.ColSliderGrab] = rgb(10, 36, 106)
		c[imgui.ColSliderGrabActive] = rgb(30, 60, 140)
		c[imgui.ColCheckMark] = rgb(0, 0, 0)
		c[imgui.ColTableHeaderBg] = rgb(200, 196, 188)
		c[imgui.ColText] = rgb(0, 0, 0)
	} else {
		c[imgui.ColWindowBg] = rgb(43, 43, 43)
		c[imgui.ColChildBg] = rgb(43, 43, 43)
		c[imgui.ColBorder] = rgb(80, 80, 80)
		c[imgui.ColFrameBg] = rgb(28, 28, 28)
		c[imgui.ColFrameBgHovered] = rgb(40, 40, 40)
		c[imgui.ColFrameBgActive] = rgb(50, 50, 50)
		c[imgui.ColButton] = rgb(60, 60, 60)
		c[imgui.ColButtonHovered] = rgb(74, 74, 74)
		c[imgui.ColButtonActive] = rgb(35, 69, 122)
		c[imgui.ColHeader] = rgb(29, 52, 97)
		c[imgui.ColHeaderHovered] = rgb(35, 69, 122)
		c[imgui.ColHeaderActive] = rgb(40, 80, 140)
		c[imgui.ColSliderGrab] = rgb(150, 150, 150)
		c[imgui.ColSliderGrabActive] = rgb(200, 200, 200)
		c[imgui.ColCheckMark] = rgb(0, 255, 0)
		c[imgui.ColTableHeaderBg] = rgb(55, 55, 55)
		c[imgui.ColText] = rgb(224, 224, 224)
	}
	style.SetColors(&c)
}

const (
	topH    = 34
	statusH = 26
	leftW   = 320
	rightW  = 400
)

func fixedFlags() imgui.WindowFlags {
	return imgui.WindowFlagsNoTitleBar | imgui.WindowFlagsNoResize | imgui.WindowFlagsNoMove |
		imgui.WindowFlagsNoCollapse | imgui.WindowFlagsNoSavedSettings | imgui.WindowFlagsNoBringToFrontOnFocus
}

func place(x, y, w, h float32) {
	imgui.SetNextWindowPosV(v2(x, y), imgui.CondAlways, v2(0, 0))
	imgui.SetNextWindowSizeV(v2(w, h), imgui.CondAlways)
}

func (a *app) drawUI() {
	vp := imgui.MainViewport()
	p := vp.WorkPos()
	sz := vp.WorkSize()
	bodyH := sz.Y - topH - statusH
	a.drawToolbar(p.X, p.Y, sz.X)
	a.drawLeft(p.X, p.Y+topH, bodyH)
	a.drawViewer(p.X+leftW, p.Y+topH, sz.X-leftW-rightW, bodyH)
	a.drawRight(p.X+sz.X-rightW, p.Y+topH, bodyH)
	a.drawStatus(p.X, p.Y+sz.Y-statusH, sz.X)
}

func (a *app) drawToolbar(x, y, w float32) {
	place(x, y, w, topH)
	imgui.BeginV("##toolbar", nil, fixedFlags()|imgui.WindowFlagsNoScrollbar)
	imgui.TextUnformatted(a.t("title"))
	imgui.SameLine()
	imgui.TextUnformatted("   " + a.t("lang"))
	imgui.SameLine()
	imgui.SetNextItemWidth(110)
	current := a.lang
	for _, l := range langs {
		if l.Code == a.lang {
			current = l.Label
		}
	}
	if imgui.BeginCombo("##lang", current) {
		for _, l := range langs {
			if imgui.SelectableBoolV(l.Label, l.Code == a.lang, 0, v2(0, 0)) {
				a.lang = l.Code
			}
		}
		imgui.EndCombo()
	}
	imgui.SameLine()
	imgui.TextUnformatted(a.t("theme"))
	imgui.SameLine()
	imgui.SetNextItemWidth(110)
	if imgui.BeginCombo("##theme", a.t(a.theme)) {
		for _, th := range []string{"dark", "light"} {
			if imgui.SelectableBoolV(a.t(th)+"##"+th, th == a.theme, 0, v2(0, 0)) {
				a.theme = th
			}
		}
		imgui.EndCombo()
	}
	imgui.SameLine()
	switch {
	case a.loadErr != "":
		imgui.TextUnformatted("ERROR: " + a.loadErr)
	case a.scene == nil:
		imgui.TextUnformatted(a.t("loading"))
	case a.rendering:
		imgui.TextUnformatted(a.t("rendering"))
	default:
		imgui.TextUnformatted(fmt.Sprintf("%dx%d · load %.0f ms", a.scene.W, a.scene.H, a.loadMs))
	}
	imgui.End()
}

func (a *app) slider(label string, v *float32, lo, hi float32, format string) bool {
	return imgui.SliderFloatV(label, v, lo, hi, format, imgui.SliderFlagsAlwaysClamp)
}

func (a *app) drawLeft(x, y, h float32) {
	place(x, y, leftW, h)
	imgui.BeginV("##left", nil, fixedFlags())
	changed := false
	if imgui.CollapsingHeaderTreeNodeFlagsV(a.t("sec.light")+"##hl", imgui.TreeNodeFlagsDefaultOpen) {
		if imgui.Checkbox(a.t("enable")+"##en", &a.light.Enable) {
			changed = true
		}
		if a.slider(a.t("value")+"##val", &a.light.Value, 0, 1024, "%.0f") {
			changed = true
		}
		if a.slider(a.t("gain")+"##gain", &a.light.Gain, 0, 4, "%.2f") {
			changed = true
		}
		if a.slider(a.t("offset")+"##off", &a.light.Offset, -100, 100, "%.0f") {
			changed = true
		}
		if a.slider(a.t("texture")+"##tex", &a.light.TexStrength, 0, 2, "%.2f") {
			changed = true
		}
	}
	if imgui.CollapsingHeaderTreeNodeFlagsV(a.t("sec.refl")+"##hr", imgui.TreeNodeFlagsDefaultOpen) {
		for m, name := range []string{"base", "sr", "open", "metal"} {
			if a.slider(name+"##r"+name, &a.light.Refl[m], 0, 2, "%.3f") {
				changed = true
			}
		}
	}
	if changed {
		a.requestRender()
	}
	if imgui.CollapsingHeaderTreeNodeFlagsV(a.t("sec.overlay")+"##ho", imgui.TreeNodeFlagsDefaultOpen) {
		imgui.Checkbox(a.t("overlayOn")+"##ov", &a.overlayOn)
		if imgui.Button(a.t("fit") + "##fit") {
			a.needFit = true
		}
		imgui.TextUnformatted(fmt.Sprintf("drawn %d", a.drawnOverlay))
	}
	imgui.Separator()
	imgui.TextUnformatted(a.t("sample"))
	imgui.TextUnformatted("中文 · English · 한국어 · ΔGV ≥ 30")
	imgui.End()
}

func (a *app) drawViewer(x, y, w, h float32) {
	place(x, y, w, h)
	imgui.BeginV("##viewer", nil, fixedFlags()|imgui.WindowFlagsNoScrollbar|imgui.WindowFlagsNoScrollWithMouse)
	origin := imgui.CursorScreenPos()
	avail := imgui.ContentRegionAvail()
	if avail.X < 1 {
		avail.X = 1
	}
	if avail.Y < 1 {
		avail.Y = 1
	}
	imgui.InvisibleButtonV("##canvas", avail, imgui.ButtonFlagsMouseButtonLeft)
	hovered := imgui.IsItemHovered()
	active := imgui.IsItemActive()
	io := imgui.CurrentIO()
	dl := imgui.WindowDrawList()
	vmax := v2(origin.X+avail.X, origin.Y+avail.Y)
	dl.PushClipRect(origin, vmax)
	bg := imgui.NewVec4(0.17, 0.17, 0.17, 1)
	if a.theme == "light" {
		bg = imgui.NewVec4(0.5, 0.5, 0.5, 1)
	}
	dl.AddRectFilled(origin, vmax, imgui.ColorU32Vec4(bg))
	a.drawnOverlay = 0
	if a.scene != nil {
		iw, ih := float32(a.scene.W), float32(a.scene.H)
		if a.needFit {
			a.fitZoom = float32(math.Min(float64(avail.X/iw), float64(avail.Y/ih))) * 0.98
			a.zoom = a.fitZoom
			a.panX = (avail.X - iw*a.zoom) / 2
			a.panY = (avail.Y - ih*a.zoom) / 2
			a.needFit = false
		}
		if a.zoomRequest > 0 {
			a.zoom = a.fitZoom * a.zoomRequest
			a.panX = avail.X/2 - iw/2*a.zoom
			a.panY = avail.Y/2 - ih/2*a.zoom
			a.zoomRequest = 0
		}
		if hovered && io.MouseWheel() != 0 {
			m := io.MousePos()
			ix := (m.X - origin.X - a.panX) / a.zoom
			iy := (m.Y - origin.Y - a.panY) / a.zoom
			a.zoom = float32(math.Min(32, math.Max(0.02, float64(a.zoom)*math.Pow(1.2, float64(io.MouseWheel())))))
			a.panX = m.X - origin.X - ix*a.zoom
			a.panY = m.Y - origin.Y - iy*a.zoom
		}
		if active && imgui.IsMouseDragging(imgui.MouseButtonLeft) {
			d := io.MouseDelta()
			a.panX += d.X
			a.panY += d.Y
		}
		imin := v2(origin.X+a.panX, origin.Y+a.panY)
		imax := v2(imin.X+iw*a.zoom, imin.Y+ih*a.zoom)
		if a.tex != nil {
			dl.AddImage(a.tex.ID, imin, imax)
		}
		if a.overlayOn {
			a.drawOverlay(dl, imin, origin, vmax)
		}
		if hovered {
			m := io.MousePos()
			ix := int((m.X - imin.X) / a.zoom)
			iy := int((m.Y - imin.Y) / a.zoom)
			if ix >= 0 && iy >= 0 && ix < a.scene.W && iy < a.scene.H {
				i := iy*a.scene.W + ix
				a.readout = fmt.Sprintf("XY %d,%d GV %d", ix, iy, a.lut[a.scene.Material[i]][a.scene.Median[i]])
			}
		}
	} else {
		dl.AddTextVec2(v2(origin.X+20, origin.Y+20), imgui.ColorU32Vec4(imgui.NewVec4(1, 1, 1, 1)), a.t("loading"))
	}
	dl.PopClipRect()
	imgui.End()
}

func (a *app) drawOverlay(dl *imgui.DrawList, imin, vmin, vmax imgui.Vec2) {
	green := imgui.ColorU32Vec4(imgui.NewVec4(0, 1, 0, 1))
	yellow := imgui.ColorU32Vec4(imgui.NewVec4(1, 1, 0, 1))
	areaLabel := a.t("col.area") + " "
	labels := 0
	for i := range a.overlay {
		r := &a.overlay[i]
		x0 := imin.X + r.x*a.zoom
		y0 := imin.Y + r.y*a.zoom
		x1 := x0 + r.w*a.zoom
		y1 := y0 + r.h*a.zoom
		if x1 < vmin.X || y1 < vmin.Y || x0 > vmax.X || y0 > vmax.Y {
			continue
		}
		if x1-x0 < 3 {
			cx := (x0 + x1) / 2
			x0, x1 = cx-1.5, cx+1.5
		}
		if y1-y0 < 3 {
			cy := (y0 + y1) / 2
			y0, y1 = cy-1.5, cy+1.5
		}
		col := green
		if r.rejected {
			col = yellow
		}
		dl.AddRectV(v2(x0, y0), v2(x1, y1), col, 0, 1, 0)
		a.drawnOverlay++
		if r.rejected && x1-x0 >= 24 && labels < 200 {
			dl.AddTextVec2(v2(x0+2, y0-15), col, areaLabel+r.area)
			labels++
		}
	}
}

func (a *app) drawRight(x, y, h float32) {
	place(x, y, rightW, h)
	imgui.BeginV("##right", nil, fixedFlags())
	imgui.SeparatorText(a.t("sec.hist"))
	if implot.BeginPlotV("##hist", v2(-1, 150), implot.FlagsCanvasOnly) {
		implot.SetupAxesV("", "", implot.AxisFlagsAutoFit|implot.AxisFlagsNoTickLabels, implot.AxisFlagsAutoFit|implot.AxisFlagsNoTickLabels)
		implot.PlotBarsFloatPtrInt("GV", &a.hist[0], 256)
		implot.EndPlot()
	}
	imgui.SeparatorText(a.t("sec.table"))
	avail := imgui.ContentRegionAvail()
	flags := imgui.TableFlagsRowBg | imgui.TableFlagsBorders | imgui.TableFlagsScrollY | imgui.TableFlagsSizingFixedFit | imgui.TableFlagsResizable
	// Per-language table ID so fixed-fit column widths are re-measured for each script.
	if imgui.BeginTableV("##blobs_"+a.lang, 6, flags, v2(0, avail.Y), 0) {
		imgui.TableSetupScrollFreeze(0, 1)
		for _, k := range []string{"col.id", "col.kind", "col.area", "col.peak", "col.mean", "col.bg"} {
			imgui.TableSetupColumnV(a.t(k), 0, 0, 0)
		}
		imgui.TableHeadersRow()
		if a.scrollTo >= 0 {
			imgui.SetScrollYFloat(a.scrollTo)
			a.scrollTo = -1
		}
		if a.clipper == nil {
			a.clipper = imgui.NewListClipper()
		}
		bright, dark := a.t("bright"), a.t("darkKind")
		a.clipper.Begin(int32(len(a.rows)))
		for a.clipper.Step() {
			for i := a.clipper.DisplayStart(); i < a.clipper.DisplayEnd(); i++ {
				r := &a.rows[i]
				imgui.TableNextRow()
				for c := 0; c < 6; c++ {
					imgui.TableSetColumnIndex(int32(c))
					if c == 1 {
						if r.dark {
							imgui.TextUnformatted(dark)
						} else {
							imgui.TextUnformatted(bright)
						}
						continue
					}
					imgui.TextUnformatted(r.cells[c])
				}
			}
		}
		a.clipper.End()
		imgui.EndTable()
	}
	imgui.End()
}

func last(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	return v[len(v)-1]
}

func (a *app) drawStatus(x, y, w float32) {
	place(x, y, w, statusH)
	visible := imgui.BeginV("##status", nil, fixedFlags()|imgui.WindowFlagsNoScrollbar)
	wp, ws := imgui.WindowPos(), imgui.WindowSize()
	a.statusDebug = fmt.Sprintf("begin=%v req=(%.0f,%.0f %.0fx%d) got=(%.0f,%.0f %.0fx%.0f)", visible, x, y, w, statusH, wp.X, wp.Y, ws.X, ws.Y)
	io := imgui.CurrentIO()
	fps := io.Framerate()
	imgui.TextUnformatted(fmt.Sprintf("FPS %.0f | frame %.2f ms | render %.1f ms | upload %.1f ms | zoom %.1f%% | %s | overlay %d | heap %.0f MB | ImGui %s",
		fps, 1000/math.Max(1, float64(fps)), last(a.renderMs), last(a.uploadMs), a.zoom*100, a.readout, a.drawnOverlay, a.heapMB, imgui.Version()))
	imgui.End()
}

func (a *app) initPhases() {
	a.phases = []phase{
		{name: "warmup", frames: 30},
		{name: "idle", frames: 240},
		{name: "light", frames: -1, enter: func(a *app) { a.lightRuns = 6 }},
		{name: "overlay10k", frames: 240, enter: func(a *app) { a.overlayOn = true; a.needFit = true }},
		{name: "tableScroll", frames: 240},
		{name: "zoom8x", frames: 240, enter: func(a *app) { a.zoomRequest = 8 }},
		{name: "shotDarkZh", frames: 40, enter: func(a *app) { a.lang = "zh"; a.theme = "dark"; a.needFit = true }, shot: "spike-dark-zh.png"},
		{name: "shotLightKo", frames: 40, enter: func(a *app) { a.lang = "ko"; a.theme = "light" }, shot: "spike-light-ko.png"},
		{name: "shotLightEnZoom", frames: 40, enter: func(a *app) { a.lang = "en"; a.zoomRequest = 8 }, shot: "spike-light-en-zoom.png"},
	}
}

func summarize(frames, loops []float64) phaseStat {
	if len(frames) > 1 {
		frames = frames[1:]
	}
	st := phaseStat{Frames: len(frames)}
	if len(frames) == 0 {
		return st
	}
	sorted := append([]float64(nil), frames...)
	sort.Float64s(sorted)
	sum := 0.0
	for _, v := range frames {
		sum += v
	}
	st.MeanMs = sum / float64(len(frames))
	st.P50Ms = sorted[len(sorted)/2]
	st.P95Ms = sorted[int(float64(len(sorted)-1)*0.95)]
	st.MaxMs = sorted[len(sorted)-1]
	st.FPS = 1000 / st.MeanMs
	ls := 0.0
	for _, v := range loops {
		ls += v
	}
	if len(loops) > 0 {
		st.LoopMeanMs = ls / float64(len(loops))
	}
	return st
}

func (a *app) stepSelftest() {
	if a.phaseIdx >= len(a.phases) {
		return
	}
	ph := &a.phases[a.phaseIdx]
	if a.phaseFrame == 0 {
		if ph.name == "warmup" && a.tex == nil {
			if a.loadErr != "" {
				a.finishSelftest()
			}
			return
		}
		if ph.enter != nil {
			ph.enter(a)
		}
		a.frameMs = a.frameMs[:0]
		a.loopMs = a.loopMs[:0]
		a.maxDrawn = 0
	}
	a.phaseFrame++
	if a.drawnOverlay > a.maxDrawn {
		a.maxDrawn = a.drawnOverlay
	}
	if ph.name == "tableScroll" {
		a.scrollTo = float32(a.phaseFrame) * 41
	}
	done := ph.frames > 0 && a.phaseFrame >= ph.frames
	if ph.name == "light" && !a.rendering && !a.lightDirty {
		if a.lightRuns > 0 {
			a.light.Value = 200 + float32(a.lightRuns)*120
			a.lightRuns--
			a.requestRender()
		} else {
			done = true
		}
	}
	if !done {
		return
	}
	st := summarize(a.frameMs, a.loopMs)
	st.Overlay = a.maxDrawn
	a.stats[ph.name] = st
	if ph.shot != "" {
		a.pendingShot = filepath.Join(a.outDir, ph.shot)
	}
	a.phaseIdx++
	a.phaseFrame = 0
	if a.phaseIdx >= len(a.phases) && a.pendingShot == "" {
		a.finishSelftest()
	}
}

func meanOf(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}

func (a *app) finishSelftest() {
	a.finished = true
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	exe, _ := os.Executable()
	var exeSize int64
	if fi, err := os.Stat(exe); err == nil {
		exeSize = fi.Size()
	}
	report := map[string]any{
		"imgui":           imgui.Version(),
		"go":              runtime.Version(),
		"cpus":            runtime.NumCPU(),
		"exeBytes":        exeSize,
		"loadError":       a.loadErr,
		"loadMs":          a.loadMs,
		"firstImageMs":    a.firstImageMs,
		"renderMs":        a.renderMs,
		"uploadMs":        a.uploadMs,
		"renderMeanMs":    meanOf(a.renderMs),
		"uploadMeanMs":    meanOf(a.uploadMs),
		"heapAllocMB":     float64(ms.HeapAlloc) / (1 << 20),
		"sysMB":           float64(ms.Sys) / (1 << 20),
		"phases":          a.stats,
		"screenshots":     a.shots,
		"screenshotError": a.shotErrors,
		"statusWindow":    a.statusDebug,
	}
	if a.scene != nil {
		report["image"] = fmt.Sprintf("%dx%d", a.scene.W, a.scene.H)
	}
	data, _ := json.MarshalIndent(report, "", "  ")
	_ = os.WriteFile(filepath.Join(a.outDir, "spike-metrics.json"), data, 0o644)
	fmt.Println(string(data))
	a.be.SetShouldClose(true)
}
