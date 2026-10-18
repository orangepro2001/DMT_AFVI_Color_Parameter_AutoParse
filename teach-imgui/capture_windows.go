//go:build windows

package main

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"syscall"
	"unsafe"
)

var (
	user32                     = syscall.NewLazyDLL("user32.dll")
	gdi32                      = syscall.NewLazyDLL("gdi32.dll")
	procFindWindowW            = user32.NewProc("FindWindowW")
	procGetClientRect          = user32.NewProc("GetClientRect")
	procGetDC                  = user32.NewProc("GetDC")
	procReleaseDC              = user32.NewProc("ReleaseDC")
	procPrintWindow            = user32.NewProc("PrintWindow")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
)

type winRect struct{ Left, Top, Right, Bottom int32 }

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// captureWindow saves the client area of the window with the given title as PNG.
// It must run on the thread that owns the window (PrintWindow sends WM_PRINT).
func captureWindow(title, path string) error {
	t, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return err
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(t)))
	if hwnd == 0 {
		return fmt.Errorf("window %q not found", title)
	}
	var r winRect
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	w, h := int(r.Right-r.Left), int(r.Bottom-r.Top)
	if w <= 0 || h <= 0 {
		return fmt.Errorf("empty client rect %dx%d", w, h)
	}
	hdc, _, _ := procGetDC.Call(hwnd)
	defer procReleaseDC.Call(hwnd, hdc)
	mem, _, _ := procCreateCompatibleDC.Call(hdc)
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(hdc, uintptr(w), uintptr(h))
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	const pwClientOnly, pwRenderFullContent = 1, 2
	ok, _, _ := procPrintWindow.Call(hwnd, mem, pwClientOnly|pwRenderFullContent)
	procSelectObject.Call(mem, old)
	if ok == 0 {
		return fmt.Errorf("PrintWindow failed")
	}
	bi := bitmapInfoHeader{Size: 40, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
	buf := make([]byte, w*h*4)
	lines, _, _ := procGetDIBits.Call(mem, bmp, 0, uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)
	if lines == 0 {
		return fmt.Errorf("GetDIBits failed")
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		img.Pix[4*i] = buf[4*i+2]
		img.Pix[4*i+1] = buf[4*i+1]
		img.Pix[4*i+2] = buf[4*i]
		img.Pix[4*i+3] = 255
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}
