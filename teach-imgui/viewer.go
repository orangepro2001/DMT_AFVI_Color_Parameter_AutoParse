package main

import (
	"image"
	"math"

	"github.com/AllenDang/cimgui-go/backend"
	"github.com/AllenDang/cimgui-go/imgui"
)

// PointerKind is the phase of a tool drag on the viewer.
type PointerKind int

const (
	PointerDown PointerKind = iota
	PointerMove
	PointerUp
)

// PointerEvent carries image coordinates (full-resolution image pixels of the shown image).
type PointerEvent struct {
	Kind PointerKind
	X, Y float64
}

// Viewer shows one RGBA texture with zoom/pan and lets the active panel draw overlays and
// receive left-button drags. Unconsumed left drags, middle and right drags pan.
type Viewer struct {
	tex        *backend.Texture
	imgW, imgH int
	zoom       float32
	panX, panY float32
	needFit    bool
	centerReq  *[2]float64

	origin, size     imgui.Vec2
	mouseX, mouseY   float64
	hovered, mouseIn bool
	toolDrag         bool
	panDrag          bool
	synth            *viewerInput
}

// Mouse buttons in viewerInput arrays.
const (
	btnLeft = iota
	btnRight
	btnMiddle
)

// viewerInput is the per-frame mouse state the viewer reacts to. It normally comes from
// ImGui; the self-test injects synthetic frames to exercise zoom, pan and tool drags
// without moving the user's real cursor.
type viewerInput struct {
	mouse, delta            imgui.Vec2
	wheel                   float32
	hovered, doubleClicked  bool
	clicked, released, down [3]bool
}

func imguiInput(hovered bool) viewerInput {
	io := imgui.CurrentIO()
	in := viewerInput{mouse: io.MousePos(), delta: io.MouseDelta(), wheel: io.MouseWheel(), hovered: hovered,
		doubleClicked: imgui.IsMouseDoubleClicked(imgui.MouseButtonLeft)}
	for i, b := range []imgui.MouseButton{imgui.MouseButtonLeft, imgui.MouseButtonRight, imgui.MouseButtonMiddle} {
		in.clicked[i] = imgui.IsMouseClickedBool(b)
		in.released[i] = imgui.IsMouseReleased(b)
		in.down[i] = imgui.IsMouseDown(b)
	}
	return in
}

// Inject replaces ImGui input for the next frame (self-test only).
func (v *Viewer) Inject(in viewerInput) { v.synth = &in }

// Canvas returns the canvas rectangle in screen coordinates from the last frame.
func (v *Viewer) Canvas() (origin, size imgui.Vec2) { return v.origin, v.size }

// NewViewer returns an empty viewer.
func NewViewer() *Viewer { return &Viewer{zoom: 1, needFit: true} }

// SetImage uploads w×h RGBA pixels (UI thread only) and recycles the buffer.
// A size change re-fits the view; same-size updates keep zoom and pan.
func (v *Viewer) SetImage(w, h int, pix []byte) {
	if v.tex != nil {
		v.tex.Release()
		v.tex = nil
	}
	if w > 0 && h > 0 && len(pix) >= 4*w*h {
		v.tex = backend.NewTextureFromRgba(&image.RGBA{Pix: pix[:4*w*h], Stride: 4 * w, Rect: image.Rect(0, 0, w, h)})
	}
	if w != v.imgW || h != v.imgH {
		v.needFit = true
	}
	v.imgW, v.imgH = w, h
	PutRGBA(pix)
}

// Clear removes the texture.
func (v *Viewer) Clear() {
	if v.tex != nil {
		v.tex.Release()
		v.tex = nil
	}
	v.imgW, v.imgH = 0, 0
	v.needFit = true
}

// ImageSize returns the size of the displayed image.
func (v *Viewer) ImageSize() (int, int) { return v.imgW, v.imgH }

// HasImage reports whether a texture is shown.
func (v *Viewer) HasImage() bool { return v.tex != nil }

// Fit scales the image to the canvas on the next frame.
func (v *Viewer) Fit() { v.needFit = true }

// CenterOn scrolls so that image point (x, y) is at the canvas center on the next frame.
func (v *Viewer) CenterOn(x, y float64) { v.centerReq = &[2]float64{x, y} }

// Zoom returns screen pixels per image pixel.
func (v *Viewer) Zoom() float32 { return v.zoom }

// Mouse returns the cursor position in image coordinates and whether it is over the image.
func (v *Viewer) Mouse() (x, y float64, inside bool) { return v.mouseX, v.mouseY, v.mouseIn }

// Hovered reports whether the cursor is over the viewer canvas.
func (v *Viewer) Hovered() bool { return v.hovered }

