package core

import (
	"math"
	"testing"
)

func warpParams(overrides func(p *WarpParams)) WarpParams {
	p := IdentityWarp
	if overrides != nil {
		overrides(&p)
	}
	return p
}

func TestUnwarpPointInvertsWarpPoint(t *testing.T) {
	pt := Point{X: 123.4, Y: 56.7}
	w := 200
	h := 150
	wp := warpParams(func(p *WarpParams) {
		p.Tx = 12.5
		p.Ty = -7.25
		p.ThetaDeg = 0.4
		p.Scale = 1.003
		p.ShearX = 0.02
		p.ShearY = -0.015
		p.BendAmplitude = 6
		p.BendWavelength = 1500
	})
	q := WarpPoint(&wp, pt, w, h)
	back, ok := UnwarpPoint(&wp, q, w, h)
	if !ok {
		t.Fatalf("expected ok")
	}
	if math.Abs(back.X-pt.X) >= 1e-6 || math.Abs(back.Y-pt.Y) >= 1e-6 {
		t.Fatalf("expected round-trip, got %+v", back)
	}
}

func TestApplyWarpIdentity(t *testing.T) {
	img := NewGray(8, 8, 0)
	for i := range img.Data {
		img.Data[i] = uint8((i * 7) % 256)
	}
	out := ApplyWarp(img, &IdentityWarp, 1)
	for i := range img.Data {
		if out.Data[i] != img.Data[i] {
			t.Fatalf("mismatch at %d", i)
		}
	}
}

func TestApplyWarpIntegerTranslation(t *testing.T) {
	img := NewGray(8, 8, 0)
	img.Data[3*8+3] = 200
	p := warpParams(func(p *WarpParams) {
		p.Tx = 2
		p.Ty = 1
	})
	out := ApplyWarp(img, &p, 1)
	if out.GetPixel(5, 4) != 200 {
		t.Fatalf("expected 200, got %d", out.GetPixel(5, 4))
	}
}

func TestApplyWarpDeterministicPerSeed(t *testing.T) {
	img := NewGray(16, 16, 100)
	p := warpParams(func(p *WarpParams) { p.NoiseSigma = 20 })
	a := ApplyWarp(img, &p, 42)
	b := ApplyWarp(img, &p, 42)
	c := ApplyWarp(img, &p, 43)
	for i := range a.Data {
		if a.Data[i] != b.Data[i] {
			t.Fatalf("expected deterministic, mismatch at %d", i)
		}
	}
	same := true
	for i := range a.Data {
		if a.Data[i] != c.Data[i] {
			same = false
			break
		}
	}
	if same {
		t.Fatalf("expected different across seeds")
	}
}

func TestWarpToSimilarityMatchesWarpPoint(t *testing.T) {
	w := 100
	h := 80
	p := warpParams(func(p *WarpParams) {
		p.Tx = 5
		p.Ty = -3
		p.ThetaDeg = 1.2
		p.Scale = 1.01
	})
	sim := WarpToSimilarity(&p, w, h)
	pt := Point{X: 40, Y: 30}
	viaSim := ApplySimilarity(sim, pt)
	viaWarp := WarpPoint(&p, pt, w, h)
	if math.Abs(viaSim.X-viaWarp.X) >= 1e-9 || math.Abs(viaSim.Y-viaWarp.Y) >= 1e-9 {
		t.Fatalf("mismatch: %+v vs %+v", viaSim, viaWarp)
	}
}

