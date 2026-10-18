package core

import (
	"fmt"
	"math"
	"sort"
	"strconv"
)

// DefectKind 是缺陷类型。
type DefectKind uint8

// 缺陷类型常量。
const (
	Bright DefectKind = iota
	Dark
)

// DefectShape 是缺陷形状。
type DefectShape uint8

// 缺陷形状常量。
const (
	ShapeSpot DefectShape = iota
	ShapeLine
	ShapeRect
)

// DefectAmplitude 是幅度模式。
type DefectAmplitude uint8

// 幅度模式常量。
const (
	AmpAbsolute DefectAmplitude = iota
	AmpRelative
	AmpTarget
)

// DefectProfile 是轮廓模式。
type DefectProfile uint8

// 轮廓模式常量。
const (
	ProfileLinear DefectProfile = iota
	ProfileGaussian
)

// DefaultRelativePct 是相对幅度默认百分比。
const DefaultRelativePct = 30.0

// DefectStroke 是灰度缺陷笔画。
type DefectStroke struct {
	Kind         DefectKind
	Shape        DefectShape
	X, Y, X2, Y2 float64
	Radius       float64
	DeltaGv      float64
	Softness     float64
	Amplitude    DefectAmplitude
	RelativePct  float64
	TargetGv     float64
	HasTarget    bool
	Profile      DefectProfile
	Grain        float64
	Seed         uint32
}

// SceneMode 是场景笔画模式。
type SceneMode uint8

// 场景笔画模式常量。
const (
	SceneMaterial SceneMode = iota
	SceneTexture
)

// SceneStroke 是场景笔画。
type SceneStroke struct {
	Mode                 SceneMode
	Shape                DefectShape
	X, Y, X2, Y2, Radius float64
	Material             uint8
	Factor               float64
}

// DefectParams 是缺陷检测参数。
type DefectParams struct {
	BrightTh, DarkTh                          float64
	BrightMinSize, DarkMinSize, MinDefectSize int
	BrightRelPct, DarkRelPct                  float64
}

// DefaultDefectParams 是默认检测参数。
var DefaultDefectParams = DefectParams{BrightTh: 30, DarkTh: 30, BrightMinSize: 10, DarkMinSize: 10, MinDefectSize: 1}

// DefectBlob 是缺陷连通域。
type DefectBlob struct {
	Kind                      DefectKind
	Area                      int
	BBox                      Rect
	Centroid                  Point
	PeakDelta, MeanDelta      float64
	Detected                  bool
	Rule                      string
	RejectReason              string
	GoldenMean, ThresholdMean float64
	SaturatedPixels           int
}

// DefectRegionStats 是区域统计。
type DefectRegionStats struct {
	Pixels                                                                       int
	GoldenMean                                                                   float64
	GoldenSaturatedHigh, GoldenSaturatedLow, TestSaturatedHigh, TestSaturatedLow int
}

// DefectReport 是缺陷检测报告。
type DefectReport struct {
	Blobs                              []DefectBlob
	DetectedCount, RejectedCount       int
	SimulatedParams, UnsimulatedParams []string
	RegionStats                        DefectRegionStats
}

// SensorNoise 是传感器噪声参数。
type SensorNoise struct {
	ReadSigma, ShotGain float64
	Seed                uint32
}

// NoNoise 是无噪声设置。
var NoNoise = SensorNoise{Seed: 1}

// ProbeReport 是探测报告。
type ProbeReport struct {
	Pixels                                                   int
	MaxBright, MaxDark                                       float64
	BrightPixels, DarkPixels, LargestBright, LargestDark     int
	RequiredBright, RequiredDark                             int
	WouldDetectBright, WouldDetectDark                       bool
	GoldenMean                                               float64
	GoldenMin, GoldenMax                                     int
	BrightThMin, BrightThMax, DarkThMin, DarkThMax           float64
	GoldenSaturatedHigh, TestSaturatedHigh, TestSaturatedLow int
}

// RandomShape 是随机形状模式。
type RandomShape uint8

// 随机形状常量。
const (
	RandomSpot RandomShape = iota
	RandomLine
	RandomMixedShape
)