func (v *Viewer) fit() {
	if v.imgW <= 0 || v.imgH <= 0 || v.size.X <= 0 || v.size.Y <= 0 {
		return
	}
	z := math.Min(float64(v.size.X)/float64(v.imgW), float64(v.size.Y)/float64(v.imgH)) * 0.98
	v.zoom = float32(z)
	v.panX = (v.size.X - float32(v.imgW)*v.zoom) / 2
	v.panY = (v.size.Y - float32(v.imgH)*v.zoom) / 2
	v.needFit = false
}

// Draw fills the remaining content region of the current window.
func (v *Viewer) Draw(overlay func(*Overlay), pointer func(PointerEvent) bool) {
	origin := imgui.CursorScreenPos()
	avail := imgui.ContentRegionAvail()
	if avail.X < 1 {
		avail.X = 1
	}
	if avail.Y < 1 {
		avail.Y = 1
	}
	v.origin, v.size = origin, avail
	imgui.InvisibleButtonV("##viewer-canvas", avail, imgui.ButtonFlagsMouseButtonLeft|imgui.ButtonFlagsMouseButtonRight|imgui.ButtonFlagsMouseButtonMiddle)
	in := imguiInput(imgui.IsItemHovered())
	if v.synth != nil {
		in = *v.synth
		v.synth = nil
	}
	v.hovered = in.hovered

	if v.needFit {
		v.fit()
	}
	if v.centerReq != nil && v.imgW > 0 {
		v.panX = v.size.X/2 - float32(v.centerReq[0])*v.zoom
		v.panY = v.size.Y/2 - float32(v.centerReq[1])*v.zoom
		v.centerReq = nil
	}

	m := in.mouse
	if v.hovered && in.wheel != 0 && v.imgW > 0 {
		ix := (m.X - origin.X - v.panX) / v.zoom
		iy := (m.Y - origin.Y - v.panY) / v.zoom
		z := float64(v.zoom) * math.Pow(1.2, float64(in.wheel))
		v.zoom = float32(math.Min(64, math.Max(0.005, z)))
		v.panX = m.X - origin.X - ix*v.zoom
		v.panY = m.Y - origin.Y - iy*v.zoom
	}
	v.mouseX = float64((m.X - origin.X - v.panX) / v.zoom)
	v.mouseY = float64((m.Y - origin.Y - v.panY) / v.zoom)
	v.mouseIn = v.hovered && v.mouseX >= 0 && v.mouseY >= 0 && v.mouseX < float64(v.imgW) && v.mouseY < float64(v.imgH)

	if v.hovered && in.doubleClicked && !v.toolDrag {
		v.needFit = true
	}
	if v.hovered && in.clicked[btnLeft] {
		if pointer != nil && v.imgW > 0 && pointer(PointerEvent{Kind: PointerDown, X: v.mouseX, Y: v.mouseY}) {
			v.toolDrag = true
		} else {
			v.panDrag = true
		}
	}
	if v.hovered && (in.clicked[btnMiddle] || in.clicked[btnRight]) {
		v.panDrag = true
	}
	if v.toolDrag {
		if (in.delta.X != 0 || in.delta.Y != 0) && pointer != nil {
			pointer(PointerEvent{Kind: PointerMove, X: v.mouseX, Y: v.mouseY})
		}
		if in.released[btnLeft] {
			if pointer != nil {
				pointer(PointerEvent{Kind: PointerUp, X: v.mouseX, Y: v.mouseY})
			}
			v.toolDrag = false
		}
	} else if v.panDrag {
		v.panX += in.delta.X
		v.panY += in.delta.Y
		if !in.down[btnLeft] && !in.down[btnMiddle] && !in.down[btnRight] {
			v.panDrag = false
		}
	}

	pal := CurrentPalette()
	dl := imgui.WindowDrawList()
	vmax := imgui.NewVec2(origin.X+avail.X, origin.Y+avail.Y)
	dl.PushClipRect(origin, vmax)
	dl.AddRectFilled(origin, vmax, pal.Workspace)
	if v.tex != nil {
		imin := imgui.NewVec2(origin.X+v.panX, origin.Y+v.panY)
		imax := imgui.NewVec2(imin.X+float32(v.imgW)*v.zoom, imin.Y+float32(v.imgH)*v.zoom)
		dl.AddImage(v.tex.ID, imin, imax)
	}
	if overlay != nil && v.imgW > 0 {
		overlay(&Overlay{DL: dl, v: v, Min: origin, Max: vmax})
	}
	dl.PopClipRect()
	dl.AddRectV(origin, vmax, pal.ViewerEdge, 0, 1, 0)
}

// Overlay draws in image coordinates on top of the viewer image.
type Overlay struct {
	DL       *imgui.DrawList
	v        *Viewer
	Min, Max imgui.Vec2 // canvas rectangle in screen coordinates
}

// ToScreen converts image coordinates to screen coordinates.
func (o *Overlay) ToScreen(x, y float64) imgui.Vec2 {
	return imgui.NewVec2(o.Min.X+o.v.panX+float32(x)*o.v.zoom, o.Min.Y+o.v.panY+float32(y)*o.v.zoom)
}