func TestInvertComposeSimilarityRoundTrip(t *testing.T) {
	s := Similarity{Tx: 10, Ty: -5, ThetaDeg: 3, Scale: 1.02}
	inv := InvertSimilarity(s)
	pt := Point{X: 12, Y: 34}
	round := ApplySimilarity(inv, ApplySimilarity(s, pt))
	if math.Abs(round.X-pt.X) >= 1e-9 || math.Abs(round.Y-pt.Y) >= 1e-9 {
		t.Fatalf("round-trip mismatch: %+v", round)
	}
	a := Similarity{Tx: 1, Ty: 2, ThetaDeg: 5, Scale: 1.01}
	b := Similarity{Tx: -3, Ty: 4, ThetaDeg: -2, Scale: 0.99}
	composed := ComposeSimilarity(a, b)
	viaCompose := ApplySimilarity(composed, pt)
	viaChain := ApplySimilarity(a, ApplySimilarity(b, pt))
	if math.Abs(viaCompose.X-viaChain.X) >= 1e-9 || math.Abs(viaCompose.Y-viaChain.Y) >= 1e-9 {
		t.Fatalf("compose mismatch: %+v vs %+v", viaCompose, viaChain)
	}
}

func TestRngMatchesTS(t *testing.T) {
	r := NewRng(42)
	wantNext := []float64{
		0.8686135611496866,
		0.41595513606444,
		0.33768315566703677,
		0.5146979179698974,
		0.8930063114967197,
	}
	for i, want := range wantNext {
		got := r.Next()
		if got != want {
			t.Fatalf("Next[%d]: got %v want %v", i, got, want)
		}
	}

	g := NewRng(7)
	wantGauss := []float64{
		1.589964855401545,
		0.42771630929658366,
		0.4528873107266489,
		0.7879900166375353,
	}
	// Uniform draws match TS bit for bit; Box-Muller goes through math.Log/Cos, whose last
	// ulp may differ between Go and V8, so compare with a 1e-12 tolerance.
	for i, want := range wantGauss {
		got := g.NextGaussian()
		if math.Abs(got-want) > 1e-12 {
			t.Fatalf("NextGaussian[%d]: got %v want %v", i, got, want)
		}
	}

	n := NewRng(3)
	wantInt := []int{6, 1, 5, 8, 7, 0}
	for i, want := range wantInt {
		got := n.NextInt(10)
		if got != want {
			t.Fatalf("NextInt[%d]: got %d want %d", i, got, want)
		}
	}
}

func makeTexture(width, height int, seed uint32) *GrayImage {
	img := NewGray(width, height, 0)
	rng := NewRng(seed)
	block := 8
	for by := 0; by < height; by += block {
		for bx := 0; bx < width; bx += block {
			v := uint8(int(rng.Next() * 256))
			for y := by; y < minInt2(by+block, height); y++ {
				for x := bx; x < minInt2(bx+block, width); x++ {
					img.Data[y*width+x] = v
				}
			}
		}
	}
	drawCross := func(cx, cy int) {
		for d := -6; d <= 6; d++ {
			x := cx + d
			y := cy + d
			if x >= 0 && x < width && y >= 0 && y < height {
				img.Data[y*width+x] = 255
			}
			if x >= 0 && x < width && cy-d >= 0 && cy-d < height {
				img.Data[(cy-d)*width+x] = 0
			}
		}
	}
	drawCross(40, 40)
	drawCross(width-40, 40)
	drawCross(40, height-40)
	drawCross(width-40, height-40)
	return img
}

