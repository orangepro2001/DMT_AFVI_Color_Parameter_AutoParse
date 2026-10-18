// Package core 提供灰度图像、随机数、光照渲染、几何变换与 ROI 对齐等基础算法。
package core

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"math"
	"os"

	"golang.org/x/image/tiff"
)

func openFile(path string) (*os.File, error) {
	return os.Open(path)
}

// GrayImage 是 8 位单通道灰度图像，Data 按行优先存储。
type GrayImage struct {
	Width  int
	Height int
	Data   []uint8
}

// Rect 是浮点矩形区域。
type Rect struct {
	X, Y, W, H float64
}

// Point 是浮点二维点。
type Point struct {
	X, Y float64
}

// ClampByte 与 TS clampByte 一致：非有限值→0；Math.round 语义（math.Floor(v+0.5)）；钳到 0..255。
func ClampByte(v float64) uint8 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	r := math.Floor(v + 0.5)
	if r < 0 {
		return 0
	}
	if r > 255 {
		return 255
	}
	return uint8(r)
}

// NewGray 创建 width×height 的灰度图，width/height<=0 时 panic（与 TS 抛错对应）。
func NewGray(width, height int, fill uint8) *GrayImage {
	if width <= 0 || height <= 0 {
		panic(fmt.Sprintf("NewGray: invalid size %dx%d", width, height))
	}
	data := make([]uint8, width*height)
	if fill != 0 {
		for i := range data {
			data[i] = fill
		}
	}
	return &GrayImage{Width: width, Height: height, Data: data}
}

// Clone 返回独立副本。
func (g *GrayImage) Clone() *GrayImage {
	data := make([]uint8, len(g.Data))
	copy(data, g.Data)
	return &GrayImage{Width: g.Width, Height: g.Height, Data: data}
}

// GetPixel 返回 (x,y) 处像素，越界时 panic（与 TS getPixel 抛错对应）。
func (g *GrayImage) GetPixel(x, y int) uint8 {
	if x < 0 || y < 0 || x >= g.Width || y >= g.Height {
		panic(fmt.Sprintf("GetPixel: out of bounds (%d,%d) for %dx%d", x, y, g.Width, g.Height))
	}
	return g.Data[y*g.Width+x]
}

// SampleBilinear 双线性采样；越界或非有限坐标返回 (0,false)。
func SampleBilinear(img *GrayImage, x, y float64) (float64, bool) {
	if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		return 0, false
	}
	if x < 0 || y < 0 || x > float64(img.Width-1) || y > float64(img.Height-1) {
		return 0, false
	}
	x0 := int(math.Floor(x))
	y0 := int(math.Floor(y))
	x1 := x0 + 1
	if x1 > img.Width-1 {
		x1 = img.Width - 1
	}
	y1 := y0 + 1
	if y1 > img.Height-1 {
		y1 = img.Height - 1
	}
	fx := x - float64(x0)
	fy := y - float64(y0)
	w := img.Width
	v00 := float64(img.Data[y0*w+x0])
	v10 := float64(img.Data[y0*w+x1])
	v01 := float64(img.Data[y1*w+x0])
	v11 := float64(img.Data[y1*w+x1])
	top := v00 + (v10-v00)*fx
	bottom := v01 + (v11-v01)*fx
	return top + (bottom-top)*fy, true
}

func gaussianKernel(sigma float64) []float64 {
	radius := int(math.Ceil(3 * sigma))
	size := radius*2 + 1
	kernel := make([]float64, size)
	denom := 2 * sigma * sigma
	sum := 0.0
	for i := 0; i < size; i++ {
		d := float64(i - radius)
		v := math.Exp(-(d * d) / denom)
		kernel[i] = v
		sum += v
	}
	for i := 0; i < size; i++ {
		kernel[i] /= sum
	}
	return kernel
}