// RandomKind 是随机类型模式。
type RandomKind uint8

// 随机类型常量。
const (
	RandomBright RandomKind = iota
	RandomDark
	RandomMixedKind
)

// RandomDefectOptions 是随机缺陷生成选项。
type RandomDefectOptions struct {
	Count                                    int
	Seed                                     uint32
	Width, Height                            int
	Kind                                     RandomKind
	Shape                                    RandomShape
	RadiusMin, RadiusMax, ValueMin, ValueMax float64
	Amplitude                                DefectAmplitude
	Profile                                  DefectProfile
	Softness, Grain, LineLengthMax           float64
	Material                                 []uint8
	Materials                                []uint8
}

// EffectiveThreshold 计算有效阈值。
func EffectiveThreshold(kind DefectKind, goldenGv float64, p DefectParams) float64 {
	if kind == Bright {
		return p.BrightTh + (goldenGv*p.BrightRelPct)/100
	}
	return p.DarkTh + (goldenGv*p.DarkRelPct)/100
}

func distanceToShape(x, y float64, shape DefectShape, sx, sy, x2, y2 float64) float64 {
	if shape == ShapeSpot {
		return math.Hypot(x-sx, y-sy)
	}
	vx := x2 - sx
	vy := y2 - sy
	lenSq := vx*vx + vy*vy
	if lenSq == 0 {
		return math.Hypot(x-sx, y-sy)
	}
	t := ((x-sx)*vx + (y-sy)*vy) / lenSq
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	px := sx + t*vx
	py := sy + t*vy
	return math.Hypot(x-px, y-py)
}

func shapeWeight(d, radius, softness float64) float64 {
	if radius <= 0 {
		return 0
	}
	inner := radius * (1 - softness)
	if d <= inner {
		return 1
	}
	if d >= radius {
		return 0
	}
	return (radius - d) / (radius - inner)
}

func rectWeight(x, y, minX, maxX, minY, maxY, softness float64) float64 {
	depth := math.Min(math.Min(x-minX, maxX-x), math.Min(y-minY, maxY-y))
	if depth < 0 {
		return 0
	}
	feather := softness * math.Max(0.5, math.Min(maxX-minX, maxY-minY)/2)
	if feather <= 0 || depth >= feather {
		return 1
	}
	return depth / feather
}

func shapeBounds(shape DefectShape, x, y, x2, y2, radius float64) Rect {
	if shape == ShapeRect {
		minX := math.Min(x, x2)
		maxX := math.Max(x, x2)
		minY := math.Min(y, y2)
		maxY := math.Max(y, y2)
		return Rect{X: minX, Y: minY, W: maxX - minX, H: maxY - minY}
	}
	ex := x
	if shape == ShapeLine {
		ex = x2
	}
	ey := y
	if shape == ShapeLine {
		ey = y2
	}
	minX := math.Min(x, ex) - radius
	maxX := math.Max(x, ex) + radius
	minY := math.Min(y, ey) - radius
	maxY := math.Max(y, ey) + radius
	return Rect{X: minX, Y: minY, W: maxX - minX, H: maxY - minY}
}

func hashGrain(x, y int, seed uint32) float64 {
	h := uint32(int32(x))*0x27d4eb2d ^ uint32(int32(y))*0x165667b1 ^ seed*0x9e3779b9
	h = (h ^ (h >> 15)) * 0x85ebca6b
	h = (h ^ (h >> 13)) * 0xc2b2ae35
	h = h ^ (h >> 16)
	return (float64(h)/4294967296)*2 - 1
}

func applyProfile(lw float64, profile DefectProfile) float64 {
	if profile == ProfileGaussian {
		if lw <= 0 {
			return 0
		}
		if lw >= 1 {
			return 1
		}
		k := 1 - lw
		return math.Exp(-4.5 * k * k)
	}
	return lw
}