func minInt2(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func TestFitSimilarityRecoversKnown(t *testing.T) {
	s := Similarity{Tx: 12.5, Ty: -7.25, ThetaDeg: 0.4, Scale: 1.003}
	src := []Point{{0, 0}, {100, 0}, {0, 100}, {100, 100}}
	dst := make([]Point, len(src))
	for i, p := range src {
		dst[i] = ApplySimilarity(s, p)
	}
	fit, ok := FitSimilarity(src, dst)
	if !ok {
		t.Fatalf("expected ok")
	}
	if math.Abs(fit.Tx-s.Tx) >= 1e-6 || math.Abs(fit.Ty-s.Ty) >= 1e-6 ||
		math.Abs(fit.ThetaDeg-s.ThetaDeg) >= 1e-6 || math.Abs(fit.Scale-s.Scale) >= 1e-6 {
		t.Fatalf("mismatch: %+v vs %+v", fit, s)
	}
}

func TestRansacSimilarityToleratesOutlier(t *testing.T) {
	s := Similarity{Tx: 3, Ty: 4, ThetaDeg: 1, Scale: 1.0}
	src := []Point{{0, 0}, {50, 0}, {0, 50}, {50, 50}, {25, 25}}
	dst := make([]Point, len(src))
	for i, p := range src {
		dst[i] = ApplySimilarity(s, p)
	}
	dst[2] = Point{X: dst[2].X + 40, Y: dst[2].Y - 30}
	fit, inliers := RansacSimilarity(src, dst, 3, 200, 1)
	if fit == nil {
		t.Fatalf("expected fit")
	}
	for _, v := range inliers {
		if v == 2 {
			t.Fatalf("outlier should not be inlier")
		}
	}
	if len(inliers) < 4 {
		t.Fatalf("expected >=4 inliers, got %d", len(inliers))
	}
}

func TestAlignWithRoisRecoversSmallTransform(t *testing.T) {
	width := 400
	height := 300
	template := makeTexture(width, height, 7)
	warp := warpParams(func(p *WarpParams) {
		p.Tx = 12.5
		p.Ty = -7.25
		p.ThetaDeg = 0.4
		p.Scale = 1.003
	})
	input := ApplyWarp(template, &warp, 7)
	rois := []AlignRoi{
		{Name: "TL", Rect: Rect{X: 20, Y: 20, W: 60, H: 60}},
		{Name: "TR", Rect: Rect{X: float64(width - 80), Y: 20, W: 60, H: 60}},
		{Name: "BL", Rect: Rect{X: 20, Y: float64(height - 80), W: 60, H: 60}},
		{Name: "BR", Rect: Rect{X: float64(width - 80), Y: float64(height - 80), W: 60, H: 60}},
	}
	report := AlignWithRois(template, input, rois, DefaultAlignConfig, Similarity{Scale: 1})
	if report.Level != VerdictOK {
		t.Fatalf("expected ok, got %s reasons=%+v", report.Level, report.Reasons)
	}
	truth := CompareToTruth(report.Fit, &warp, rois, width, height)
	if !(truth.MeanErrorPx < 0.5) {
		t.Fatalf("expected mean error < 0.5, got %v", truth.MeanErrorPx)
	}
}

func TestMatchRoiLargerThanSearchRadius(t *testing.T) {
	width := 400
	height := 400
	template := makeTexture(width, height, 21)
	warp := warpParams(func(p *WarpParams) {
		p.Tx = 5
		p.Ty = -3
	})
	input := ApplyWarp(template, &warp, 21)
	roi := AlignRoi{Name: "big", Rect: Rect{X: 150, Y: 150, W: 80, H: 80}}
	cfg := DefaultAlignConfig
	cfg.SearchRadius = 16
	cfg.PyramidFactor = 4
	report := AlignWithRois(template, input, []AlignRoi{roi}, cfg, Similarity{Scale: 1})
	match := report.Matches[0]
	if !match.Located {
		t.Fatalf("expected located")
	}
	if match.Found == nil {
		t.Fatalf("expected found")
	}
	center := Point{X: roi.X + roi.W/2, Y: roi.Y + roi.H/2}
	truth := WarpPoint(&warp, center, width, height)
	err := math.Hypot(match.Found.X-truth.X, match.Found.Y-truth.Y)
	if !(err < 0.5) {
		t.Fatalf("expected error < 0.5, got %v", err)
	}
}

func TestFlatRoiReported(t *testing.T) {
	width := 200
	height := 200
	template := NewGray(width, height, 128)
	input := NewGray(width, height, 128)
	rois := []AlignRoi{{Name: "flat", Rect: Rect{X: 50, Y: 50, W: 40, H: 40}}}
	report := AlignWithRois(template, input, rois, DefaultAlignConfig, Similarity{Scale: 1})
	if report.Matches[0].Reason != "flat" {
		t.Fatalf("expected flat, got %q", report.Matches[0].Reason)
	}
	if report.Level != VerdictNG {
		t.Fatalf("expected ng, got %s", report.Level)
	}
}

func TestTranslationBeyondSearchRadiusFails(t *testing.T) {
	width := 300
	height := 300
	template := makeTexture(width, height, 11)
	warp := warpParams(func(p *WarpParams) {
		p.Tx = 400
	})
	input := ApplyWarp(template, &warp, 11)
	rois := []AlignRoi{
		{Name: "A", Rect: Rect{X: 40, Y: 40, W: 60, H: 60}},
		{Name: "B", Rect: Rect{X: float64(width - 100), Y: 40, W: 60, H: 60}},
	}
	report := AlignWithRois(template, input, rois, DefaultAlignConfig, Similarity{Scale: 1})
	if report.Level != VerdictNG {
		t.Fatalf("expected ng, got %s", report.Level)
	}
}

func TestPeriodicStripeAmbiguous(t *testing.T) {
	width := 300
	height := 300
	template := NewGray(width, height, 0)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			if x%8 < 4 {
				template.Data[y*width+x] = 30
			} else {
				template.Data[y*width+x] = 220
			}
		}
	}
	warp := warpParams(func(p *WarpParams) {
		p.Tx = 3
		p.Ty = 2
	})
	input := ApplyWarp(template, &warp, 1)
	rois := []AlignRoi{
		{Name: "stripe", Rect: Rect{X: 100, Y: 100, W: 80, H: 80}},
		{Name: "stripe2", Rect: Rect{X: 150, Y: 150, W: 80, H: 80}},
	}
	report := AlignWithRois(template, input, rois, DefaultAlignConfig, Similarity{Scale: 1})
	found := false
	for _, r := range report.Reasons {
		if r.Code == "ambiguous" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected ambiguous reason, got %+v", report.Reasons)
	}
}