// GaussianBlur 高斯模糊；sigma<=0 时返回副本。
func GaussianBlur(img *GrayImage, sigma float64) *GrayImage {
	if !(sigma > 0) {
		return img.Clone()
	}
	kernel := gaussianKernel(sigma)
	radius := (len(kernel) - 1) / 2
	width := img.Width
	height := img.Height
	tmp := make([]float64, width*height)
	for y := 0; y < height; y++ {
		row := y * width
		for x := 0; x < width; x++ {
			acc := 0.0
			for k := -radius; k <= radius; k++ {
				sx := x + k
				if sx < 0 {
					sx = 0
				} else if sx > width-1 {
					sx = width - 1
				}
				acc += float64(img.Data[row+sx]) * kernel[k+radius]
			}
			tmp[row+x] = acc
		}
	}
	out := make([]uint8, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			acc := 0.0
			for k := -radius; k <= radius; k++ {
				sy := y + k
				if sy < 0 {
					sy = 0
				} else if sy > height-1 {
					sy = height - 1
				}
				acc += tmp[sy*width+x] * kernel[k+radius]
			}
			out[y*width+x] = ClampByte(acc)
		}
	}
	return &GrayImage{Width: width, Height: height, Data: out}
}

// DownsampleArea 按 factor×factor 块求均值下采样；factor<1 返回错误。
func DownsampleArea(img *GrayImage, factor int) (*GrayImage, error) {
	if factor < 1 {
		return nil, fmt.Errorf("DownsampleArea: invalid factor %d", factor)
	}
	if factor == 1 {
		return img.Clone(), nil
	}
	outW := img.Width / factor
	if outW < 1 {
		outW = 1
	}
	outH := img.Height / factor
	if outH < 1 {
		outH = 1
	}
	out := make([]uint8, outW*outH)
	inv := 1.0 / float64(factor*factor)
	for oy := 0; oy < outH; oy++ {
		for ox := 0; ox < outW; ox++ {
			sum := 0.0
			for dy := 0; dy < factor; dy++ {
				sy := oy*factor + dy
				row := sy * img.Width
				for dx := 0; dx < factor; dx++ {
					sum += float64(img.Data[row+ox*factor+dx])
				}
			}
			out[oy*outW+ox] = ClampByte(sum * inv)
		}
	}
	return &GrayImage{Width: outW, Height: outH, Data: out}, nil
}

// CropGray 裁剪矩形区域并钳到图像边界；空区域返回错误。
func CropGray(img *GrayImage, r Rect) (*GrayImage, error) {
	x0 := int(math.Floor(math.Max(r.X, 0)))
	y0 := int(math.Floor(math.Max(r.Y, 0)))
	x1 := int(math.Ceil(r.X + r.W))
	if x1 > img.Width {
		x1 = img.Width
	}
	y1 := int(math.Ceil(r.Y + r.H))
	if y1 > img.Height {
		y1 = img.Height
	}
	w := x1 - x0
	h := y1 - y0
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("CropGray: empty region %+v", r)
	}
	out := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		src := (y0 + y) * img.Width
		copy(out[y*w:(y+1)*w], img.Data[src+x0:src+x0+w])
	}
	return &GrayImage{Width: w, Height: h, Data: out}, nil
}

// ReadTiffGray 读取 TIFF 并转为 8 位灰度图。
func ReadTiffGray(path string) (*GrayImage, error) {
	f, err := openFile(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := tiff.Decode(f)
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	w := b.Dx()
	h := b.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("ReadTiffGray: empty image")
	}
	if g, ok := img.(*image.Gray); ok {
		out := make([]uint8, w*h)
		for y := 0; y < h; y++ {
			src := g.PixOffset(b.Min.X, b.Min.Y+y)
			copy(out[y*w:(y+1)*w], g.Pix[src:src+w])
		}
		return &GrayImage{Width: w, Height: h, Data: out}, nil
	}
	out := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.GrayModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.Gray)
			out[y*w+x] = c.Y
		}
	}
	return &GrayImage{Width: w, Height: h, Data: out}, nil
}
