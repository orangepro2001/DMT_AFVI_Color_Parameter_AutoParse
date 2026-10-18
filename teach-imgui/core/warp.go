package core

import (
	"math"
	"runtime"
	"sync"
)

// Occlusion 是遮挡矩形。
type Occlusion struct {
	Rect
	Value float64
}

// WarpParams 是几何与光度变换参数。
type WarpParams struct {
	Tx, Ty, ThetaDeg, Scale, ShearX, ShearY float64
	BendAmplitude, BendWavelength           float64
	BlurSigma, NoiseSigma                   float64
	Gain, Offset, Gradient                  float64
	Occlusions                              []Occlusion
}

// IdentityWarp 是恒等变换。
var IdentityWarp = WarpParams{Scale: 1, Gain: 1}

// Similarity 是相似变换。
type Similarity struct {
	Tx, Ty, ThetaDeg, Scale float64
}

func degToRad(deg float64) float64 {
	return (deg * math.Pi) / 180
}

// WarpPoint 正向映射点。
func WarpPoint(p *WarpParams, pt Point, width, height int) Point {
	cx := float64(width-1) / 2
	cy := float64(height-1) / 2
	dx := pt.X - cx
	dy := pt.Y - cy
	sx := dx + p.ShearX*dy
	sy := dy + p.ShearY*dx
	dx = sx
	dy = sy
	theta := degToRad(p.ThetaDeg)
	cos := math.Cos(theta)
	sin := math.Sin(theta)
	rx := p.Scale * (cos*dx - sin*dy)
	ry := p.Scale * (sin*dx + cos*dy)
	qx := cx + rx + p.Tx
	qy := cy + ry + p.Ty
	if p.BendAmplitude != 0 && p.BendWavelength > 0 {
		qy += p.BendAmplitude * math.Sin((2*math.Pi*qx)/p.BendWavelength)
	}
	return Point{X: qx, Y: qy}
}

// UnwarpPoint 反向映射点；不可逆时返回 (Point{}, false)。
func UnwarpPoint(p *WarpParams, q Point, width, height int) (Point, bool) {
	cx := float64(width-1) / 2
	cy := float64(height-1) / 2
	qx := q.X
	qy := q.Y
	if p.BendAmplitude != 0 && p.BendWavelength > 0 {
		qy -= p.BendAmplitude * math.Sin((2*math.Pi*qx)/p.BendWavelength)
	}
	theta := degToRad(p.ThetaDeg)
	cos := math.Cos(theta)
	sin := math.Sin(theta)
	scale := p.Scale
	ux := qx - cx - p.Tx
	uy := qy - cy - p.Ty
	if scale == 0 {
		return Point{}, false
	}
	invScale := 1 / scale
	rx := (cos*ux + sin*uy) * invScale
	ry := (-sin*ux + cos*uy) * invScale
	det := 1 - p.ShearX*p.ShearY
	if det == 0 {
		return Point{}, false
	}
	dx := (rx - p.ShearX*ry) / det
	dy := (ry - p.ShearY*rx) / det
	return Point{X: cx + dx, Y: cy + dy}, true
}

