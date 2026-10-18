package core

import (
	"math"
	"testing"
)

func testSetting(overrides func(s *LightSetting)) LightSetting {
	s := LightSetting{
		Channels:        []LightChannel{{Color: LightRed, Value: 512, Enable: true}},
		Reflectance:     DefaultReflectance,
		Gain:            1,
		Offset:          0,
		TextureStrength: 1,
	}
	if overrides != nil {
		overrides(&s)
	}
	return s
}

func TestBuildMaterialMapPriority(t *testing.T) {
	metal := NewGray(2, 1, 0)
	sr := NewGray(2, 1, 0)
	open := NewGray(2, 1, 0)
	metal.Data[0] = 200
	sr.Data[0] = 200
	open.Data[0] = 200
	sr.Data[1] = 200
	open.Data[1] = 200
	m, err := BuildMaterialMap(metal, sr, open, 128)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m[0] != MatMetal {
		t.Fatalf("expected metal, got %d", m[0])
	}
	if m[1] != MatOpen {
		t.Fatalf("expected open, got %d", m[1])
	}
}

func TestNewLightSceneTextureMeanOne(t *testing.T) {
	median := NewGray(4, 1, 0)
	median.Data[0] = 10
	median.Data[1] = 20
	median.Data[2] = 30
	median.Data[3] = 40
	material := []uint8{MatSR, MatSR, MatSR, MatSR}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	sum := 0.0
	for _, v := range scene.Texture {
		sum += float64(v)
	}
	if math.Abs(sum/4-1) >= 1e-6 {
		t.Fatalf("expected mean 1, got %v", sum/4)
	}
}

func TestMetalBrighterUnderRedThanBlue(t *testing.T) {
	median := NewGray(2, 1, 100)
	material := []uint8{MatMetal, MatSR}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	redSetting := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{{Color: LightRed, Value: 1024, Enable: true}}
	})
	blueSetting := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{{Color: LightBlue, Value: 1024, Enable: true}}
	})
	red := RenderChannel(scene, &redSetting, ChRed)
	blue := RenderChannel(scene, &blueSetting, ChBlue)
	redRatio := float64(red.Data[0]) / math.Max(1, float64(red.Data[1]))
	blueRatio := float64(blue.Data[0]) / math.Max(1, float64(blue.Data[1]))
	if !(redRatio > blueRatio) {
		t.Fatalf("expected redRatio > blueRatio, got %v vs %v", redRatio, blueRatio)
	}
}

func TestWithReflectanceChangesRendering(t *testing.T) {
	median := NewGray(1, 1, 100)
	material := []uint8{MatMetal}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	base := DefaultReflectance
	s1 := testSetting(func(s *LightSetting) { s.Reflectance = base })
	before := RenderChannel(scene, &s1, ChRed).Data[0]
	modified := base
	modified[MatMetal][ChRed] = 0.3
	s2 := testSetting(func(s *LightSetting) { s.Reflectance = modified })
	after := RenderChannel(scene, &s2, ChRed).Data[0]
	if !(after < before) {
		t.Fatalf("expected after < before, got %d vs %d", after, before)
	}
	if base[MatMetal][ChRed] != DefaultReflectance[MatMetal][ChRed] {
		t.Fatalf("original mutated")
	}
}

func TestStrongLightSaturates(t *testing.T) {
	median := NewGray(1, 1, 200)
	material := []uint8{MatMetal}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	s := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{{Color: LightWhite, Value: 1024, Enable: true}}
		s.Gain = 2
	})
	img := RenderChannel(scene, &s, ChRed)
	if img.Data[0] != 255 {
		t.Fatalf("expected 255, got %d", img.Data[0])
	}
	stats, err := MeasureGv(img, Rect{X: 0, Y: 0, W: 1, H: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.SaturatedHigh <= 0 {
		t.Fatalf("expected saturatedHigh > 0")
	}
}

func TestEstimateReflectanceRecovers(t *testing.T) {
	median := NewGray(2, 1, 100)
	material := []uint8{MatMetal, MatSR}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	s := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{{Color: LightRed, Value: 512, Enable: true}}
		s.Reflectance = DefaultReflectance
	})
	rendered := RenderChannel(scene, &s, ChRed)
	values, ok, err := EstimateReflectance(rendered, scene, &s, ChRed)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok[MatMetal] {
		t.Fatalf("expected metal ok")
	}
	if math.Abs(values[MatMetal]-DefaultReflectance[MatMetal][ChRed]) >= 0.01 {
		t.Fatalf("metal mismatch: %v", values[MatMetal])
	}
	if !ok[MatSR] {
		t.Fatalf("expected sr ok")
	}
	if math.Abs(values[MatSR]-DefaultReflectance[MatSR][ChRed]) >= 0.01 {
		t.Fatalf("sr mismatch: %v", values[MatSR])
	}
}