// Scale returns screen pixels per image pixel.
func (o *Overlay) Scale() float32 { return o.v.zoom }

// Visible reports whether an image-space rectangle intersects the canvas.
func (o *Overlay) Visible(x, y, w, h float64) bool {
	a, b := o.ToScreen(x, y), o.ToScreen(x+w, y+h)
	return !(b.X < o.Min.X || b.Y < o.Min.Y || a.X > o.Max.X || a.Y > o.Max.Y)
}

func (o *Overlay) screenRect(x, y, w, h float64) (imgui.Vec2, imgui.Vec2) {
	a, b := o.ToScreen(x, y), o.ToScreen(x+w, y+h)
	if a.X > b.X {
		a.X, b.X = b.X, a.X
	}
	if a.Y > b.Y {
		a.Y, b.Y = b.Y, a.Y
	}
	return a, b
}

// Rect outlines an image-space rectangle; tiny rectangles stay at least 3 px on screen.
func (o *Overlay) Rect(x, y, w, h float64, col uint32, thickness float32) {
	a, b := o.screenRect(x, y, w, h)
	if b.X-a.X < 3 {
		cx := (a.X + b.X) / 2
		a.X, b.X = cx-1.5, cx+1.5
	}
	if b.Y-a.Y < 3 {
		cy := (a.Y + b.Y) / 2
		a.Y, b.Y = cy-1.5, cy+1.5
	}
	o.DL.AddRectV(a, b, col, 0, thickness, 0)
}

// FillRect fills an image-space rectangle.
func (o *Overlay) FillRect(x, y, w, h float64, col uint32) {
	a, b := o.screenRect(x, y, w, h)
	o.DL.AddRectFilled(a, b, col)
}

// DashedRect outlines a rectangle with 6/4 px screen dashes (edges clipped to the canvas).
func (o *Overlay) DashedRect(x, y, w, h float64, col uint32, thickness float32) {
	a, b := o.screenRect(x, y, w, h)
	o.dashH(a.X, b.X, a.Y, col, thickness)
	o.dashH(a.X, b.X, b.Y, col, thickness)
	o.dashV(a.X, a.Y, b.Y, col, thickness)
	o.dashV(b.X, a.Y, b.Y, col, thickness)
}

func (o *Overlay) dashH(x0, x1, y float32, col uint32, t float32) {
	if y < o.Min.Y-4 || y > o.Max.Y+4 {
		return
	}
	start := x0
	if start < o.Min.X-10 {
		start = x0 + float32(math.Floor(float64((o.Min.X-10-x0)/10)))*10
	}
	end := x1
	if end > o.Max.X+10 {
		end = o.Max.X + 10
	}
	for s := start; s < end; s += 10 {
		e := s + 6
		if e > x1 {
			e = x1
		}
		o.DL.AddLineArgs(imgui.NewVec2(s, y), imgui.NewVec2(e, y), col, t)
	}
}

func (o *Overlay) dashV(x, y0, y1 float32, col uint32, t float32) {
	if x < o.Min.X-4 || x > o.Max.X+4 {
		return
	}
	start := y0
	if start < o.Min.Y-10 {
		start = y0 + float32(math.Floor(float64((o.Min.Y-10-y0)/10)))*10
	}
	end := y1
	if end > o.Max.Y+10 {
		end = o.Max.Y + 10
	}
	for s := start; s < end; s += 10 {
		e := s + 6
		if e > y1 {
			e = y1
		}
		o.DL.AddLineArgs(imgui.NewVec2(x, s), imgui.NewVec2(x, e), col, t)
	}
}

// Line draws an image-space segment.
func (o *Overlay) Line(x0, y0, x1, y1 float64, col uint32, thickness float32) {
	o.DL.AddLineArgs(o.ToScreen(x0, y0), o.ToScreen(x1, y1), col, thickness)
}

// Circle outlines an image-space circle (radius in image pixels, at least 1.5 px on screen).
func (o *Overlay) Circle(cx, cy, r float64, col uint32, thickness float32) {
	rs := float32(r) * o.v.zoom
	if rs < 1.5 {
		rs = 1.5
	}
	o.DL.AddCircleV(o.ToScreen(cx, cy), rs, col, 0, thickness)
}

// Text draws a label at an image-space anchor plus a screen-pixel offset.
func (o *Overlay) Text(x, y float64, dx, dy float32, col uint32, s string) {
	p := o.ToScreen(x, y)
	o.DL.AddTextVec2(imgui.NewVec2(p.X+dx, p.Y+dy), col, s)
}

// DragBox draws the normalized rectangle spanned by two image points (rubber band).
func (o *Overlay) DragBox(x0, y0, x1, y1 float64, col uint32) {
	o.DashedRect(math.Min(x0, x1), math.Min(y0, y1), math.Abs(x1-x0), math.Abs(y1-y0), col, 1)
}
