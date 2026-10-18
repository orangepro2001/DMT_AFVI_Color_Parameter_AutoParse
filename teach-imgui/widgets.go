package main

import (
	"math"
	"strconv"

	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

// Compact label-left controls for dense industrial panels. Every control takes a stable
// id separate from its (translated) label so switching language keeps widget state.

const labelWidth = 112

// F formats a number with fixed digits; NaN/Inf render as an em dash.
func F(v float64, digits int) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "—"
	}
	return strconv.FormatFloat(v, 'f', digits, 64)
}

func labelColumn(label string) {
	imgui.AlignTextToFramePadding()
	imgui.TextUnformatted(label)
	imgui.SameLineV(labelWidth, -1)
	imgui.SetNextItemWidth(-1)
}

// Section is a collapsible group (open by default).
func Section(title, id string) bool {
	return imgui.CollapsingHeaderTreeNodeFlagsV(title+"###sec-"+id, imgui.TreeNodeFlagsDefaultOpen)
}

// SectionClosed is a collapsible group that starts collapsed.
func SectionClosed(title, id string) bool {
	return imgui.CollapsingHeaderTreeNodeFlagsV(title+"###sec-"+id, 0)
}

// SliderF64 edits a float64 with a slider (Ctrl+click to type a value).
func SliderF64(label, id string, v *float64, min, max float64, format string) bool {
	labelColumn(label)
	f := float32(*v)
	if imgui.SliderFloatV("##"+id, &f, float32(min), float32(max), format, imgui.SliderFlagsAlwaysClamp) {
		*v = float64(f)
		return true
	}
	return false
}

// SliderInt edits an int with a slider.
func SliderInt(label, id string, v *int, min, max int) bool {
	labelColumn(label)
	i := int32(*v)
	if imgui.SliderIntV("##"+id, &i, int32(min), int32(max), "%d", imgui.SliderFlagsAlwaysClamp) {
		*v = int(i)
		return true
	}
	return false
}

// InputF64 edits a float64 in a numeric field with +/- step buttons.
func InputF64(label, id string, v *float64, step float64, format string) bool {
	labelColumn(label)
	return imgui.InputDoubleV("##"+id, v, step, step*10, format, imgui.InputTextFlagsNone)
}

// Check is a checkbox with a translated label.
func Check(label, id string, v *bool) bool {
	return imgui.Checkbox(label+"###chk-"+id, v)
}

// Combo selects one of items by index.
func Combo(label, id string, current *int, items []string) bool {
	labelColumn(label)
	preview := ""
	if *current >= 0 && *current < len(items) {
		preview = items[*current]
	}
	changed := false
	if imgui.BeginCombo("##"+id, preview) {
		for i, it := range items {
			if imgui.SelectableBoolV(it+"##"+strconv.Itoa(i), i == *current, 0, imgui.NewVec2(0, 0)) && i != *current {
				*current = i
				changed = true
			}
		}
		imgui.EndCombo()
	}
	return changed
}

// WrapSameLine keeps the next button (with visible text nextLabel) on the current line when
// it fits, otherwise starts a new line, so button rows reflow for long translations.
func WrapSameLine(nextLabel string) {
	style := imgui.CurrentStyle()
	w := imgui.CalcTextSize(nextLabel).X + style.FramePadding().X*2
	imgui.SameLine()
	if imgui.ContentRegionAvail().X < w {
		imgui.NewLine()
	}
}

// Button is a push button with a stable id.
func Button(label, id string) bool {
	return imgui.Button(label + "###btn-" + id)
}

// ToolButton is a latching tool button: drawn pressed while active.
func ToolButton(label, id string, active bool) bool {
	if active {
		c := imgui.CurrentStyle().Colors()
		imgui.PushStyleColorVec4(imgui.ColButton, c[imgui.ColButtonActive])
		imgui.PushStyleColorVec4(imgui.ColButtonHovered, c[imgui.ColButtonActive])
	}
	clicked := imgui.Button(label + "###tool-" + id)
	if active {
		imgui.PopStyleColorV(2)
	}
	return clicked
}

