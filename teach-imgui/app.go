package main

import (
	"fmt"
	"runtime"
	"sort"
	"time"

	"github.com/AllenDang/cimgui-go/backend"
	"github.com/AllenDang/cimgui-go/backend/glfwbackend"
	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

// Panel is one mode tab (light / align / defect). All methods run on the UI thread;
// heavy work goes through App.Jobs and touches panel state only in the apply closure.
type Panel interface {
	ID() string
	Title() string
	// Activate is called when the tab becomes visible (and after a model load if visible);
	// it must put the panel's current image into the viewer.
	Activate()
	Deactivate()
	// ModelLoaded resets panel state for App.Scene (called for every panel, active or not).
	ModelLoaded()
	// LightChanged is called after App.Light, App.Display or App.ShowMaterial changed.
	LightChanged()
	DrawLeft()
	DrawRight()
	Overlay(o *Overlay)
	// Pointer receives left-button drags in image coordinates; return true on PointerDown
	// to own the drag (otherwise the viewer pans).
	Pointer(ev PointerEvent) bool
	// Hover returns the status-bar readout for image pixel (x, y), or "".
	Hover(x, y int) string
	// Selftest seeds demo content for automated screenshots (-selftest).
	Selftest()
}

type panelCtor struct {
	order int
	make  func(*App) Panel
}

var panelCtors []panelCtor

// registerPanel is called from each panel file's init(); order sets the tab position.
func registerPanel(order int, make func(*App) Panel) {
	panelCtors = append(panelCtors, panelCtor{order: order, make: make})
}

// DisplayChannel selects which rendered camera channel the light view shows.
type DisplayChannel int

const (
	DisplayRed DisplayChannel = iota
	DisplayGreen
	DisplayBlue
	DisplayRGB
)

// App owns the shared state: loaded scene, light setting, viewer, job runner and panels.
type App struct {
	be backend.Backend[glfwbackend.GLFWWindowFlags]

	RefRoot  string
	Models   []ModelInfo
	modelIdx int
	Scene    *Scene
	loading  bool
	loadErr  string // raw detail; empty when there is no error
	errKey   string // i18n key rendered with {msg} = loadErr, so it follows language switches

	Light        core.LightSetting
	Display      DisplayChannel
	ShowMaterial bool

	Viewer *Viewer
	Jobs   *Jobs

	panels []Panel
	tab    int

	theme, appliedTheme string

	hint      string
	elapsedMs float64
	start     time.Time
	frame     int
	heapMB    float64
	timings   map[string][]float64

	selftest  *Selftest
	exitAfter time.Duration
}

// NewApp builds the app state and panels; the window/backend is attached by main.
func NewApp(refRoot string, models []ModelInfo, refErr error, theme string) *App {
	a := &App{
		RefRoot:  refRoot,
		Models:   models,
		modelIdx: -1,
		Light:    core.DefaultLightSetting(),
		Viewer:   NewViewer(),
		theme:    theme,
		start:    time.Now(),
		timings:  map[string][]float64{},
	}
	a.Jobs = NewJobs(func(err error) { a.SetHint(T("common.error", "msg", err.Error())) })
	sort.SliceStable(panelCtors, func(i, j int) bool { return panelCtors[i].order < panelCtors[j].order })
	for _, c := range panelCtors {
		a.panels = append(a.panels, c.make(a))
	}
	switch {
	case refErr != nil:
		a.loadErr, a.errKey = refErr.Error(), "msg.noReference"
	case len(models) == 0:
		a.loadErr, a.errKey = refRoot, "msg.noModels"
	}
	return a
}

// SetHint shows a message in the status bar.
func (a *App) SetHint(s string) { a.hint = s }

// SetElapsed shows a computation time in the status bar.
func (a *App) SetElapsed(ms float64) { a.elapsedMs = ms }

// CameraChannel maps the display selection to a render channel (RGB → Red for
// single-channel consumers such as alignment and estimation).
func (a *App) CameraChannel() core.CameraChannel {
	switch a.Display {
	case DisplayGreen:
		return core.ChGreen
	case DisplayBlue:
		return core.ChBlue
	}
	return core.ChRed
}

// NotifyLightChanged tells every panel the shared light setting or display changed.
func (a *App) NotifyLightChanged() {
	for _, p := range a.panels {
		p.LightChanged()
	}
}

// ActivePanel returns the visible panel.
func (a *App) ActivePanel() Panel {
	if a.tab < 0 || a.tab >= len(a.panels) {
		return nil
	}
	return a.panels[a.tab]
}

// IsActive reports whether p is the visible panel.
func (a *App) IsActive(p Panel) bool { return a.ActivePanel() == p }

func (a *App) switchTab(i int) {
	if i == a.tab || i < 0 || i >= len(a.panels) {
		return
	}
	if p := a.ActivePanel(); p != nil {
		p.Deactivate()
	}
	a.tab = i
	a.hint = ""
	if a.Scene != nil {
		a.panels[i].Activate()
	}
}

// LoadModel loads models[i] in the background; panels are reset when it completes.
func (a *App) LoadModel(i int) {
	if i < 0 || i >= len(a.Models) || a.loading {
		return
	}
	a.loading = true
	a.loadErr = ""
	info := a.Models[i]
	a.Jobs.Run("load", func() func() {
		scene, err := LoadScene(info)
		return func() {
			a.loading = false
			if err != nil {
				// Keep the previous scene and its model selection; only report the failure.
				a.loadErr, a.errKey = err.Error(), "status.loadFailed"
				return
			}
			a.modelIdx = i
			if p := a.ActivePanel(); p != nil && a.Scene != nil {
				p.Deactivate()
			}
			a.Scene = scene
			a.Viewer.Clear()
			for _, p := range a.panels {
				p.ModelLoaded()
			}
			if p := a.ActivePanel(); p != nil {
				p.Activate()
			}
		}
	})
}

// Frame builds one UI frame.
func (a *App) Frame() {
	a.frame++
	if a.frame%60 == 0 {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		a.heapMB = float64(ms.HeapAlloc) / (1 << 20)
	}
	for _, t := range a.Jobs.Poll() {
		if a.selftest != nil {
			// Only the self-test report consumes timings; do not grow without bound otherwise.
			a.timings[t.Key] = append(a.timings[t.Key], t.Ms)
		}
		if t.Key != "load" {
			a.elapsedMs = t.Ms
		}
	}
	if a.appliedTheme != a.theme {
		ApplyTheme(a.theme)
		a.appliedTheme = a.theme
	}
	vp := imgui.MainViewport()
	p, sz := vp.WorkPos(), vp.WorkSize()
	const topH, statusH, leftW, rightW = 32, 24, 340, 380
	bodyH := sz.Y - topH - statusH
	a.drawToolbar(p.X, p.Y, sz.X, topH)
	panel := a.ActivePanel()
	ready := a.Scene != nil && panel != nil

	place(p.X, p.Y+topH, leftW, bodyH)
	imgui.BeginV("##left", nil, fixedWindowFlags())
	if ready {
		panel.DrawLeft()
	}
	imgui.End()

	place(p.X+sz.X-rightW, p.Y+topH, rightW, bodyH)
	imgui.BeginV("##right", nil, fixedWindowFlags())
	if ready {
		panel.DrawRight()
	}
	imgui.End()

	place(p.X+leftW, p.Y+topH, sz.X-leftW-rightW, bodyH)
	imgui.PushStyleVarVec2(imgui.StyleVarWindowPadding, imgui.NewVec2(0, 0))
	imgui.BeginV("##viewer", nil, fixedWindowFlags()|imgui.WindowFlagsNoScrollbar|imgui.WindowFlagsNoScrollWithMouse)
	imgui.PopStyleVar()
	if ready {
		a.Viewer.Draw(panel.Overlay, panel.Pointer)
	} else {
		a.drawCenterMessage()
	}
	imgui.End()

	a.drawStatus(p.X, p.Y+sz.Y-statusH, sz.X, statusH)
}

func fixedWindowFlags() imgui.WindowFlags {
	return imgui.WindowFlagsNoTitleBar | imgui.WindowFlagsNoResize | imgui.WindowFlagsNoMove |
		imgui.WindowFlagsNoCollapse | imgui.WindowFlagsNoSavedSettings | imgui.WindowFlagsNoBringToFrontOnFocus
}

func place(x, y, w, h float32) {
	imgui.SetNextWindowPosV(imgui.NewVec2(x, y), imgui.CondAlways, imgui.NewVec2(0, 0))
	imgui.SetNextWindowSizeV(imgui.NewVec2(w, h), imgui.CondAlways)
}

func (a *App) drawCenterMessage() {
	msg := T("status.loading")
	if a.loadErr != "" {
		msg = T(a.errKey, "msg", a.loadErr)
	}
	pos := imgui.CursorScreenPos()
	avail := imgui.ContentRegionAvail()
	dl := imgui.WindowDrawList()
	dl.AddRectFilled(pos, imgui.NewVec2(pos.X+avail.X, pos.Y+avail.Y), CurrentPalette().Workspace)
	imgui.SetCursorScreenPos(imgui.NewVec2(pos.X+24, pos.Y+24))
	imgui.PushTextWrapPosV(avail.X - 24)
	imgui.TextUnformatted(msg)
	imgui.PopTextWrapPos()
}

func (a *App) drawToolbar(x, y, w, h float32) {
	place(x, y, w, h)
	imgui.PushStyleVarVec2(imgui.StyleVarWindowPadding, imgui.NewVec2(0, 4))
	imgui.BeginV("##toolbar", nil, fixedWindowFlags()|imgui.WindowFlagsNoScrollbar)
	imgui.PopStyleVar()

	// Brand block in the title-bar color.
	title := T("app.title")
	ts := imgui.CalcTextSize(title)
	bp := imgui.NewVec2(x, y)
	dl := imgui.WindowDrawList()
	c := imgui.CurrentStyle().Colors()
	dl.AddRectFilled(bp, imgui.NewVec2(bp.X+ts.X+20, bp.Y+h), imgui.ColorU32Vec4(c[imgui.ColTitleBgActive]))
	dl.AddTextVec2(imgui.NewVec2(bp.X+10, bp.Y+(h-ts.Y)/2), rgba(255, 255, 255, 255), title)
	imgui.SetCursorScreenPos(imgui.NewVec2(bp.X+ts.X+30, bp.Y+4))

	imgui.AlignTextToFramePadding()
	imgui.TextUnformatted(T("top.model"))
	imgui.SameLine()
	imgui.SetNextItemWidth(220)
	preview := ""
	if a.modelIdx >= 0 {
		preview = a.Models[a.modelIdx].ID + " · " + a.Models[a.modelIdx].Version
	}
	if imgui.BeginCombo("##model", preview) {
		for i, m := range a.Models {
			if imgui.SelectableBoolV(m.ID+" · "+m.Version+"##m"+fmt.Sprint(i), i == a.modelIdx, 0, imgui.NewVec2(0, 0)) && i != a.modelIdx {
				a.LoadModel(i)
			}
		}
		imgui.EndCombo()
	}
	imgui.SameLine()
	status := ""
	switch {
	case a.loading:
		status = T("status.loading")
	case a.Scene != nil:
		status = T("status.loaded", "w", a.Scene.W, "h", a.Scene.H, "ms", F(a.Scene.LoadMs, 0))
	}
	imgui.TextUnformatted(status)

	for i, p := range a.panels {
		imgui.SameLine()
		if ToolButton(p.Title(), "tab-"+p.ID(), i == a.tab) {
			a.switchTab(i)
		}
	}

	imgui.SameLine()
	imgui.TextUnformatted("  " + T("top.theme"))
	imgui.SameLine()
	imgui.SetNextItemWidth(130)
	themes := []string{ThemeDark, ThemeLight}
	if imgui.BeginCombo("##theme", T("theme."+a.theme)) {
		for _, th := range themes {
			if imgui.SelectableBoolV(T("theme."+th)+"##"+th, th == a.theme, 0, imgui.NewVec2(0, 0)) {
				a.theme = th
			}
		}
		imgui.EndCombo()
	}
	imgui.SameLine()
	imgui.TextUnformatted(T("top.lang"))
	imgui.SameLine()
	imgui.SetNextItemWidth(100)
	langLabel := ""
	for _, l := range Langs {
		if l.Code == CurrentLang() {
			langLabel = l.Label
		}
	}
	if imgui.BeginCombo("##lang", langLabel) {
		for _, l := range Langs {
			if imgui.SelectableBoolV(l.Label+"##"+string(l.Code), l.Code == CurrentLang(), 0, imgui.NewVec2(0, 0)) {
				SetLang(l.Code)
			}
		}
		imgui.EndCombo()
	}
	imgui.End()
}

func (a *App) drawStatus(x, y, w, h float32) {
	place(x, y, w, h)
	imgui.PushStyleVarVec2(imgui.StyleVarWindowPadding, imgui.NewVec2(6, 3))
	imgui.BeginV("##status", nil, fixedWindowFlags()|imgui.WindowFlagsNoScrollbar)
	imgui.PopStyleVar()
	xy, gv := "XY —", "GV —"
	if mx, my, in := a.Viewer.Mouse(); in && a.Scene != nil {
		ix, iy := int(mx), int(my)
		xy = fmt.Sprintf("XY %d, %d", ix, iy)
		if p := a.ActivePanel(); p != nil {
			if s := p.Hover(ix, iy); s != "" {
				gv = s
			}
		}
	}
	elapsed := T("status.elapsedNone")
	if a.elapsedMs > 0 {
		elapsed = T("status.elapsed", "ms", F(a.elapsedMs, 1))
	}
	hint := a.hint
	if a.Jobs.AnyBusy() {
		hint = T("status.busy") + "  " + hint
	}
	parts := []string{xy, gv, T("status.zoom", "pct", F(float64(a.Viewer.Zoom())*100, 0)), elapsed,
		fmt.Sprintf("%.0f fps", imgui.CurrentIO().Framerate()), fmt.Sprintf("heap %.0f MB", a.heapMB)}
	for i, s := range parts {
		if i > 0 {
			imgui.SameLine()
			imgui.TextUnformatted("|")
			imgui.SameLine()
		}
		imgui.TextUnformatted(s)
	}
	if hint != "" {
		imgui.SameLine()
		imgui.TextUnformatted("|  " + hint)
	}
	imgui.End()
}