func strokeWeight(stroke DefectStroke, x, y, x2, y2 float64) float64 {
	var lw float64
	if stroke.Shape == ShapeRect {
		minX := math.Min(stroke.X, x2)
		maxX := math.Max(stroke.X, x2)
		minY := math.Min(stroke.Y, y2)
		maxY := math.Max(stroke.Y, y2)
		lw = rectWeight(x, y, minX, maxX, minY, maxY, stroke.Softness)
	} else {
		d := distanceToShape(x, y, stroke.Shape, stroke.X, stroke.Y, x2, y2)
		lw = shapeWeight(d, stroke.Radius, stroke.Softness)
	}
	w := applyProfile(lw, stroke.Profile)
	grain := stroke.Grain
	if grain > 0 && w > 0 {
		seed := stroke.Seed
		if seed == 0 {
			seed = 1
		}
		h := hashGrain(int(x), int(y), seed)
		w = math.Max(0, w*(1+grain*h))
	}
	return w
}

func applyAmplitude(stroke DefectStroke, v, w float64) float64 {
	sign := 1.0
	if stroke.Kind == Dark {
		sign = -1
	}
	switch stroke.Amplitude {
	case AmpRelative:
		pct := stroke.RelativePct
		return v + sign*math.Max(v, 0)*(pct/100)*w
	case AmpTarget:
		tg := stroke.TargetGv
		if !stroke.HasTarget {
			if stroke.Kind == Bright {
				tg = 255
			} else {
				tg = 0
			}
		}
		nv := v + (tg-v)*w
		if stroke.Kind == Bright {
			return math.Max(v, nv)
		}
		return math.Min(v, nv)
	}
	return v + sign*stroke.DeltaGv*w
}

// PaintDefects 在灰度图上绘制缺陷笔画。
func PaintDefects(img *GrayImage, strokes []DefectStroke) *GrayImage {
	width := img.Width
	height := img.Height
	touched := make(map[int]float64)
	for _, stroke := range strokes {
		x2 := stroke.X2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			x2 = stroke.X
		}
		y2 := stroke.Y2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			y2 = stroke.Y
		}
		bounds := shapeBounds(stroke.Shape, stroke.X, stroke.Y, x2, y2, stroke.Radius)
		x0 := int(math.Max(0, math.Floor(bounds.X)))
		y0 := int(math.Max(0, math.Floor(bounds.Y)))
		x1 := int(math.Min(float64(width), math.Floor(bounds.X+bounds.W)+1))
		y1 := int(math.Min(float64(height), math.Floor(bounds.Y+bounds.H)+1))
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				w := strokeWeight(stroke, float64(x), float64(y), x2, y2)
				if w <= 0 {
					continue
				}
				idx := y*width + x
				base, ok := touched[idx]
				if !ok {
					base = float64(img.Data[idx])
				}
				touched[idx] = applyAmplitude(stroke, base, w)
			}
		}
	}
	out := make([]uint8, len(img.Data))
	copy(out, img.Data)
	for idx, v := range touched {
		out[idx] = ClampByte(v)
	}
	return &GrayImage{Width: width, Height: height, Data: out}
}

// PaintScene 在场景上绘制笔画。
func PaintScene(scene *LightScene, strokes []SceneStroke) *LightScene {
	material := make([]uint8, len(scene.Material))
	copy(material, scene.Material)
	texture := make([]float32, len(scene.Texture))
	copy(texture, scene.Texture)
	width := scene.Width
	height := scene.Height
	for _, stroke := range strokes {
		x2 := stroke.X2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			x2 = stroke.X
		}
		y2 := stroke.Y2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			y2 = stroke.Y
		}
		bounds := shapeBounds(stroke.Shape, stroke.X, stroke.Y, x2, y2, stroke.Radius)
		x0 := int(math.Max(0, math.Floor(bounds.X)))
		y0 := int(math.Max(0, math.Floor(bounds.Y)))
		x1 := int(math.Min(float64(width), math.Floor(bounds.X+bounds.W)+1))
		y1 := int(math.Min(float64(height), math.Floor(bounds.Y+bounds.H)+1))
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				var w float64
				if stroke.Shape == ShapeRect {
					minX := math.Min(stroke.X, x2)
					maxX := math.Max(stroke.X, x2)
					minY := math.Min(stroke.Y, y2)
					maxY := math.Max(stroke.Y, y2)
					w = rectWeight(float64(x), float64(y), minX, maxX, minY, maxY, 0)
				} else {
					d := distanceToShape(float64(x), float64(y), stroke.Shape, stroke.X, stroke.Y, x2, y2)
					w = shapeWeight(d, stroke.Radius, 0)
				}
				if w <= 0 {
					continue
				}
				idx := y*width + x
				if stroke.Mode == SceneMaterial {
					if w > 0.5 {
						material[idx] = stroke.Material
					}
				} else {
					factor := stroke.Factor
					t := float64(texture[idx]) * (1 + (factor-1)*w)
					if t < 0 {
						t = 0
					} else if t > 4 {
						t = 4
					}
					texture[idx] = float32(t)
				}
			}
		}
	}
	return &LightScene{Width: width, Height: height, Material: material, Texture: texture}
}

