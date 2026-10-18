package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

// Selftest drives the app through every tab, theme and language, waits until background
// jobs settle, saves screenshots and a metrics JSON, then closes the window.
type Selftest struct {
	a           *App
	out         string
	steps       []selftestStep
	idx         int
	frames      int
	quiet       int
	stepStart   time.Time
	frameStart  time.Time
	frameMs     []float64
	results     map[string]any
	shots       []string
	errors      []string
	pendingShot string
	capturing   bool
	finished    bool
	deadline    time.Time
	seq         []viewerInput
	seqIdx      int
}

type selftestStep struct {
	name  string
	enter func(a *App)
	shot  string
	// input is fed to the viewer one frame at a time after enter; check runs once jobs settle.
	input func(s *Selftest) []viewerInput
	check func(s *Selftest) (map[string]any, error)
}

func (s *Selftest) canvasCenter() imgui.Vec2 {
	o, sz := s.a.Viewer.Canvas()
	return imgui.NewVec2(o.X+sz.X/2, o.Y+sz.Y/2)
}

// dragInput builds a press-move-release sequence for button btn starting at from.
func dragInput(btn int, from, d imgui.Vec2, steps int) []viewerInput {
	seq := []viewerInput{{mouse: from, hovered: true}}
	press := viewerInput{mouse: from, hovered: true}
	press.clicked[btn], press.down[btn] = true, true
	seq = append(seq, press)
	for k := 1; k <= steps; k++ {
		f := float32(k) / float32(steps)
		in := viewerInput{mouse: imgui.NewVec2(from.X+d.X*f, from.Y+d.Y*f), delta: imgui.NewVec2(d.X/float32(steps), d.Y/float32(steps)), hovered: true}
		in.down[btn] = true
		seq = append(seq, in)
	}
	release := viewerInput{mouse: imgui.NewVec2(from.X+d.X, from.Y+d.Y), hovered: true}
	release.released[btn] = true
	return append(seq, release, viewerInput{mouse: imgui.NewVec2(from.X+d.X, from.Y+d.Y), hovered: true})
}

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

func (s *Selftest) panel(id string) Panel {
	for _, p := range s.a.panels {
		if p.ID() == id {
			return p
		}
	}
	return nil
}

