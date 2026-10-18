package main

import "github.com/AllenDang/cimgui-go/imgui"

// Theme names accepted by ApplyTheme and the -theme flag.
const (
	ThemeDark  = "dark"
	ThemeLight = "light"
)

// Palette holds theme-dependent colors used by custom drawing (viewer, charts).
type Palette struct {
	Workspace  uint32
	ViewerEdge uint32
	ChartBg    uint32
	ChartGrid  uint32
	ChartBar   uint32
	ChartMark  uint32
	ChartFrame uint32
	TextDim    imgui.Vec4
	Warn       imgui.Vec4
	OK         imgui.Vec4
	NG         imgui.Vec4
}

// Overlay colors are classic machine-vision primaries, identical in both themes because
// they are drawn on top of the inspected image.
var (
	OverlayOK     = rgba(0, 255, 0, 255)
	OverlayNG     = rgba(255, 0, 0, 255)
	OverlayWarn   = rgba(255, 255, 0, 255)
	OverlayROI    = rgba(0, 255, 255, 255)
	OverlayMuted  = rgba(128, 128, 128, 255)
	OverlayProbe  = rgba(255, 255, 255, 255)
	OverlayNGFill = rgba(255, 0, 0, 64)
)

var palette Palette

// CurrentPalette returns colors for the active theme.
func CurrentPalette() *Palette { return &palette }

// rgba packs IM_COL32 (ABGR) in pure Go: package-level colors are built before an ImGui
// context exists, and ImGui's GetColorU32 would dereference the missing context.
func rgba(r, g, b, a int) uint32 {
	return uint32(a)<<24 | uint32(b)<<16 | uint32(g)<<8 | uint32(r)
}

func rgb4(r, g, b int) imgui.Vec4 {
	return imgui.NewVec4(float32(r)/255, float32(g)/255, float32(b)/255, 1)
}

// ApplyTheme sets the ImGui style: flat industrial control panel, zero rounding,
// 1 px borders, dense spacing; dark (night) or light (classic Windows gray).
func ApplyTheme(name string) {
	style := imgui.CurrentStyle()
	if name == ThemeLight {
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
	style.SetWindowPadding(imgui.NewVec2(6, 6))
	style.SetFramePadding(imgui.NewVec2(4, 2))
	style.SetItemSpacing(imgui.NewVec2(6, 3))
	style.SetScrollbarSize(14)
	style.SetGrabMinSize(10)
	style.SetWindowMinSize(imgui.NewVec2(8, 8))
	c := style.Colors()
	if name == ThemeLight {
		c[imgui.ColText] = rgb4(0, 0, 0)
		c[imgui.ColTextDisabled] = rgb4(110, 110, 110)
		c[imgui.ColWindowBg] = rgb4(212, 208, 200)
		c[imgui.ColChildBg] = rgb4(212, 208, 200)
		c[imgui.ColPopupBg] = rgb4(255, 255, 255)
		c[imgui.ColBorder] = rgb4(128, 128, 128)
		c[imgui.ColFrameBg] = rgb4(255, 255, 255)
		c[imgui.ColFrameBgHovered] = rgb4(244, 244, 244)
		c[imgui.ColFrameBgActive] = rgb4(232, 232, 232)
		c[imgui.ColTitleBg] = rgb4(10, 36, 106)
		c[imgui.ColTitleBgActive] = rgb4(10, 36, 106)
		c[imgui.ColButton] = rgb4(212, 208, 200)
		c[imgui.ColButtonHovered] = rgb4(228, 226, 220)
		c[imgui.ColButtonActive] = rgb4(190, 186, 178)
		c[imgui.ColHeader] = rgb4(166, 184, 214)
		c[imgui.ColHeaderHovered] = rgb4(186, 202, 228)
		c[imgui.ColHeaderActive] = rgb4(150, 170, 205)
		c[imgui.ColSliderGrab] = rgb4(10, 36, 106)
		c[imgui.ColSliderGrabActive] = rgb4(30, 60, 140)
		c[imgui.ColCheckMark] = rgb4(0, 0, 0)
		c[imgui.ColTableHeaderBg] = rgb4(200, 196, 188)
		c[imgui.ColTableRowBgAlt] = imgui.NewVec4(0, 0, 0, 0.04)
		c[imgui.ColScrollbarBg] = rgb4(232, 230, 225)
		c[imgui.ColScrollbarGrab] = rgb4(190, 186, 178)
		palette = Palette{
			Workspace: rgba(128, 128, 128, 255), ViewerEdge: rgba(64, 64, 64, 255),
			ChartBg: rgba(255, 255, 255, 255), ChartGrid: rgba(192, 192, 192, 255),
			ChartBar: rgba(0, 0, 128, 255), ChartMark: rgba(255, 0, 0, 255), ChartFrame: rgba(128, 128, 128, 255),
			TextDim: rgb4(64, 64, 64), Warn: rgb4(128, 96, 0), OK: rgb4(0, 128, 0), NG: rgb4(192, 0, 0),
		}
	} else {
		c[imgui.ColText] = rgb4(224, 224, 224)
		c[imgui.ColTextDisabled] = rgb4(130, 130, 130)
		c[imgui.ColWindowBg] = rgb4(43, 43, 43)
		c[imgui.ColChildBg] = rgb4(43, 43, 43)
		c[imgui.ColPopupBg] = rgb4(36, 36, 36)
		c[imgui.ColBorder] = rgb4(80, 80, 80)
		c[imgui.ColFrameBg] = rgb4(28, 28, 28)
		c[imgui.ColFrameBgHovered] = rgb4(40, 40, 40)
		c[imgui.ColFrameBgActive] = rgb4(50, 50, 50)
		c[imgui.ColTitleBg] = rgb4(29, 52, 97)
		c[imgui.ColTitleBgActive] = rgb4(29, 52, 97)
		c[imgui.ColButton] = rgb4(60, 60, 60)
		c[imgui.ColButtonHovered] = rgb4(74, 74, 74)
		c[imgui.ColButtonActive] = rgb4(35, 69, 122)
		c[imgui.ColHeader] = rgb4(29, 52, 97)
		c[imgui.ColHeaderHovered] = rgb4(35, 69, 122)
		c[imgui.ColHeaderActive] = rgb4(40, 80, 140)
		c[imgui.ColSliderGrab] = rgb4(150, 150, 150)
		c[imgui.ColSliderGrabActive] = rgb4(200, 200, 200)
		c[imgui.ColCheckMark] = rgb4(0, 255, 0)
		c[imgui.ColTableHeaderBg] = rgb4(55, 55, 55)
		c[imgui.ColTableRowBgAlt] = imgui.NewVec4(1, 1, 1, 0.03)
		c[imgui.ColScrollbarBg] = rgb4(36, 36, 36)
		c[imgui.ColScrollbarGrab] = rgb4(70, 70, 70)
		palette = Palette{
			Workspace: rgba(43, 43, 43, 255), ViewerEdge: rgba(16, 16, 16, 255),
			ChartBg: rgba(0, 0, 0, 255), ChartGrid: rgba(30, 58, 30, 255),
			ChartBar: rgba(0, 192, 0, 255), ChartMark: rgba(255, 255, 0, 255), ChartFrame: rgba(64, 64, 64, 255),
			TextDim: rgb4(168, 168, 168), Warn: rgb4(224, 176, 48), OK: rgb4(60, 200, 60), NG: rgb4(255, 80, 80),
		}
	}
	style.SetColors(&c)
}