// RenderDefectPair 渲染 golden/test 图像对。
func RenderDefectPair(scene *LightScene, s *LightSetting, ch CameraChannel, sceneStrokes []SceneStroke, gvStrokes []DefectStroke, noise SensorNoise) (golden, test *GrayImage) {
	golden = RenderChannel(scene, s, ch)
	painted := scene
	if len(sceneStrokes) > 0 {
		painted = PaintScene(scene, sceneStrokes)
	}
	test = RenderChannel(painted, s, ch)
	transfer := NewChannelTransfer(s, ch)
	n := len(painted.Material)
	touched := make(map[int]float64)
	for _, stroke := range gvStrokes {
		x2 := stroke.X2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			x2 = stroke.X
		}
		y2 := stroke.Y2
		if stroke.Shape != ShapeLine && stroke.Shape != ShapeRect {
			y2 = stroke.Y
		}
		bounds := shapeBounds(stroke.Shape, stroke.X, stroke.Y, x2, y2, stroke.Radius)
		x0 := int(math.Max(0, math.Floor(bounds.X)))
		y0 := int(math.Max(0, math.Floor(bounds.Y)))
		x1 := int(math.Min(float64(painted.Width), math.Floor(bounds.X+bounds.W)+1))
		y1 := int(math.Min(float64(painted.Height), math.Floor(bounds.Y+bounds.H)+1))
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				w := strokeWeight(stroke, float64(x), float64(y), x2, y2)
				if w <= 0 {
					continue
				}
				idx := y*painted.Width + x
				base, ok := touched[idx]
				if !ok {
					base = LinearValue(painted, transfer, idx)
				}
				touched[idx] = applyAmplitude(stroke, base, w)
			}
		}
	}
	active := noise.ReadSigma > 0 || noise.ShotGain > 0
	if active {
		rng := NewRng(noise.Seed)
		readSigma := noise.ReadSigma
		shotGain := noise.ShotGain
		for idx := 0; idx < n; idx++ {
			v, ok := touched[idx]
			if !ok {
				v = LinearValue(painted, transfer, idx)
			}
			sigma := math.Sqrt(readSigma*readSigma + shotGain*math.Max(v, 0))
			test.Data[idx] = ClampByte(v + sigma*rng.NextGaussian())
		}
	} else {
		for idx, v := range touched {
			test.Data[idx] = ClampByte(v)
		}
	}
	return golden, test
}

var paramKeyMap = []struct {
	key  string
	dest func(*DefectParams, float64)
}{
	{"1000", func(p *DefectParams, v float64) { p.BrightTh = v }},
	{"1002", func(p *DefectParams, v float64) { p.BrightMinSize = int(v) }},
	{"1009", func(p *DefectParams, v float64) { p.DarkTh = v }},
	{"1011", func(p *DefectParams, v float64) { p.DarkMinSize = int(v) }},
	{"1024", func(p *DefectParams, v float64) { p.MinDefectSize = int(v) }},
}

// DefectParamsFromInspection 从检测参数映射构建参数。
func DefectParamsFromInspection(values map[string]float64) (DefectParams, []string) {
	params := DefaultDefectParams
	var missing []string
	for _, entry := range paramKeyMap {
		value, ok := values[entry.key]
		if !ok {
			missing = append(missing, entry.key)
		} else {
			entry.dest(&params, value)
		}
	}
	return params, missing
}