func TestAlignWithRoisMatchesMatchRoi(t *testing.T) {
	width := 400
	height := 300
	template := makeTexture(width, height, 5)
	warp := warpParams(func(p *WarpParams) {
		p.Tx = 8
		p.Ty = -4
		p.ThetaDeg = 0.2
		p.Scale = 1.001
	})
	input := ApplyWarp(template, &warp, 5)
	rois := []AlignRoi{
		{Name: "TL", Rect: Rect{X: 20, Y: 20, W: 60, H: 60}},
		{Name: "TR", Rect: Rect{X: float64(width - 80), Y: 20, W: 60, H: 60}},
		{Name: "BL", Rect: Rect{X: 20, Y: float64(height - 80), W: 60, H: 60}},
		{Name: "BR", Rect: Rect{X: float64(width - 80), Y: float64(height - 80), W: 60, H: 60}},
	}
	prior := Similarity{Scale: 1}
	report := AlignWithRois(template, input, rois, DefaultAlignConfig, prior)
	for i, roi := range rois {
		single := MatchRoi(template, input, roi, prior, DefaultAlignConfig)
		m := report.Matches[i]
		if m.Name != single.Name {
			t.Fatalf("name mismatch at %d", i)
		}
		if m.Located != single.Located {
			t.Fatalf("located mismatch at %d", i)
		}
		if m.Reason != single.Reason {
			t.Fatalf("reason mismatch at %d: %q vs %q", i, m.Reason, single.Reason)
		}
		if math.Abs(m.Ncc-single.Ncc) > 1e-9 {
			t.Fatalf("ncc mismatch at %d: %v vs %v", i, m.Ncc, single.Ncc)
		}
		if math.Abs(m.SecondNcc-single.SecondNcc) > 1e-9 {
			t.Fatalf("secondNcc mismatch at %d", i)
		}
		if math.Abs(m.Uniqueness-single.Uniqueness) > 1e-9 {
			t.Fatalf("uniqueness mismatch at %d", i)
		}
		if (m.Found == nil) != (single.Found == nil) {
			t.Fatalf("found nil mismatch at %d", i)
		}
		if m.Found != nil && single.Found != nil {
			if math.Abs(m.Found.X-single.Found.X) > 1e-9 || math.Abs(m.Found.Y-single.Found.Y) > 1e-9 {
				t.Fatalf("found mismatch at %d", i)
			}
		}
	}
}