func wrappedColored(text string, col imgui.Vec4) {
	imgui.PushStyleColorVec4(imgui.ColText, col)
	imgui.PushTextWrapPos()
	imgui.TextUnformatted(text)
	imgui.PopTextWrapPos()
	imgui.PopStyleColor()
}

// Note is dim wrapped helper text.
func Note(text string) { wrappedColored(text, CurrentPalette().TextDim) }

// Warn is emphasized wrapped warning text.
func Warn(text string) { wrappedColored(text, CurrentPalette().Warn) }

// Badge draws an OK / MANUAL / NG indicator lamp.
func Badge(level core.VerdictLevel) {
	text, bg, fg := "OK", rgba(0, 192, 0, 255), rgba(0, 0, 0, 255)
	switch level {
	case core.VerdictManual:
		text, bg, fg = "MANUAL", rgba(255, 216, 0, 255), rgba(0, 0, 0, 255)
	case core.VerdictNG:
		text, bg, fg = "NG", rgba(255, 0, 0, 255), rgba(255, 255, 255, 255)
	}
	ts := imgui.CalcTextSize(text)
	p := imgui.CursorScreenPos()
	size := imgui.NewVec2(ts.X+16, ts.Y+6)
	dl := imgui.WindowDrawList()
	dl.AddRectFilled(p, imgui.NewVec2(p.X+size.X, p.Y+size.Y), bg)
	dl.AddRectV(p, imgui.NewVec2(p.X+size.X, p.Y+size.Y), rgba(0, 0, 0, 255), 0, 1, 0)
	dl.AddTextVec2(imgui.NewVec2(p.X+8, p.Y+3), fg, text)
	imgui.Dummy(size)
}

// KVTable shows label/value pairs with right-aligned values.
func KVTable(id string, rows [][2]string) {
	if !imgui.BeginTableV("##kv-"+id, 2, imgui.TableFlagsSizingStretchProp, imgui.NewVec2(0, 0), 0) {
		return
	}
	dim := CurrentPalette().TextDim
	for _, r := range rows {
		imgui.TableNextRow()
		imgui.TableSetColumnIndex(0)
		imgui.PushStyleColorVec4(imgui.ColText, dim)
		imgui.TextUnformatted(r[0])
		imgui.PopStyleColor()
		imgui.TableSetColumnIndex(1)
		w := imgui.CalcTextSize(r[1]).X
		if gap := imgui.ContentRegionAvail().X - w; gap > 0 {
			imgui.SetCursorPosX(imgui.CursorPosX() + gap)
		}
		imgui.TextUnformatted(r[1])
	}
	imgui.EndTable()
}

// DataTable renders a scrollable grid with clipping (only visible rows are built), so
// tens of thousands of rows stay cheap. Column 0 is selectable; returns the clicked row or -1.
func DataTable(id string, headers []string, rows int, height float32, cell func(row, col int) string, selected int) int {
	clicked := -1
	flags := imgui.TableFlagsRowBg | imgui.TableFlagsBorders | imgui.TableFlagsScrollY | imgui.TableFlagsScrollX |
		imgui.TableFlagsSizingFixedFit | imgui.TableFlagsResizable
	// Language in the id: fixed-fit widths are measured per script.
	if !imgui.BeginTableV("##dt-"+id+"-"+string(CurrentLang()), int32(len(headers)), flags, imgui.NewVec2(0, height), 0) {
		return clicked
	}
	imgui.TableSetupScrollFreeze(1, 1)
	for _, h := range headers {
		imgui.TableSetupColumnV(h, 0, 0, 0)
	}
	imgui.TableHeadersRow()
	clipper := imgui.NewListClipper()
	clipper.Begin(int32(rows))
	for clipper.Step() {
		for r := int(clipper.DisplayStart()); r < int(clipper.DisplayEnd()); r++ {
			imgui.TableNextRow()
			for c := range headers {
				imgui.TableSetColumnIndex(int32(c))
				if c == 0 {
					if imgui.SelectableBoolV(cell(r, 0)+"##row"+strconv.Itoa(r), r == selected, imgui.SelectableFlagsSpanAllColumns, imgui.NewVec2(0, 0)) {
						clicked = r
					}
					continue
				}
				imgui.TextUnformatted(cell(r, c))
			}
		}
	}
	clipper.End()
	clipper.Destroy()
	imgui.EndTable()
	return clicked
}

