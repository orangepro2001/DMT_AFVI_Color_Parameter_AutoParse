package main

import (
	"fmt"
	"math"

	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

func init() {
	registerPanel(0, func(a *App) Panel { return &LightPanel{a: a} })
	Messages(map[string]string{
		"light.section.light":       "光源",
		"light.section.channel":     "相机通道",
		"light.section.render":      "渲染",
		"light.section.reflectance": "反射率",
		"light.section.tools":       "工具",
		"light.section.stats":       "GV 统计",
		"light.section.material":    "材料",
		"light.display":             "显示",
		"light.showMaterial":        "显示材料图",
		"light.gain":                "增益",
		"light.offset":              "偏移",
		"light.texture":             "纹理强度",
		"light.material":            "材料",
		"light.restore":             "恢复默认",
		"light.estimate":            "由 MEDIAN 反推当前通道",
		"light.estimateNote":        "假设 MEDIAN 在当前光照下拍摄，仅作初值。",
		"light.measureNote":         "在视图上左键拖框测量 GV；未框选时统计整幅图。",
		"light.clear":               "清除测量框",
		"light.col.material":        "材料",
		"light.col.pixels":          "像素数",
		"light.col.mean":            "MEDIAN 均值",
		"light.col.channel":         "通道",
		"light.col.avg":             "均值",
		"light.col.std":             "标准差",
		"light.col.min":             "最小",
		"light.col.max":             "最大",
		"light.col.pixel":           "像素",
		"light.col.satHigh":         "饱和255",
		"light.col.satLow":          "截断0",
		"light.noStats":             "尚无测量结果。",
		"light.roi":                 "统计范围 {x},{y} {w}×{h}",
	}, map[string]string{
		"light.section.light":       "Light Source",
		"light.section.channel":     "Camera Channel",
		"light.section.render":      "Rendering",
		"light.section.reflectance": "Reflectance",
		"light.section.tools":       "Tools",
		"light.section.stats":       "GV Statistics",
		"light.section.material":    "Material",
		"light.display":             "Display",
		"light.showMaterial":        "Show material map",
		"light.gain":                "Gain",
		"light.offset":              "Offset",
		"light.texture":             "Texture Strength",
		"light.material":            "Material",
		"light.restore":             "Restore Defaults",
		"light.estimate":            "Estimate current channel from MEDIAN",
		"light.estimateNote":        "Assumes MEDIAN was captured under current lighting; initial value only.",
		"light.measureNote":         "Drag a box with the left button on the view to measure GV; without a box the whole image is measured.",
		"light.clear":               "Clear Measure Box",
		"light.col.material":        "Material",
		"light.col.pixels":          "Pixels",
		"light.col.mean":            "MEDIAN Mean",
		"light.col.channel":         "Channel",
		"light.col.avg":             "Mean",
		"light.col.std":             "Std Dev",
		"light.col.min":             "Min",
		"light.col.max":             "Max",
		"light.col.pixel":           "Pixels",
		"light.col.satHigh":         "Sat 255",
		"light.col.satLow":          "Clip 0",
		"light.noStats":             "No measurement results yet.",
		"light.roi":                 "Region {x},{y} {w}×{h}",
	}, map[string]string{
		"light.section.light":       "조명",
		"light.section.channel":     "카메라 채널",
		"light.section.render":      "렌더링",
		"light.section.reflectance": "반사율",
		"light.section.tools":       "도구",
		"light.section.stats":       "GV 통계",
		"light.section.material":    "재료",
		"light.display":             "표시",
		"light.showMaterial":        "재료 맵 표시",
		"light.gain":                "게인",
		"light.offset":              "오프셋",
		"light.texture":             "텍스처 강도",
		"light.material":            "재료",
		"light.restore":             "기본값 복원",
		"light.estimate":            "MEDIAN 에서 현재 채널 역산",
		"light.estimateNote":        "MEDIAN 이 현재 조명에서 촬영되었다고 가정하며 초기값으로만 사용합니다.",
		"light.measureNote":         "뷰에서 좌클릭으로 박스를 드래그하여 GV 를 측정합니다. 박스가 없으면 전체 이미지를 측정합니다.",
		"light.clear":               "측정 박스 지우기",
		"light.col.material":        "재료",
		"light.col.pixels":          "픽셀 수",
		"light.col.mean":            "MEDIAN 평균",
		"light.col.channel":         "채널",
		"light.col.avg":             "평균",
		"light.col.std":             "표준편차",
		"light.col.min":             "최소",
		"light.col.max":             "최대",
		"light.col.pixel":           "픽셀",
		"light.col.satHigh":         "포화 255",
		"light.col.satLow":          "클립 0",
		"light.noStats":             "아직 측정 결과가 없습니다.",
		"light.roi":                 "측정 범위 {x},{y} {w}×{h}",
	})
}

var channelNames = [3]string{"Red", "Green", "Blue"}
var lightColorNames = [4]string{"Red", "Green", "Blue", "White"}

type channelStat struct {
	ch    core.CameraChannel
	stats core.GvStats
}

// LightPanel renders the scene under the shared light setting (CPU, all cores) and
// measures GV statistics in a dragged box. It is the reference layout for other panels.
type LightPanel struct {
	a         *App
	active    bool
	measure   *core.Rect
	dragging  bool
	dragStart core.Point
	dragCur   core.Point
	stats     []channelStat
}

func (p *LightPanel) ID() string    { return "light" }
func (p *LightPanel) Title() string { return T("tab.light") }

func (p *LightPanel) Activate() {
	p.active = true
	p.requestRender()
	p.requestMeasure()
}

func (p *LightPanel) Deactivate() {
	p.active = false
	p.dragging = false
}

func (p *LightPanel) ModelLoaded() {
	p.measure = nil
	p.stats = nil
	p.dragging = false
}

func (p *LightPanel) LightChanged() {
	if p.active {
		p.requestRender()
		p.requestMeasure()
	}
}

func (p *LightPanel) Selftest() {
	s := p.a.Scene
	r := core.Rect{X: float64(s.W) * 0.35, Y: float64(s.H) * 0.35, W: float64(s.W) * 0.3, H: float64(s.H) * 0.25}
	p.measure = &r
	p.requestMeasure()
}

// requestRender re-renders the light view: material map, one channel, or RGB composite.
func (p *LightPanel) requestRender() {
	a := p.a
	scene := a.Scene
	if scene == nil {
		return
	}
	setting := a.Light.Clone()
	display, showMaterial := a.Display, a.ShowMaterial
	a.Jobs.Run("light-render", func() func() {
		var pix []byte
		switch {
		case showMaterial:
			pix = PackMaterial(scene.Material)
		case display == DisplayRGB:
			r := core.RenderChannel(scene.Light, &setting, core.ChRed)
			g := core.RenderChannel(scene.Light, &setting, core.ChGreen)
			b := core.RenderChannel(scene.Light, &setting, core.ChBlue)
			pix = PackRGB(r, g, b)
		default:
			ch := core.CameraChannel(display)
			pix = PackGray(core.RenderChannel(scene.Light, &setting, ch))
		}
		return func() {
			if a.Scene != scene || !p.active {
				PutRGBA(pix)
				return
			}
			a.Viewer.SetImage(scene.W, scene.H, pix)
		}
	})
}

func clampRect(r core.Rect, w, h int) (x0, y0, rw, rh int) {
	x0 = int(math.Min(math.Floor(math.Max(r.X, 0)), float64(w-1)))
	y0 = int(math.Min(math.Floor(math.Max(r.Y, 0)), float64(h-1)))
	x1 := int(math.Min(math.Max(math.Ceil(r.X+r.W), float64(x0+1)), float64(w)))
	y1 := int(math.Min(math.Max(math.Ceil(r.Y+r.H), float64(y0+1)), float64(h)))
	return x0, y0, x1 - x0, y1 - y0
}

func subScene(s *core.LightScene, x, y, w, h int) *core.LightScene {
	out := &core.LightScene{Width: w, Height: h, Material: make([]uint8, w*h), Texture: make([]float32, w*h)}
	for row := 0; row < h; row++ {
		src := (y+row)*s.Width + x
		copy(out.Material[row*w:(row+1)*w], s.Material[src:src+w])
		copy(out.Texture[row*w:(row+1)*w], s.Texture[src:src+w])
	}
	return out
}

// requestMeasure renders only the measured region (whole image when no box) per channel,
// matching the web worker's measure handler.
func (p *LightPanel) requestMeasure() {
	a := p.a
	scene := a.Scene
	if scene == nil {
		return
	}
	setting := a.Light.Clone()
	rect := core.Rect{W: float64(scene.W), H: float64(scene.H)}
	if p.measure != nil {
		rect = *p.measure
	}
	channels := []core.CameraChannel{a.CameraChannel()}
	if a.Display == DisplayRGB {
		channels = []core.CameraChannel{core.ChRed, core.ChGreen, core.ChBlue}
	}
	a.Jobs.Run("light-measure", func() func() {
		x, y, w, h := clampRect(rect, scene.W, scene.H)
		sub := subScene(scene.Light, x, y, w, h)
		var out []channelStat
		for _, ch := range channels {
			img := core.RenderChannel(sub, &setting, ch)
			st, err := core.MeasureGv(img, core.Rect{W: float64(w), H: float64(h)})
			if err != nil {
				continue
			}
			st.Roi = core.Rect{X: float64(x), Y: float64(y), W: float64(w), H: float64(h)}
			out = append(out, channelStat{ch: ch, stats: st})
		}
		return func() {
			if a.Scene == scene {
				p.stats = out
			}
		}
	})
}

func (p *LightPanel) requestEstimate() {
	a := p.a
	scene := a.Scene
	setting := a.Light.Clone()
	ch := a.CameraChannel()
	a.Jobs.Run("light-estimate", func() func() {
		vals, ok, err := core.EstimateReflectance(scene.Median, scene.Light, &setting, ch)
		return func() {
			if err != nil {
				a.SetHint(T("common.error", "msg", err.Error()))
				return
			}
			if a.Scene != scene {
				return
			}
			for m := 0; m < 4; m++ {
				if ok[m] {
					a.Light.Reflectance[m][ch] = math.Min(2, math.Max(0, vals[m]))
				}
			}
			a.NotifyLightChanged()
		}
	})
}

func (p *LightPanel) DrawLeft() {
	a := p.a
	changed := false
	if Section(T("light.section.light"), "light-src") {
		for i := range a.Light.Channels {
			ch := &a.Light.Channels[i]
			imgui.PushIDInt(int32(i))
			if imgui.Checkbox("##en", &ch.Enable) {
				changed = true
			}
			imgui.SameLine()
			name := lightColorNames[0]
			if int(ch.Color) < len(lightColorNames) {
				name = lightColorNames[ch.Color]
			}
			imgui.AlignTextToFramePadding()
			imgui.TextUnformatted(name)
			imgui.SameLineV(labelWidth, -1)
			imgui.SetNextItemWidth(-1)
			v := int32(ch.Value)
			if imgui.SliderIntV("##val", &v, 0, 1024, "%d", imgui.SliderFlagsAlwaysClamp) {
				ch.Value = float64(v)
				if v > 0 {
					ch.Enable = true
				}
				changed = true
			}
			imgui.PopID()
		}
	}
	if Section(T("light.section.channel"), "light-ch") {
		display := int(a.Display)
		if Combo(T("light.display"), "display", &display, []string{"Red", "Green", "Blue", "RGB"}) {
			a.Display = DisplayChannel(display)
			changed = true
		}
		if Check(T("light.showMaterial"), "showmat", &a.ShowMaterial) {
			changed = true
		}
	}
	if Section(T("light.section.render"), "light-render") {
		changed = SliderF64(T("light.gain"), "gain", &a.Light.Gain, 0, 4, "%.2f") || changed
		changed = SliderF64(T("light.offset"), "offset", &a.Light.Offset, -100, 100, "%.0f") || changed
		changed = SliderF64(T("light.texture"), "texture", &a.Light.TextureStrength, 0, 1, "%.2f") || changed
	}
	if Section(T("light.section.reflectance"), "light-refl") {
		if imgui.BeginTableV("##refl", 4, imgui.TableFlagsSizingStretchProp, imgui.NewVec2(0, 0), 0) {
			imgui.TableSetupColumnV(T("light.material"), 0, 1.2, 0)
			for _, n := range []string{"R", "G", "B"} {
				imgui.TableSetupColumnV(n, 0, 1, 0)
			}
			imgui.TableHeadersRow()
			for m := 0; m < 4; m++ {
				imgui.TableNextRow()
				imgui.TableSetColumnIndex(0)
				imgui.AlignTextToFramePadding()
				imgui.TextUnformatted(core.MaterialNames[m])
				for c := 0; c < 3; c++ {
					imgui.TableSetColumnIndex(int32(c + 1))
					imgui.SetNextItemWidth(-1)
					v := float32(a.Light.Reflectance[m][c])
					if imgui.DragFloatV(fmt.Sprintf("##r%d%d", m, c), &v, 0.005, 0, 2, "%.3f", imgui.SliderFlagsAlwaysClamp) {
						a.Light.Reflectance[m][c] = float64(v)
						changed = true
					}
				}
			}
			imgui.EndTable()
		}
		if Button(T("light.restore"), "refl-restore") {
			a.Light.Reflectance = core.DefaultReflectance
			changed = true
		}
		WrapSameLine(T("light.estimate"))
		if Button(T("light.estimate"), "refl-estimate") {
			p.requestEstimate()
		}
		Note(T("light.estimateNote"))
	}
	if Section(T("light.section.tools"), "light-tools") {
		Note(T("light.measureNote"))
		if Button(T("light.clear"), "measure-clear") {
			p.measure = nil
			p.requestMeasure()
		}
	}
	if changed {
		a.NotifyLightChanged()
	}
}

func (p *LightPanel) DrawRight() {
	a := p.a
	if Section(T("light.section.stats"), "light-stats") {
		if len(p.stats) == 0 {
			Note(T("light.noStats"))
		} else {
			r := p.stats[0].stats.Roi
			Note(T("light.roi", "x", F(r.X, 0), "y", F(r.Y, 0), "w", F(r.W, 0), "h", F(r.H, 0)))
			headers := []string{T("light.col.channel"), T("light.col.avg"), T("light.col.std"), T("light.col.min"),
				T("light.col.max"), T("light.col.pixel"), T("light.col.satHigh"), T("light.col.satLow")}
			stats := p.stats
			DataTable("light-stats", headers, len(stats), float32(len(stats)+1)*imgui.FrameHeightWithSpacing()+8, func(row, col int) string {
				s := stats[row].stats
				switch col {
				case 0:
					return channelNames[stats[row].ch]
				case 1:
					return F(s.Mean, 2)
				case 2:
					return F(s.Std, 2)
				case 3:
					return fmt.Sprint(s.Min)
				case 4:
					return fmt.Sprint(s.Max)
				case 5:
					return fmt.Sprint(s.Pixels)
				case 6:
					return fmt.Sprint(s.SaturatedHigh)
				}
				return fmt.Sprint(s.SaturatedLow)
			}, -1)
			highlight := -1
			if a.Display != DisplayRGB {
				highlight = int(math.Round(stats[0].stats.Mean))
			}
			Histogram("light", &stats[0].stats.Histogram, highlight, 130)
		}
	}
	if Section(T("light.section.material"), "light-material") {
		s := a.Scene
		headers := []string{T("light.col.material"), T("light.col.pixels"), T("light.col.mean")}
		DataTable("light-material", headers, 4, 5*imgui.FrameHeightWithSpacing()+8, func(row, col int) string {
			switch col {
			case 0:
				return core.MaterialNames[row]
			case 1:
				return fmt.Sprint(s.Stats[row].Count)
			}
			return F(s.Stats[row].Mean, 2)
		}, -1)
	}
}

func (p *LightPanel) Overlay(o *Overlay) {
	if p.dragging {
		o.DragBox(p.dragStart.X, p.dragStart.Y, p.dragCur.X, p.dragCur.Y, OverlayWarn)
		return
	}
	if p.measure != nil {
		o.DashedRect(p.measure.X, p.measure.Y, p.measure.W, p.measure.H, OverlayWarn, 1.5)
	}
}

func (p *LightPanel) Pointer(ev PointerEvent) bool {
	switch ev.Kind {
	case PointerDown:
		p.dragging = true
		p.dragStart = core.Point{X: ev.X, Y: ev.Y}
		p.dragCur = p.dragStart
		return true
	case PointerMove:
		p.dragCur = core.Point{X: ev.X, Y: ev.Y}
	case PointerUp:
		p.dragging = false
		r := core.Rect{X: math.Min(p.dragStart.X, ev.X), Y: math.Min(p.dragStart.Y, ev.Y), W: math.Abs(ev.X - p.dragStart.X), H: math.Abs(ev.Y - p.dragStart.Y)}
		if r.W >= 1 && r.H >= 1 {
			p.measure = &r
			p.requestMeasure()
		}
	}
	return true
}

func (p *LightPanel) Hover(x, y int) string {
	a := p.a
	s := a.Scene
	idx := y*s.W + x
	if a.ShowMaterial {
		return "MAT " + core.MaterialNames[s.Material[idx]&3]
	}
	gv := func(ch core.CameraChannel) uint8 {
		return core.ClampByte(core.LinearValue(s.Light, core.NewChannelTransfer(&a.Light, ch), idx))
	}
	if a.Display == DisplayRGB {
		return fmt.Sprintf("GV R%d G%d B%d", gv(core.ChRed), gv(core.ChGreen), gv(core.ChBlue))
	}
	return fmt.Sprintf("GV %d", gv(a.CameraChannel()))
}