var simulatedParams = []string{
	"Bright Defect(TH)",
	"Bright Defect Size(Pixel)",
	"Dark Defect(TH)",
	"Dark Defect Size(Pixel)",
	"Min Defect Size(Pixel)",
	"Bright Relative TH (% of Golden) [teaching]",
	"Dark Relative TH (% of Golden) [teaching]",
}

var unsimulatedParams = []string{
	"Bright Defect Margine(TH)",
	"Bright Defect Offest1(%)",
	"Bright Defect Offest2(TH)",
	"Bright Defect Pad Offest(TH)",
	"Dark Defect Margine(TH)",
	"Dark Defect Offset1(%)",
	"Dark Defect Offset2(TH)",
	"Dark Defect Pad Offset(TH)",
	"Block Bright Defect Offset(TH)",
	"Block Dark Offset(TH)",
}

type blobAccumulator struct {
	kind         DefectKind
	area         int
	minX, minY   int
	maxX, maxY   int
	sumX, sumY   float64
	peak         float64
	sumDelta     float64
	sumGolden    float64
	sumThreshold float64
	saturated    int
}

func collectBlobs(diff []int16, golden, test []uint8, width, height int, region []uint8, kind DefectKind, params DefectParams) []blobAccumulator {
	visited := make([]uint8, width*height)
	var blobs []blobAccumulator
	stack := make([]int, 0, 64)
	isCandidate := func(idx int) bool {
		if region != nil && region[idx] == 0 {
			return false
		}
		d := float64(diff[idx])
		th := EffectiveThreshold(kind, float64(golden[idx]), params)
		if kind == Bright {
			return d >= th
		}
		return -d >= th
	}
	for start := 0; start < width*height; start++ {
		if visited[start] != 0 || !isCandidate(start) {
			continue
		}
		blob := blobAccumulator{
			kind: kind,
			minX: width,
			minY: height,
			maxX: -1,
			maxY: -1,
		}
		stack = stack[:0]
		stack = append(stack, start)
		visited[start] = 1
		for len(stack) > 0 {
			idx := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x := idx % width
			y := (idx - x) / width
			delta := math.Abs(float64(diff[idx]))
			blob.area++
			blob.sumX += float64(x)
			blob.sumY += float64(y)
			blob.sumDelta += delta
			blob.sumGolden += float64(golden[idx])
			blob.sumThreshold += EffectiveThreshold(kind, float64(golden[idx]), params)
			if kind == Bright {
				if test[idx] == 255 {
					blob.saturated++
				}
			} else {
				if test[idx] == 0 {
					blob.saturated++
				}
			}
			if delta > blob.peak {
				blob.peak = delta
			}
			if x < blob.minX {
				blob.minX = x
			}
			if y < blob.minY {
				blob.minY = y
			}
			if x > blob.maxX {
				blob.maxX = x
			}
			if y > blob.maxY {
				blob.maxY = y
			}
			for dy := -1; dy <= 1; dy++ {
				ny := y + dy
				if ny < 0 || ny >= height {
					continue
				}
				for dx := -1; dx <= 1; dx++ {
					if dx == 0 && dy == 0 {
						continue
					}
					nx := x + dx
					if nx < 0 || nx >= width {
						continue
					}
					nIdx := ny*width + nx
					if visited[nIdx] != 0 || !isCandidate(nIdx) {
						continue
					}
					visited[nIdx] = 1
					stack = append(stack, nIdx)
				}
			}
		}
		blobs = append(blobs, blob)
	}
	return blobs
}