// Histogram draws a 256-bin log-scale GV histogram (classic scope look), optionally
// highlighting one bin (pass -1 for none).
func Histogram(id string, hist *[256]int, highlight int, height float32) {
	pal := CurrentPalette()
	w := imgui.ContentRegionAvail().X
	p := imgui.CursorScreenPos()
	dl := imgui.WindowDrawList()
	end := imgui.NewVec2(p.X+w, p.Y+height)
	dl.AddRectFilled(p, end, pal.ChartBg)
	for _, frac := range []float32{0.25, 0.5, 0.75} {
		y := p.Y + height*frac
		dl.AddLineArgs(imgui.NewVec2(p.X, y), imgui.NewVec2(end.X, y), pal.ChartGrid, 1)
	}
	max := 0
	for _, v := range hist {
		if v > max {
			max = v
		}
	}
	if max > 0 {
		logMax := math.Log(float64(max) + 1)
		barW := w / 256
		for i, v := range hist {
			if v == 0 {
				continue
			}
			bh := float32(math.Log(float64(v)+1)/logMax) * (height - 2)
			col := pal.ChartBar
			if i == highlight {
				col = pal.ChartMark
			}
			x0 := p.X + float32(i)*barW
			bw := barW
			if bw < 1 {
				bw = 1
			}
			dl.AddRectFilled(imgui.NewVec2(x0, end.Y-bh), imgui.NewVec2(x0+bw, end.Y), col)
		}
	}
	dl.AddRectV(p, end, pal.ChartFrame, 0, 1, 0)
	imgui.InvisibleButton("##hist-"+id, imgui.NewVec2(w, height))
}

// Heatmap draws an NCC surface (blue → yellow color ramp, same as the web app) in a
// square of the given size with the peak circled.
func Heatmap(id string, s *core.NccSurface, size float32) {
	p := imgui.CursorScreenPos()
	dl := imgui.WindowDrawList()
	end := imgui.NewVec2(p.X+size, p.Y+size)
	dl.AddRectFilled(p, end, CurrentPalette().ChartBg)
	if s != nil && s.Width > 0 && s.Height > 0 {
		cw := size / float32(s.Width)
		ch := size / float32(s.Height)
		peak, peakIdx := float32(-math.MaxFloat32), 0
		for i, v := range s.Values {
			if v > peak {
				peak, peakIdx = v, i
			}
		}
		for y := 0; y < s.Height; y++ {
			for x := 0; x < s.Width; x++ {
				t := (s.Values[y*s.Width+x] + 1) / 2
				if t < 0 {
					t = 0
				} else if t > 1 {
					t = 1
				}
				var r, g, b int
				if t < 0.5 {
					b = int(255 * t / 0.5)
				} else {
					k := (t - 0.5) / 0.5
					r, g, b = int(255*k), int(255*k), int(255*(1-k))
				}
				x0 := p.X + float32(x)*cw
				y0 := p.Y + float32(y)*ch
				dl.AddRectFilled(imgui.NewVec2(x0, y0), imgui.NewVec2(x0+cw+0.5, y0+ch+0.5), rgba(r, g, b, 255))
			}
		}
		px := p.X + float32(peakIdx%s.Width)*cw + cw/2
		py := p.Y + float32(peakIdx/s.Width)*ch + ch/2
		dl.AddCircleV(imgui.NewVec2(px, py), 5, OverlayOK, 0, 2)
	}
	dl.AddRectV(p, end, CurrentPalette().ChartFrame, 0, 1, 0)
	imgui.InvisibleButton("##heat-"+id, imgui.NewVec2(size, size))
}