// NewSelftest prepares the scripted run.
func NewSelftest(a *App, out string) *Selftest {
	s := &Selftest{a: a, out: out, results: map[string]any{}, deadline: time.Now().Add(180 * time.Second)}
	tab := func(id string) func(a *App) {
		return func(a *App) {
			for i, p := range a.panels {
				if p.ID() == id {
					a.switchTab(i)
					p.Selftest()
				}
			}
		}
	}
	var zoom0, panX0, panY0 float32
	var rois0, strokes0 int
	s.steps = []selftestStep{
		{name: "load"},
		{name: "light-dark-zh", enter: func(a *App) { a.theme = ThemeDark; SetLang(LangZh); tab("light")(a) }, shot: "native-light-dark-zh.png"},
		{name: "interact-viewer", input: func(s *Selftest) []viewerInput {
			v := s.a.Viewer
			zoom0 = v.zoom
			c := s.canvasCenter()
			seq := []viewerInput{{mouse: c, hovered: true}, {mouse: c, wheel: 1, hovered: true}, {mouse: c, hovered: true}}
			return seq
		}, check: func(s *Selftest) (map[string]any, error) {
			v := s.a.Viewer
			ratio := float64(v.zoom / zoom0)
			panX0, panY0 = v.panX, v.panY
			if !near(ratio, 1.2, 1e-4) {
				return nil, fmt.Errorf("wheel zoom ratio %.5f, want 1.2", ratio)
			}
			return map[string]any{"wheelZoomRatio": ratio}, nil
		}},
		{name: "interact-pan", input: func(s *Selftest) []viewerInput {
			return dragInput(btnMiddle, s.canvasCenter(), imgui.NewVec2(80, -40), 4)
		}, check: func(s *Selftest) (map[string]any, error) {
			v := s.a.Viewer
			dx, dy := float64(v.panX-panX0), float64(v.panY-panY0)
			if !near(dx, 80, 0.01) || !near(dy, -40, 0.01) {
				return nil, fmt.Errorf("middle-drag pan (%.2f, %.2f), want (80, -40)", dx, dy)
			}
			return map[string]any{"panDx": dx, "panDy": dy}, nil
		}},
		{name: "interact-measure", input: func(s *Selftest) []viewerInput {
			return dragInput(btnLeft, s.canvasCenter(), imgui.NewVec2(100, 80), 5)
		}, check: func(s *Selftest) (map[string]any, error) {
			lp := s.panel("light").(*LightPanel)
			z := float64(s.a.Viewer.zoom)
			if lp.measure == nil {
				return nil, fmt.Errorf("left drag did not create a measure box")
			}
			if !near(lp.measure.W, 100/z, 0.01) || !near(lp.measure.H, 80/z, 0.01) {
				return nil, fmt.Errorf("measure box %.2f×%.2f, want %.2f×%.2f", lp.measure.W, lp.measure.H, 100/z, 80/z)
			}
			if len(lp.stats) == 0 || lp.stats[0].stats.Roi.W != math.Ceil(lp.measure.X+lp.measure.W)-math.Floor(lp.measure.X) {
				return nil, fmt.Errorf("measure statistics not updated for the dragged box")
			}
			return map[string]any{"measureW": lp.measure.W, "measureH": lp.measure.H, "pixels": lp.stats[0].stats.Pixels}, nil
		}},
		{name: "align-dark-zh", enter: tab("align"), shot: "native-align-dark-zh.png"},
		{name: "interact-align-roi", enter: func(a *App) {
			ap := s.panel("align").(*AlignPanel)
			rois0 = len(ap.rois)
			ap.tool = "roi"
		}, input: func(s *Selftest) []viewerInput {
			c := s.canvasCenter()
			return dragInput(btnLeft, imgui.NewVec2(c.X-30, c.Y-30), imgui.NewVec2(60, 50), 4)
		}, check: func(s *Selftest) (map[string]any, error) {
			ap := s.panel("align").(*AlignPanel)
			if len(ap.rois) != rois0+1 || ap.tool != "none" {
				return nil, fmt.Errorf("ROI tool drag: rois %d→%d, tool %q", rois0, len(ap.rois), ap.tool)
			}
			last := ap.rois[len(ap.rois)-1]
			if ap.report == nil || len(ap.report.Matches) != len(ap.rois) {
				return nil, fmt.Errorf("alignment did not re-run with the new ROI")
			}
			// Remove the probe ROI so the screenshots show the machine ROIs only.
			ap.rois = ap.rois[:rois0]
			ap.dirty = true
			ap.requestRun(true)
			return map[string]any{"newRoi": fmt.Sprintf("%.0f,%.0f %.0f×%.0f", last.X, last.Y, last.W, last.H)}, nil
		}},
		{name: "defect-dark-zh", enter: tab("defect"), shot: "native-defect-dark-zh.png"},
		{name: "interact-defect-rect", enter: func(a *App) {
			dp := s.panel("defect").(*DefectPanel)
			strokes0 = len(dp.strokes)
			dp.tool = toolBrightRect
		}, input: func(s *Selftest) []viewerInput {
			c := s.canvasCenter()
			return dragInput(btnLeft, imgui.NewVec2(c.X+40, c.Y+40), imgui.NewVec2(30, 20), 3)
		}, check: func(s *Selftest) (map[string]any, error) {
			dp := s.panel("defect").(*DefectPanel)
			if len(dp.strokes) != strokes0+1 || dp.tool != toolNone {
				return nil, fmt.Errorf("rect tool drag: strokes %d→%d", strokes0, len(dp.strokes))
			}
			st := dp.strokes[len(dp.strokes)-1].gv
			if st == nil || st.Shape != core.ShapeRect || dp.renderRev != dp.renderedRev {
				return nil, fmt.Errorf("rect stroke not rendered")
			}
			return map[string]any{"rect": fmt.Sprintf("%.0f,%.0f→%.0f,%.0f", st.X, st.Y, st.X2, st.Y2), "detected": dp.lastReport.DetectedCount}, nil
		}},
		{name: "interact-defect-probe", enter: func(a *App) {
			s.panel("defect").(*DefectPanel).tool = toolProbe
		}, input: func(s *Selftest) []viewerInput {
			c := s.canvasCenter()
			return dragInput(btnLeft, imgui.NewVec2(c.X+30, c.Y+30), imgui.NewVec2(50, 40), 3)
		}, check: func(s *Selftest) (map[string]any, error) {
			dp := s.panel("defect").(*DefectPanel)
			if dp.lastProbe == nil || dp.probeRect == nil || dp.lastProbe.Pixels == 0 {
				return nil, fmt.Errorf("probe drag produced no probe report")
			}
			return map[string]any{"probePixels": dp.lastProbe.Pixels, "wouldDetectBright": dp.lastProbe.WouldDetectBright}, nil
		}},
		{name: "defect-light-en", enter: func(a *App) { a.theme = ThemeLight; SetLang(LangEn) }, shot: "native-defect-light-en.png"},
		{name: "align-light-ko", enter: func(a *App) { SetLang(LangKo); tab("align")(a) }, shot: "native-align-light-ko.png"},
		{name: "light-light-ko", enter: tab("light"), shot: "native-light-light-ko.png"},
	}
	return s
}

