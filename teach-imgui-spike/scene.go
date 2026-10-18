package main

import (
	"fmt"
	"image"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"golang.org/x/image/tiff"
)

// Scene holds the reference model layers needed for the light preview.
type Scene struct {
	W, H     int
	Median   []uint8
	Material []uint8 // 0 base, 1 sr, 2 open, 3 metal
	Means    [4]float64
	Counts   [4]int
}

// LightParams mirrors the single-channel (Red) subset of the TS light model.
type LightParams struct {
	Enable      bool
	Value       float32 // 0..1024
	Gain        float32
	Offset      float32
	TexStrength float32
	Refl        [4]float32 // base, sr, open, metal
}

func defaultLight() LightParams {
	return LightParams{Enable: true, Value: 512, Gain: 1, Offset: 0, TexStrength: 1, Refl: [4]float32{0.05, 0.12, 0.5, 0.9}}
}

func loadGray(path string) (*image.Gray, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := tiff.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	b := img.Bounds()
	if g, ok := img.(*image.Gray); ok && g.Stride == b.Dx() && b.Min == (image.Point{}) {
		return g, nil
	}
	g := image.NewGray(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			g.Set(x, y, img.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return g, nil
}

// LoadScene decodes Metal/SR/Open/MEDIAN in parallel and builds the material map.
func LoadScene(modelDir string) (*Scene, error) {
	paths := []string{
		filepath.Join(modelDir, "Metal.tif"),
		filepath.Join(modelDir, "SR.tif"),
		filepath.Join(modelDir, "Open.tif"),
		filepath.Join(modelDir, "2.0", "Line", "Top", "Layer", "MEDIAN", "Median_0_1_0.tif"),
	}
	imgs := make([]*image.Gray, len(paths))
	errs := make([]error, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			imgs[i], errs[i] = loadGray(p)
		}(i, p)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	metal, sr, open, median := imgs[0], imgs[1], imgs[2], imgs[3]
	w, h := median.Rect.Dx(), median.Rect.Dy()
	for _, g := range []*image.Gray{metal, sr, open} {
		if g.Rect.Dx() != w || g.Rect.Dy() != h {
			return nil, fmt.Errorf("layer size mismatch: %v vs %dx%d", g.Rect, w, h)
		}
	}
	n := w * h
	s := &Scene{W: w, H: h, Median: median.Pix[:n], Material: make([]uint8, n)}
	var sums [4]float64
	for i := 0; i < n; i++ {
		m := uint8(0)
		switch {
		case metal.Pix[i] >= 128:
			m = 3
		case open.Pix[i] >= 128:
			m = 2
		case sr.Pix[i] >= 128:
			m = 1
		}
		s.Material[i] = m
		s.Counts[m]++
		sums[m] += float64(s.Median[i])
	}
	for m := 0; m < 4; m++ {
		if s.Counts[m] > 0 {
			s.Means[m] = sums[m] / float64(s.Counts[m])
		}
	}
	return s, nil
}

// BuildLUT folds the per-pixel light model into a 4x256 table:
// GV = clamp(gain*E*R[m]*255 * (1 + s*(median/mean[m] - 1)) + offset).
func (s *Scene) BuildLUT(p LightParams) [4][256]uint8 {
	var lut [4][256]uint8
	e := 0.0
	if p.Enable {
		e = math.Min(1024, math.Max(0, float64(p.Value))) / 1024
	}
	for m := 0; m < 4; m++ {
		per := float64(p.Gain) * e * float64(p.Refl[m]) * 255
		mean := s.Means[m]
		for v := 0; v < 256; v++ {
			t := 1.0
			if mean > 0 {
				t = math.Min(4, math.Max(0, float64(v)/mean))
			}
			tp := 1 + float64(p.TexStrength)*(t-1)
			g := math.Round(per*tp + float64(p.Offset))
			if g < 0 {
				g = 0
			} else if g > 255 {
				g = 255
			}
			lut[m][v] = uint8(g)
		}
	}
	return lut
}

// Render writes RGBA pixels into dst (len 4*W*H) using all cores and returns the GV histogram.
func (s *Scene) Render(lut *[4][256]uint8, dst []byte) [256]uint32 {
	n := s.W * s.H
	workers := runtime.NumCPU()
	chunk := (n + workers - 1) / workers
	hists := make([][256]uint32, workers)
	var wg sync.WaitGroup
	for wi := 0; wi < workers; wi++ {
		start := wi * chunk
		end := start + chunk
		if end > n {
			end = n
		}
		if start >= end {
			continue
		}
		wg.Add(1)
		go func(wi, start, end int) {
			defer wg.Done()
			h := &hists[wi]
			med := s.Median
			mat := s.Material
			for i := start; i < end; i++ {
				g := lut[mat[i]][med[i]]
				h[g]++
				o := i * 4
				dst[o] = g
				dst[o+1] = g
				dst[o+2] = g
				dst[o+3] = 255
			}
		}(wi, start, end)
	}
	wg.Wait()
	var total [256]uint32
	for _, h := range hists {
		for i, v := range h {
			total[i] += v
		}
	}
	return total
}