func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// DetectDefects 检测缺陷。
func DetectDefects(golden, test *GrayImage, p DefectParams, region []uint8) (DefectReport, error) {
	var report DefectReport
	if golden.Width != test.Width || golden.Height != test.Height {
		return report, fmt.Errorf("DetectDefects: image sizes must match")
	}
	width := golden.Width
	height := golden.Height
	n := width * height
	if region != nil && len(region) != n {
		return report, fmt.Errorf("DetectDefects: region size mismatch")
	}
	diff := make([]int16, n)
	for i := 0; i < n; i++ {
		diff[i] = int16(test.Data[i]) - int16(golden.Data[i])
	}

	brightBlobs := collectBlobs(diff, golden.Data, test.Data, width, height, region, Bright, p)
	darkBlobs := collectBlobs(diff, golden.Data, test.Data, width, height, region, Dark, p)

	blobs := make([]DefectBlob, 0, len(brightBlobs)+len(darkBlobs))
	build := func(acc blobAccumulator) DefectBlob {
		minSize := p.DarkMinSize
		if acc.kind == Bright {
			minSize = p.BrightMinSize
		}
		required := minSize
		if p.MinDefectSize > required {
			required = p.MinDefectSize
		}
		detected := acc.area >= required
		relPct := p.DarkRelPct
		baseTh := p.DarkTh
		if acc.kind == Bright {
			relPct = p.BrightRelPct
			baseTh = p.BrightTh
		}
		var rule string
		if relPct > 0 {
			if acc.kind == Bright {
				rule = "Bright Defect(TH)=" + formatFloat(baseTh) + " + " + formatFloat(relPct) + "%×Golden, Bright Defect Size(Pixel)>=" + strconv.Itoa(required)
			} else {
				rule = "Dark Defect(TH)=" + formatFloat(baseTh) + " + " + formatFloat(relPct) + "%×Golden, Dark Defect Size(Pixel)>=" + strconv.Itoa(required)
			}
		} else {
			if acc.kind == Bright {
				rule = "Bright Defect(TH)=" + formatFloat(baseTh) + ", Bright Defect Size(Pixel)>=" + strconv.Itoa(required)
			} else {
				rule = "Dark Defect(TH)=" + formatFloat(baseTh) + ", Dark Defect Size(Pixel)>=" + strconv.Itoa(required)
			}
		}
		rejectReason := ""
		if !detected {
			rejectReason = "below-size"
		}
		return DefectBlob{
			Kind:            acc.kind,
			Area:            acc.area,
			BBox:            Rect{X: float64(acc.minX), Y: float64(acc.minY), W: float64(acc.maxX - acc.minX + 1), H: float64(acc.maxY - acc.minY + 1)},
			Centroid:        Point{X: acc.sumX / float64(acc.area), Y: acc.sumY / float64(acc.area)},
			PeakDelta:       acc.peak,
			MeanDelta:       acc.sumDelta / float64(acc.area),
			Detected:        detected,
			Rule:            rule,
			RejectReason:    rejectReason,
			GoldenMean:      acc.sumGolden / float64(acc.area),
			ThresholdMean:   acc.sumThreshold / float64(acc.area),
			SaturatedPixels: acc.saturated,
		}
	}
	for _, acc := range brightBlobs {
		blobs = append(blobs, build(acc))
	}
	for _, acc := range darkBlobs {
		blobs = append(blobs, build(acc))
	}
	sort.SliceStable(blobs, func(i, j int) bool {
		return blobs[i].Area > blobs[j].Area
	})

	detectedCount := 0
	rejectedCount := 0
	for _, blob := range blobs {
		if blob.Detected {
			detectedCount++
		} else {
			rejectedCount++
		}
	}

	regionStats := DefectRegionStats{}
	goldenSum := 0.0
	for i := 0; i < n; i++ {
		if region != nil && region[i] == 0 {
			continue
		}
		regionStats.Pixels++
		goldenSum += float64(golden.Data[i])
		if golden.Data[i] == 255 {
			regionStats.GoldenSaturatedHigh++
		}
		if golden.Data[i] == 0 {
			regionStats.GoldenSaturatedLow++
		}
		if test.Data[i] == 255 {
			regionStats.TestSaturatedHigh++
		}
		if test.Data[i] == 0 {
			regionStats.TestSaturatedLow++
		}
	}
	if regionStats.Pixels > 0 {
		regionStats.GoldenMean = goldenSum / float64(regionStats.Pixels)
	}

	report.Blobs = blobs
	report.DetectedCount = detectedCount
	report.RejectedCount = rejectedCount
	report.SimulatedParams = append([]string{}, simulatedParams...)
	report.UnsimulatedParams = append([]string{}, unsimulatedParams...)
	report.RegionStats = regionStats
	return report, nil
}