// Step advances the script; called once per frame after the UI is built.
func (s *Selftest) Step() {
	if s.finished || s.pendingShot != "" || s.capturing {
		return
	}
	now := time.Now()
	if !s.frameStart.IsZero() {
		s.frameMs = append(s.frameMs, float64(now.Sub(s.frameStart).Microseconds())/1000)
	}
	s.frameStart = now
	if now.After(s.deadline) {
		s.errors = append(s.errors, "timeout in step "+s.steps[s.idx].name)
		s.finish()
		return
	}
	st := s.steps[s.idx]
	if s.frames == 0 {
		s.stepStart = now
		s.frameMs = s.frameMs[:0]
		if st.enter != nil {
			st.enter(s.a)
		}
		s.seq, s.seqIdx = nil, 0
		if st.input != nil {
			s.seq = st.input(s)
		}
	}
	s.frames++
	if s.seqIdx < len(s.seq) {
		// Injected input is consumed by the viewer on the next frame.
		s.a.Viewer.Inject(s.seq[s.seqIdx])
		s.seqIdx++
		s.quiet = 0
		return
	}
	if st.name == "load" && s.a.Scene == nil {
		if s.a.loadErr != "" && !s.a.loading {
			s.errors = append(s.errors, s.a.loadErr)
			s.finish()
		}
		return
	}
	if s.a.Jobs.AnyBusy() || s.a.loading {
		s.quiet = 0
		return
	}
	s.quiet++
	if s.quiet < 15 || s.frames < 20 {
		return
	}
	res := map[string]any{
		"settleMs":     float64(time.Since(s.stepStart).Microseconds()) / 1000,
		"frames":       s.frames,
		"frameMeanMs":  mean(s.frameMs),
		"frameP95Ms":   percentile(s.frameMs, 0.95),
		"viewerHasImg": s.a.Viewer.HasImage(),
	}
	if st.check != nil {
		detail, err := st.check(s)
		if err != nil {
			s.errors = append(s.errors, st.name+": "+err.Error())
			res["pass"] = false
		} else {
			res["pass"] = true
		}
		for k, v := range detail {
			res[k] = v
		}
	}
	s.results[st.name] = res
	if st.shot != "" {
		s.pendingShot = filepath.Join(s.out, st.shot)
	}
	s.idx++
	s.frames, s.quiet = 0, 0
	if s.idx >= len(s.steps) && s.pendingShot == "" {
		s.finish()
	}
}

// AfterRender takes a pending screenshot between frames (PrintWindow re-enters the GLFW
// refresh callback, so it must not run inside a frame).
func (s *Selftest) AfterRender() {
	if s.pendingShot == "" || s.capturing {
		return
	}
	path := s.pendingShot
	s.capturing = true
	if err := captureWindow(WindowTitle, path); err != nil {
		s.errors = append(s.errors, filepath.Base(path)+": "+err.Error())
	} else {
		s.shots = append(s.shots, path)
	}
	s.capturing = false
	s.pendingShot = ""
	if s.idx >= len(s.steps) && !s.finished {
		s.finish()
	}
}

func (s *Selftest) finish() {
	s.finished = true
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	jobs := map[string]any{}
	for k, v := range s.a.timings {
		jobs[k] = map[string]any{"count": len(v), "meanMs": mean(v), "maxMs": percentile(v, 1)}
	}
	report := map[string]any{
		"imgui":        imgui.Version(),
		"go":           runtime.Version(),
		"cpus":         runtime.NumCPU(),
		"reference":    s.a.RefRoot,
		"models":       len(s.a.Models),
		"steps":        s.results,
		"jobs":         jobs,
		"heapAllocMB":  float64(ms.HeapAlloc) / (1 << 20),
		"sysMB":        float64(ms.Sys) / (1 << 20),
		"screenshots":  s.shots,
		"errors":       s.errors,
		"totalSeconds": time.Since(s.a.start).Seconds(),
	}
	if s.a.Scene != nil {
		report["model"] = s.a.Scene.Info.ID
		report["image"] = fmt.Sprintf("%dx%d", s.a.Scene.W, s.a.Scene.H)
		report["loadMs"] = s.a.Scene.LoadMs
		report["machineRois"] = len(s.a.Scene.MachineRois)
	}
	data, _ := json.MarshalIndent(report, "", "  ")
	_ = os.WriteFile(filepath.Join(s.out, "native-metrics.json"), data, 0o644)
	fmt.Println(string(data))
	s.a.be.SetShouldClose(true)
}

func mean(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range v {
		sum += x
	}
	return sum / float64(len(v))
}

func percentile(v []float64, q float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	i := int(float64(len(s)-1) * q)
	return s[i]
}
