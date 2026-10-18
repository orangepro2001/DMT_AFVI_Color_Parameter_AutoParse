package core

import (
	"fmt"
	"math"
	"runtime"
	"sync"
)

func sqrt(v float64) float64      { return math.Sqrt(v) }
func mathFloor(v float64) float64 { return math.Floor(v) }
func mathCeil(v float64) float64  { return math.Ceil(v) }
func mathMax(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// 材料索引常量。
const (
	MatBase  = 0
	MatSR    = 1
	MatOpen  = 2
	MatMetal = 3
)

// MaterialNames 是材料索引到名称的映射。
var MaterialNames = [4]string{"base", "sr", "open", "metal"}

// CameraChannel 是相机通道。
type CameraChannel int

// 相机通道常量。
const (
	ChRed CameraChannel = iota
	ChGreen
	ChBlue
)

// LightColor 是光源颜色。
type LightColor int

// 光源颜色常量。
const (
	LightRed LightColor = iota
	LightGreen
	LightBlue
	LightWhite
)

// LightChannel 是单个光源通道设置。
type LightChannel struct {
	Color  LightColor
	Value  float64
	Enable bool
}

// Reflectance 是 [材料][相机通道] 反射率。
type Reflectance [4][3]float64

// Crosstalk 是 [光源颜色][相机通道] 串扰系数。
type Crosstalk [4][3]float64

// DefaultReflectance 与 TS DEFAULT_REFLECTANCE 数值相同。
var DefaultReflectance = Reflectance{
	{0.05, 0.05, 0.05},
	{0.12, 0.35, 0.15},
	{0.5, 0.45, 0.35},
	{0.9, 0.7, 0.45},
}

// DefaultCrosstalk 与 TS DEFAULT_CROSSTALK 数值相同。
var DefaultCrosstalk = Crosstalk{
	{1, 0, 0},
	{0, 1, 0},
	{0, 0, 1},
	{1, 1, 1},
}

// LightSetting 是光照与相机设置。
type LightSetting struct {
	Channels        []LightChannel
	Reflectance     Reflectance
	Crosstalk       *Crosstalk
	Gain            float64
	Offset          float64
	TextureStrength float64
}

// DefaultLightSetting 返回默认光照设置。
func DefaultLightSetting() LightSetting {
	return LightSetting{
		Channels: []LightChannel{
			{Color: LightRed, Value: 512, Enable: true},
			{Color: LightGreen, Value: 0, Enable: false},
			{Color: LightBlue, Value: 0, Enable: false},
			{Color: LightWhite, Value: 0, Enable: false},
		},
		Reflectance:     DefaultReflectance,
		Gain:            1,
		Offset:          0,
		TextureStrength: 1,
	}
}

// Clone 深拷贝设置。
func (s LightSetting) Clone() LightSetting {
	out := s
	out.Channels = make([]LightChannel, len(s.Channels))
	copy(out.Channels, s.Channels)
	if s.Crosstalk != nil {
		ct := *s.Crosstalk
		out.Crosstalk = &ct
	}
	return out
}

// LightScene 是渲染场景。
type LightScene struct {
	Width    int
	Height   int
	Material []uint8
	Texture  []float32
}

// MaterialStat 是材料统计。
type MaterialStat struct {
	Count int
	Mean  float64
	Std   float64
}

// GvStats 是灰度统计。
type GvStats struct {
	Roi           Rect
	Mean          float64
	Std           float64
	Min           int
	Max           int
	Pixels        int
	Histogram     [256]int
	SaturatedHigh int
	SaturatedLow  int
}

// BuildMaterialMap 按 metal > open > sr > base 优先级构建材料图。
func BuildMaterialMap(metal, sr, open *GrayImage, threshold uint8) ([]uint8, error) {
	if metal.Width != sr.Width || metal.Height != sr.Height || metal.Width != open.Width || metal.Height != open.Height {
		return nil, fmt.Errorf("BuildMaterialMap: layer sizes must match")
	}
	n := metal.Width * metal.Height
	out := make([]uint8, n)
	for i := 0; i < n; i++ {
		if metal.Data[i] >= threshold {
			out[i] = MatMetal
		} else if open.Data[i] >= threshold {
			out[i] = MatOpen
		} else if sr.Data[i] >= threshold {
			out[i] = MatSR
		} else {
			out[i] = MatBase
		}
	}
	return out, nil
}

// MaterialStats 统计各材料像素的均值与标准差。
func MaterialStats(img *GrayImage, material []uint8) ([4]MaterialStat, error) {
	var out [4]MaterialStat
	if img.Width*img.Height != len(material) {
		return out, fmt.Errorf("MaterialStats: size mismatch")
	}
	var counts [4]int
	var sums [4]float64
	var sumsSq [4]float64
	n := len(material)
	for i := 0; i < n; i++ {
		m := material[i]
		v := float64(img.Data[i])
		counts[m]++
		sums[m] += v
		sumsSq[m] += v * v
	}
	for m := 0; m < 4; m++ {
		count := counts[m]
		if count == 0 {
			out[m] = MaterialStat{Count: 0, Mean: 0, Std: 0}
		} else {
			mean := sums[m] / float64(count)
			variance := sumsSq[m]/float64(count) - mean*mean
			if variance < 0 {
				variance = 0
			}
			out[m] = MaterialStat{Count: count, Mean: mean, Std: sqrt(variance)}
		}
	}
	return out, nil
}

// NewLightScene 由中值图与材料图构建场景。
func NewLightScene(median *GrayImage, material []uint8) (*LightScene, error) {
	if median.Width*median.Height != len(material) {
		return nil, fmt.Errorf("NewLightScene: size mismatch")
	}
	stats, err := MaterialStats(median, material)
	if err != nil {
		return nil, err
	}
	var means [4]float64
	for m := 0; m < 4; m++ {
		means[m] = stats[m].Mean
	}
	n := len(material)
	texture := make([]float32, n)
	for i := 0; i < n; i++ {
		m := material[i]
		mean := means[m]
		t := 1.0
		if mean != 0 {
			t = float64(median.Data[i]) / mean
		}
		if t < 0 {
			t = 0
		} else if t > 4 {
			t = 4
		}
		texture[i] = float32(t)
	}
	return &LightScene{Width: median.Width, Height: median.Height, Material: material, Texture: texture}, nil
}

// Irradiance 计算某相机通道的辐照度。
func Irradiance(s *LightSetting, ch CameraChannel) float64 {
	ct := DefaultCrosstalk
	if s.Crosstalk != nil {
		ct = *s.Crosstalk
	}
	sum := 0.0
	for _, c := range s.Channels {
		if !c.Enable {
			continue
		}
		value := c.Value
		if value > 1024 {
			value = 1024
		} else if value < 0 {
			value = 0
		}
		sum += (value / 1024) * ct[c.Color][ch]
	}
	return sum
}

// ChannelTransfer 是通道传递参数。
type ChannelTransfer struct {
	PerMaterial     [4]float64
	TextureStrength float64
	Offset          float64
}

// NewChannelTransfer 计算通道传递参数。
func NewChannelTransfer(s *LightSetting, ch CameraChannel) ChannelTransfer {
	gain := s.Gain
	offset := s.Offset
	strength := s.TextureStrength
	e := Irradiance(s, ch)
	var perMaterial [4]float64
	for m := 0; m < 4; m++ {
		perMaterial[m] = gain * e * s.Reflectance[m][ch] * 255
	}
	return ChannelTransfer{PerMaterial: perMaterial, TextureStrength: strength, Offset: offset}
}

// LinearValue 计算线性灰度值（不取整不钳制）。
func LinearValue(scene *LightScene, t ChannelTransfer, idx int) float64 {
	m := scene.Material[idx]
	tex := 1 + t.TextureStrength*(float64(scene.Texture[idx])-1)
	return t.PerMaterial[m]*tex + t.Offset
}

// RenderChannel 渲染单通道灰度图，按行分块并行。
func RenderChannel(scene *LightScene, s *LightSetting, ch CameraChannel) *GrayImage {
	transfer := NewChannelTransfer(s, ch)
	strength := transfer.TextureStrength
	offset := transfer.Offset
	perMaterial := transfer.PerMaterial
	n := len(scene.Material)
	out := make([]uint8, n)
	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	if workers > scene.Height {
		workers = scene.Height
	}
	if workers <= 1 {
		for i := 0; i < n; i++ {
			m := scene.Material[i]
			tex := 1 + strength*(float64(scene.Texture[i])-1)
			out[i] = ClampByte(perMaterial[m]*tex + offset)
		}
		return &GrayImage{Width: scene.Width, Height: scene.Height, Data: out}
	}
	var wg sync.WaitGroup
	rowsPer := (scene.Height + workers - 1) / workers
	for w := 0; w < workers; w++ {
		y0 := w * rowsPer
		y1 := y0 + rowsPer
		if y1 > scene.Height {
			y1 = scene.Height
		}
		if y0 >= y1 {
			break
		}
		wg.Add(1)
		go func(y0, y1 int) {
			defer wg.Done()
			for i := y0 * scene.Width; i < y1*scene.Width; i++ {
				m := scene.Material[i]
				tex := 1 + strength*(float64(scene.Texture[i])-1)
				out[i] = ClampByte(perMaterial[m]*tex + offset)
			}
		}(y0, y1)
	}
	wg.Wait()
	return &GrayImage{Width: scene.Width, Height: scene.Height, Data: out}
}

// EstimateReflectance 估计各材料反射率；无法估计的位置 ok=false。
func EstimateReflectance(median *GrayImage, scene *LightScene, s *LightSetting, ch CameraChannel) (values [4]float64, ok [4]bool, err error) {
	if median.Width*median.Height != len(scene.Material) {
		return values, ok, fmt.Errorf("EstimateReflectance: size mismatch")
	}
	gain := s.Gain
	offset := s.Offset
	e := Irradiance(s, ch)
	var counts [4]int
	var sums [4]float64
	n := len(scene.Material)
	for i := 0; i < n; i++ {
		m := scene.Material[i]
		counts[m]++
		sums[m] += float64(median.Data[i])
	}
	for m := 0; m < 4; m++ {
		count := counts[m]
		if count == 0 || e == 0 {
			ok[m] = false
		} else {
			mean := sums[m] / float64(count)
			values[m] = (mean - offset) / (gain * e * 255)
			ok[m] = true
		}
	}
	return values, ok, nil
}

// MeasureGv 统计 ROI 灰度信息。
func MeasureGv(img *GrayImage, roi Rect) (GvStats, error) {
	var stats GvStats
	if img.Width <= 0 || img.Height <= 0 {
		return stats, fmt.Errorf("MeasureGv: empty image")
	}
	x0 := int(mathFloor(mathMax(roi.X, 0)))
	if x0 > img.Width-1 {
		x0 = img.Width - 1
	}
	y0 := int(mathFloor(mathMax(roi.Y, 0)))
	if y0 > img.Height-1 {
		y0 = img.Height - 1
	}
	x1 := int(mathCeil(roi.X + roi.W))
	if x1 < x0+1 {
		x1 = x0 + 1
	}
	if x1 > img.Width {
		x1 = img.Width
	}
	y1 := int(mathCeil(roi.Y + roi.H))
	if y1 < y0+1 {
		y1 = y0 + 1
	}
	if y1 > img.Height {
		y1 = img.Height
	}
	w := x1 - x0
	h := y1 - y0
	var histogram [256]int
	sum := 0.0
	sumSq := 0.0
	min := 255
	max := 0
	saturatedHigh := 0
	saturatedLow := 0
	pixels := w * h
	for y := y0; y < y1; y++ {
		row := y * img.Width
		for x := x0; x < x1; x++ {
			v := img.Data[row+x]
			histogram[v]++
			sum += float64(v)
			sumSq += float64(v) * float64(v)
			if int(v) < min {
				min = int(v)
			}
			if int(v) > max {
				max = int(v)
			}
			if v == 255 {
				saturatedHigh++
			}
			if v == 0 {
				saturatedLow++
			}
		}
	}
	mean := sum / float64(pixels)
	variance := sumSq/float64(pixels) - mean*mean
	if variance < 0 {
		variance = 0
	}
	stats.Roi = Rect{X: float64(x0), Y: float64(y0), W: float64(w), H: float64(h)}
	stats.Mean = mean
	stats.Std = sqrt(variance)
	stats.Min = min
	stats.Max = max
	stats.Pixels = pixels
	stats.Histogram = histogram
	stats.SaturatedHigh = saturatedHigh
	stats.SaturatedLow = saturatedLow
	return stats, nil
}

// MaterialMask 生成材料掩码，materials 为材料索引。
func MaterialMask(scene *LightScene, materials []uint8) []uint8 {
	wanted := [4]bool{}
	for _, m := range materials {
		if m < 4 {
			wanted[m] = true
		}
	}
	n := len(scene.Material)
	out := make([]uint8, n)
	for i := 0; i < n; i++ {
		if wanted[scene.Material[i]] {
			out[i] = 1
		}
	}
	return out
}
