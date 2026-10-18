package core

import (
	"math"
	"testing"
)

func TestSampleBilinearIntegerCoordinates(t *testing.T) {
	img := NewGray(4, 3, 0)
	img.Data[1*4+2] = 200
	if v, ok := SampleBilinear(img, 2, 1); !ok || v != 200 {
		t.Fatalf("expected 200, got %v ok=%v", v, ok)
	}
	if v, ok := SampleBilinear(img, 0, 0); !ok || v != 0 {
		t.Fatalf("expected 0, got %v ok=%v", v, ok)
	}
}

func TestSampleBilinearMidpoint(t *testing.T) {
	img := NewGray(2, 2, 0)
	img.Data[0] = 0
	img.Data[1] = 100
	img.Data[2] = 200
	img.Data[3] = 300 % 256
	mid, ok := SampleBilinear(img, 0.5, 0.5)
	if !ok {
		t.Fatalf("expected ok")
	}
	want := (0.0 + 100.0 + 200.0 + 44.0) / 4
	if math.Abs(mid-want) > 1e-9 {
		t.Fatalf("expected %v, got %v", want, mid)
	}
}

func TestSampleBilinearOutOfBounds(t *testing.T) {
	img := NewGray(3, 3, 0)
	if _, ok := SampleBilinear(img, -0.1, 0); ok {
		t.Fatalf("expected false for -0.1")
	}
	if _, ok := SampleBilinear(img, 0, -1); ok {
		t.Fatalf("expected false for y=-1")
	}
	if _, ok := SampleBilinear(img, 3, 0); ok {
		t.Fatalf("expected false for x=3")
	}
	if _, ok := SampleBilinear(img, 0, 3); ok {
		t.Fatalf("expected false for y=3")
	}
}

func TestGaussianBlurSigmaZeroCopy(t *testing.T) {
	img := NewGray(3, 3, 10)
	out := GaussianBlur(img, 0)
	if &out.Data[0] == &img.Data[0] {
		t.Fatalf("expected independent copy")
	}
	for i := range img.Data {
		if out.Data[i] != img.Data[i] {
			t.Fatalf("mismatch at %d", i)
		}
	}
}

func TestGaussianBlurConstantUnchanged(t *testing.T) {
	img := NewGray(8, 8, 77)
	out := GaussianBlur(img, 1.5)
	for _, v := range out.Data {
		if v != 77 {
			t.Fatalf("expected 77, got %d", v)
		}
	}
}

func TestDownsampleAreaAverages2x2(t *testing.T) {
	img := NewGray(4, 4, 0)
	img.Data[0] = 0
	img.Data[1] = 100
	img.Data[4] = 200
	img.Data[5] = 44
	out, err := DownsampleArea(img, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Width != 2 || out.Height != 2 {
		t.Fatalf("expected 2x2, got %dx%d", out.Width, out.Height)
	}
	want := ClampByte((0 + 100 + 200 + 44) / 4.0)
	if out.Data[0] != want {
		t.Fatalf("expected %d, got %d", want, out.Data[0])
	}
}

func TestDownsampleAreaFactorOneCopy(t *testing.T) {
	img := NewGray(3, 3, 5)
	out, err := DownsampleArea(img, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if &out.Data[0] == &img.Data[0] {
		t.Fatalf("expected independent copy")
	}
	for i := range img.Data {
		if out.Data[i] != img.Data[i] {
			t.Fatalf("mismatch at %d", i)
		}
	}
}

func TestCropGrayClampsToBounds(t *testing.T) {
	img := NewGray(5, 5, 3)
	out, err := CropGray(img, Rect{X: -2, Y: -2, W: 4, H: 4})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Width != 2 || out.Height != 2 {
		t.Fatalf("expected 2x2, got %dx%d", out.Width, out.Height)
	}
	if out.GetPixel(0, 0) != 3 {
		t.Fatalf("expected 3, got %d", out.GetPixel(0, 0))
	}
}

func TestCropGrayEmptyRegion(t *testing.T) {
	img := NewGray(5, 5, 0)
	if _, err := CropGray(img, Rect{X: 10, Y: 10, W: 2, H: 2}); err == nil {
		t.Fatalf("expected error")
	}
}

func TestClampByteRoundsAndClamps(t *testing.T) {
	if ClampByte(-5) != 0 {
		t.Fatalf("expected 0")
	}
	if ClampByte(300) != 255 {
		t.Fatalf("expected 255")
	}
	if ClampByte(12.6) != 13 {
		t.Fatalf("expected 13")
	}
	if ClampByte(12.4) != 12 {
		t.Fatalf("expected 12")
	}
}

func TestCloneGrayIndependent(t *testing.T) {
	img := NewGray(2, 2, 1)
	copyImg := img.Clone()
	copyImg.Data[0] = 9
	if img.Data[0] != 1 {
		t.Fatalf("expected 1, got %d", img.Data[0])
	}
}