// ApplyWarp 对模板应用变换，返回新图。
func ApplyWarp(template *GrayImage, p *WarpParams, seed uint32) *GrayImage {
	width := template.Width
	height := template.Height
	cx := float64(width-1) / 2
	n := width * height
	stage := make([]float64, n)

	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	if workers > height {
		workers = height
	}
	if workers <= 1 {
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				stage[y*width+x] = warpSample(template, p, x, y, width, height, cx)
			}
		}
	} else {
		var wg sync.WaitGroup
		rowsPer := (height + workers - 1) / workers
		for w := 0; w < workers; w++ {
			y0 := w * rowsPer
			y1 := y0 + rowsPer
			if y1 > height {
				y1 = height
			}
			if y0 >= y1 {
				break
			}
			wg.Add(1)
			go func(y0, y1 int) {
				defer wg.Done()
				for y := y0; y < y1; y++ {
					for x := 0; x < width; x++ {
						stage[y*width+x] = warpSample(template, p, x, y, width, height, cx)
					}
				}
			}(y0, y1)
		}
		wg.Wait()
	}

	for _, occ := range p.Occlusions {
		x0 := int(math.Floor(occ.X))
		if x0 < 0 {
			x0 = 0
		}
		y0 := int(math.Floor(occ.Y))
		if y0 < 0 {
			y0 = 0
		}
		x1 := int(math.Ceil(occ.X + occ.W))
		if x1 > width {
			x1 = width
		}
		y1 := int(math.Ceil(occ.Y + occ.H))
		if y1 > height {
			y1 = height
		}
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				stage[y*width+x] = occ.Value
			}
		}
	}

	img := &GrayImage{Width: width, Height: height, Data: make([]uint8, n)}
	for i := 0; i < n; i++ {
		img.Data[i] = ClampByte(stage[i])
	}
	if p.BlurSigma > 0 {
		img = GaussianBlur(img, p.BlurSigma)
	}
	if p.NoiseSigma > 0 {
		rng := NewRng(seed)
		out := make([]uint8, n)
		for i := 0; i < n; i++ {
			out[i] = ClampByte(float64(img.Data[i]) + p.NoiseSigma*rng.NextGaussian())
		}
		img = &GrayImage{Width: width, Height: height, Data: out}
	}
	return img
}

func warpSample(template *GrayImage, p *WarpParams, x, y, width, height int, cx float64) float64 {
	pt, ok := UnwarpPoint(p, Point{X: float64(x), Y: float64(y)}, width, height)
	v := 0.0
	if ok {
		s, ok2 := SampleBilinear(template, pt.X, pt.Y)
		if ok2 {
			v = s
		}
	}
	gradTerm := 1.0
	if cx != 0 {
		gradTerm = 1 + p.Gradient*((float64(x)-cx)/cx)
	}
	return v*p.Gain*gradTerm + p.Offset
}

// WarpToSimilarity 提取相似变换部分。
func WarpToSimilarity(p *WarpParams, width, height int) Similarity {
	cx := float64(width-1) / 2
	cy := float64(height-1) / 2
	theta := degToRad(p.ThetaDeg)
	cos := math.Cos(theta)
	sin := math.Sin(theta)
	scale := p.Scale
	tx0 := cx + p.Tx - scale*(cos*cx-sin*cy)
	ty0 := cy + p.Ty - scale*(sin*cx+cos*cy)
	return Similarity{Tx: tx0, Ty: ty0, ThetaDeg: p.ThetaDeg, Scale: scale}
}

// ApplySimilarity 应用相似变换。
func ApplySimilarity(s Similarity, pt Point) Point {
	theta := degToRad(s.ThetaDeg)
	cos := math.Cos(theta)
	sin := math.Sin(theta)
	return Point{
		X: s.Scale*(cos*pt.X-sin*pt.Y) + s.Tx,
		Y: s.Scale*(sin*pt.X+cos*pt.Y) + s.Ty,
	}
}

// InvertSimilarity 求逆相似变换。
func InvertSimilarity(s Similarity) Similarity {
	theta := degToRad(s.ThetaDeg)
	cos := math.Cos(theta)
	sin := math.Sin(theta)
	invScale := 1 / s.Scale
	tx := -invScale * (cos*s.Tx + sin*s.Ty)
	ty := -invScale * (-sin*s.Tx + cos*s.Ty)
	return Similarity{Tx: tx, Ty: ty, ThetaDeg: -s.ThetaDeg, Scale: invScale}
}

// ComposeSimilarity 组合相似变换 a∘b。
func ComposeSimilarity(a, b Similarity) Similarity {
	thetaA := degToRad(a.ThetaDeg)
	thetaB := degToRad(b.ThetaDeg)
	cosA := math.Cos(thetaA)
	sinA := math.Sin(thetaA)
	cosB := math.Cos(thetaB)
	sinB := math.Sin(thetaB)
	scale := a.Scale * b.Scale
	cos := cosA*cosB - sinA*sinB
	sin := sinA*cosB + cosA*sinB
	tx := a.Scale*(cosA*b.Tx-sinA*b.Ty) + a.Tx
	ty := a.Scale*(sinA*b.Tx+cosA*b.Ty) + a.Ty
	return Similarity{Tx: tx, Ty: ty, ThetaDeg: (math.Atan2(sin, cos) * 180) / math.Pi, Scale: scale}
}