func TestMeasureGvClampsRoi(t *testing.T) {
	img := NewGray(10, 10, 5)
	stats, err := MeasureGv(img, Rect{X: 2.5, Y: 3.2, W: 4.1, H: 2.9})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.Roi != (Rect{X: 2, Y: 3, W: 5, H: 4}) {
		t.Fatalf("unexpected roi: %+v", stats.Roi)
	}
	if stats.Pixels != 20 {
		t.Fatalf("expected 20 pixels, got %d", stats.Pixels)
	}
	oob, err := MeasureGv(img, Rect{X: -5, Y: -5, W: 100, H: 100})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if oob.Roi != (Rect{X: 0, Y: 0, W: 10, H: 10}) {
		t.Fatalf("unexpected oob roi: %+v", oob.Roi)
	}
	if oob.Pixels != 100 {
		t.Fatalf("expected 100 pixels, got %d", oob.Pixels)
	}
}

func TestMeasureGvHistogramSums(t *testing.T) {
	img := NewGray(4, 4, 7)
	stats, err := MeasureGv(img, Rect{X: 0, Y: 0, W: 4, H: 4})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	sum := 0
	for _, v := range stats.Histogram {
		sum += v
	}
	if sum != stats.Pixels {
		t.Fatalf("expected %d, got %d", stats.Pixels, sum)
	}
}

func TestIrradianceSumsEnabled(t *testing.T) {
	s := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{
			{Color: LightRed, Value: 1024, Enable: true},
			{Color: LightBlue, Value: 512, Enable: false},
		}
	})
	if math.Abs(Irradiance(&s, ChRed)-1) >= 1e-9 {
		t.Fatalf("expected 1, got %v", Irradiance(&s, ChRed))
	}
	if Irradiance(&s, ChGreen) != 0 {
		t.Fatalf("expected 0, got %v", Irradiance(&s, ChGreen))
	}
}

func TestMaterialStatsReports(t *testing.T) {
	img := NewGray(3, 1, 0)
	img.Data[0] = 10
	img.Data[1] = 20
	img.Data[2] = 30
	material := []uint8{MatSR, MatSR, MatBase}
	stats, err := MaterialStats(img, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats[MatSR].Count != 2 {
		t.Fatalf("expected 2, got %d", stats[MatSR].Count)
	}
	if stats[MatSR].Mean != 15 {
		t.Fatalf("expected 15, got %v", stats[MatSR].Mean)
	}
	if math.Abs(stats[MatSR].Std-5) >= 1e-9 {
		t.Fatalf("expected 5, got %v", stats[MatSR].Std)
	}
	if stats[MatBase].Count != 1 {
		t.Fatalf("expected 1, got %d", stats[MatBase].Count)
	}
}

func TestRenderChannelParallelMatchesSerial(t *testing.T) {
	const w = 1000
	const h = 700
	median := NewGray(w, h, 0)
	material := make([]uint8, w*h)
	for i := 0; i < w*h; i++ {
		median.Data[i] = uint8((i * 37) % 256)
		material[i] = uint8(i % 4)
	}
	scene, err := NewLightScene(median, material)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	s := testSetting(func(s *LightSetting) {
		s.Channels = []LightChannel{
			{Color: LightRed, Value: 800, Enable: true},
			{Color: LightGreen, Value: 400, Enable: true},
		}
		s.Gain = 1.2
		s.Offset = 3
		s.TextureStrength = 0.8
	})
	got := RenderChannel(scene, &s, ChRed)
	transfer := NewChannelTransfer(&s, ChRed)
	want := make([]uint8, w*h)
	for i := 0; i < w*h; i++ {
		m := scene.Material[i]
		tex := 1 + transfer.TextureStrength*(float64(scene.Texture[i])-1)
		want[i] = ClampByte(transfer.PerMaterial[m]*tex + transfer.Offset)
	}
	for i := range want {
		if got.Data[i] != want[i] {
			t.Fatalf("mismatch at %d: got %d want %d", i, got.Data[i], want[i])
		}
	}
}