func largestComponent(mask []uint8, width, height, x0, y0, x1, y1 int) int {
	visited := make([]uint8, width*height)
	stack := make([]int, 0, 64)
	largest := 0
	for sy := y0; sy < y1; sy++ {
		for sx := x0; sx < x1; sx++ {
			start := sy*width + sx
			if visited[start] != 0 || mask[start] == 0 {
				continue
			}
			area := 0
			stack = stack[:0]
			stack = append(stack, start)
			visited[start] = 1
			for len(stack) > 0 {
				idx := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				x := idx % width
				y := (idx - x) / width
				area++
				for dy := -1; dy <= 1; dy++ {
					ny := y + dy
					if ny < y0 || ny >= y1 {
						continue
					}
					for dx := -1; dx <= 1; dx++ {
						if dx == 0 && dy == 0 {
							continue
						}
						nx := x + dx
						if nx < x0 || nx >= x1 {
							continue
						}
						nIdx := ny*width + nx
						if visited[nIdx] != 0 || mask[nIdx] == 0 {
							continue
						}
						visited[nIdx] = 1
						stack = append(stack, nIdx)
					}
				}
			}
			if area > largest {
				largest = area
			}
		}
	}
	return largest
}

// ProbeArea 探测矩形区域内的缺陷。
func ProbeArea(golden, test *GrayImage, r Rect, p DefectParams, region []uint8) (ProbeReport, error) {
	var report ProbeReport
	if golden.Width != test.Width || golden.Height != test.Height {
		return report, fmt.Errorf("ProbeArea: image sizes must match")
	}
	width := golden.Width
	height := golden.Height
	x0 := int(math.Max(0, math.Floor(r.X)))
	y0 := int(math.Max(0, math.Floor(r.Y)))
	x1 := int(math.Min(float64(width), math.Ceil(r.X+r.W)))
	y1 := int(math.Min(float64(height), math.Ceil(r.Y+r.H)))
	requiredBright := p.BrightMinSize
	if p.MinDefectSize > requiredBright {
		requiredBright = p.MinDefectSize
	}
	requiredDark := p.DarkMinSize
	if p.MinDefectSize > requiredDark {
		requiredDark = p.MinDefectSize
	}
	report.RequiredBright = requiredBright
	report.RequiredDark = requiredDark
	if x1 <= x0 || y1 <= y0 {
		return report, nil
	}
	brightMask := make([]uint8, width*height)
	darkMask := make([]uint8, width*height)
	goldenSum := 0.0
	goldenMin := 255
	goldenMax := 0
	brightThMin := math.Inf(1)
	brightThMax := math.Inf(-1)
	darkThMin := math.Inf(1)
	darkThMax := math.Inf(-1)
	for y := y0; y < y1; y++ {
		row := y * width
		for x := x0; x < x1; x++ {
			idx := row + x
			if region != nil && region[idx] == 0 {
				continue
			}
			g := golden.Data[idx]
			t := test.Data[idx]
			d := float64(t) - float64(g)
			report.Pixels++
			goldenSum += float64(g)
			if int(g) < goldenMin {
				goldenMin = int(g)
			}
			if int(g) > goldenMax {
				goldenMax = int(g)
			}
			if g == 255 {
				report.GoldenSaturatedHigh++
			}
			if t == 255 {
				report.TestSaturatedHigh++
			}
			if t == 0 {
				report.TestSaturatedLow++
			}
			bTh := EffectiveThreshold(Bright, float64(g), p)
			dTh := EffectiveThreshold(Dark, float64(g), p)
			if bTh < brightThMin {
				brightThMin = bTh
			}
			if bTh > brightThMax {
				brightThMax = bTh
			}
			if dTh < darkThMin {
				darkThMin = dTh
			}
			if dTh > darkThMax {
				darkThMax = dTh
			}
			if d > report.MaxBright {
				report.MaxBright = d
			}
			if -d > report.MaxDark {
				report.MaxDark = -d
			}
			if d >= bTh {
				report.BrightPixels++
				brightMask[idx] = 1
			}
			if -d >= dTh {
				report.DarkPixels++
				darkMask[idx] = 1
			}
		}
	}
	if report.Pixels == 0 {
		return report, nil
	}
	report.GoldenMean = goldenSum / float64(report.Pixels)
	report.GoldenMin = goldenMin
	report.GoldenMax = goldenMax
	report.BrightThMin = brightThMin
	report.BrightThMax = brightThMax
	report.DarkThMin = darkThMin
	report.DarkThMax = darkThMax
	report.LargestBright = largestComponent(brightMask, width, height, x0, y0, x1, y1)
	report.LargestDark = largestComponent(darkMask, width, height, x0, y0, x1, y1)
	report.WouldDetectBright = report.LargestBright >= requiredBright
	report.WouldDetectDark = report.LargestDark >= requiredDark
	return report, nil
}

