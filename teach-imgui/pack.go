package main

import (
	"runtime"
	"sync"

	"afvi/teach-imgui/core"
)

// RGBA buffers for full-resolution textures are ~94 MB; recycle them instead of
// leaving every light/defect re-render to the garbage collector.
var rgbaPool sync.Pool

// GetRGBA returns a buffer of exactly n bytes, reusing a pooled one when large enough.
func GetRGBA(n int) []byte {
	if p, ok := rgbaPool.Get().(*[]byte); ok && cap(*p) >= n {
		return (*p)[:n]
	}
	return make([]byte, n)
}

// PutRGBA returns a buffer to the pool once its pixels have been uploaded.
func PutRGBA(b []byte) {
	if cap(b) == 0 {
		return
	}
	b = b[:0]
	rgbaPool.Put(&b)
}

// parallelRows runs fn over [0,n) split into one contiguous chunk per CPU.
func parallelRows(n int, fn func(start, end int)) {
	workers := runtime.NumCPU()
	if workers < 1 || n < 65536 {
		fn(0, n)
		return
	}
	chunk := (n + workers - 1) / workers
	var wg sync.WaitGroup
	for start := 0; start < n; start += chunk {
		end := start + chunk
		if end > n {
			end = n
		}
		wg.Add(1)
		go func(s, e int) {
			defer wg.Done()
			fn(s, e)
		}(start, end)
	}
	wg.Wait()
}

// PackGray expands an 8-bit image to opaque RGBA.
func PackGray(img *core.GrayImage) []byte {
	n := img.Width * img.Height
	dst := GetRGBA(4 * n)
	src := img.Data
	parallelRows(n, func(s, e int) {
		for i := s; i < e; i++ {
			v := src[i]
			o := 4 * i
			dst[o], dst[o+1], dst[o+2], dst[o+3] = v, v, v, 255
		}
	})
	return dst
}

// PackRGB interleaves three channel images into RGBA.
func PackRGB(r, g, b *core.GrayImage) []byte {
	n := r.Width * r.Height
	dst := GetRGBA(4 * n)
	parallelRows(n, func(s, e int) {
		for i := s; i < e; i++ {
			o := 4 * i
			dst[o], dst[o+1], dst[o+2], dst[o+3] = r.Data[i], g.Data[i], b.Data[i], 255
		}
	})
	return dst
}

// MaterialPalette matches the web viewer's material map colors (base, sr, open, metal).
var MaterialPalette = [4][3]uint8{{46, 46, 46}, {51, 191, 77}, {166, 115, 51}, {242, 204, 64}}

// PackMaterial colors the material index map.
func PackMaterial(material []uint8) []byte {
	n := len(material)
	dst := GetRGBA(4 * n)
	parallelRows(n, func(s, e int) {
		for i := s; i < e; i++ {
			c := MaterialPalette[material[i]&3]
			o := 4 * i
			dst[o], dst[o+1], dst[o+2], dst[o+3] = c[0], c[1], c[2], 255
		}
	})
	return dst
}

// PackSignedDiff renders test-golden as 128+diff (clamped), the web "difference" view.
func PackSignedDiff(golden, test *core.GrayImage) []byte {
	n := golden.Width * golden.Height
	dst := GetRGBA(4 * n)
	parallelRows(n, func(s, e int) {
		for i := s; i < e; i++ {
			v := 128 + int(test.Data[i]) - int(golden.Data[i])
			if v < 0 {
				v = 0
			} else if v > 255 {
				v = 255
			}
			o := 4 * i
			b := uint8(v)
			dst[o], dst[o+1], dst[o+2], dst[o+3] = b, b, b, 255
		}
	})
	return dst
}

// PackAbsDiff renders |a-b|, the web alignment "difference" view.
func PackAbsDiff(a, b *core.GrayImage) []byte {
	n := a.Width * a.Height
	if m := b.Width * b.Height; m < n {
		n = m
	}
	dst := GetRGBA(4 * a.Width * a.Height)
	parallelRows(n, func(s, e int) {
		for i := s; i < e; i++ {
			d := int(a.Data[i]) - int(b.Data[i])
			if d < 0 {
				d = -d
			}
			o := 4 * i
			v := uint8(d)
			dst[o], dst[o+1], dst[o+2], dst[o+3] = v, v, v, 255
		}
	})
	return dst
}