// GenerateRandomDefects 生成随机缺陷笔画。
func GenerateRandomDefects(o RandomDefectOptions) []DefectStroke {
	rng := NewRng(o.Seed)
	var out []DefectStroke
	wanted := make(map[uint8]bool)
	for _, m := range o.Materials {
		wanted[m] = true
	}
	maxAttempts := o.Count * 50
	attempts := 0
	for len(out) < o.Count && attempts < maxAttempts {
		attempts++
		radius := o.RadiusMin + rng.Next()*(o.RadiusMax-o.RadiusMin)
		lo := math.Ceil(radius)
		hiX := float64(o.Width-1) - math.Ceil(radius)
		hiY := float64(o.Height-1) - math.Ceil(radius)
		if hiX < lo || hiY < lo {
			break
		}
		cx := lo + rng.Next()*(hiX-lo)
		cy := lo + rng.Next()*(hiY-lo)
		if len(wanted) > 0 && o.Material != nil {
			ix := int(math.Min(float64(o.Width-1), math.Max(0, math.Round(cx))))
			iy := int(math.Min(float64(o.Height-1), math.Max(0, math.Round(cy))))
			if !wanted[o.Material[iy*o.Width+ix]] {
				continue
			}
		}
		kind := Bright
		if o.Kind == RandomMixedKind {
			if rng.Next() < 0.5 {
				kind = Bright
			} else {
				kind = Dark
			}
		} else if o.Kind == RandomDark {
			kind = Dark
		}
		shape := ShapeSpot
		if o.Shape == RandomMixedShape {
			if rng.Next() < 0.5 {
				shape = ShapeSpot
			} else {
				shape = ShapeLine
			}
		} else if o.Shape == RandomLine {
			shape = ShapeLine
		}
		value := o.ValueMin + rng.Next()*(o.ValueMax-o.ValueMin)
		stroke := DefectStroke{
			Kind:      kind,
			Shape:     shape,
			X:         cx,
			Y:         cy,
			Radius:    radius,
			DeltaGv:   0,
			Softness:  o.Softness,
			Amplitude: o.Amplitude,
			Profile:   o.Profile,
			Grain:     o.Grain,
			Seed:      o.Seed*1000 + uint32(len(out)),
		}
		if shape == ShapeLine {
			minLen := 2 * radius
			maxLen := math.Max(minLen, o.LineLengthMax)
			length := minLen + rng.Next()*(maxLen-minLen)
			angle := rng.Next() * math.Pi * 2
			stroke.X2 = cx + math.Cos(angle)*length
			stroke.Y2 = cy + math.Sin(angle)*length
		}
		switch o.Amplitude {
		case AmpAbsolute:
			stroke.DeltaGv = value
		case AmpRelative:
			stroke.RelativePct = value
		case AmpTarget:
			stroke.TargetGv = math.Min(255, math.Max(0, value))
			stroke.HasTarget = true
		}
		out = append(out, stroke)
	}
	return out
}
