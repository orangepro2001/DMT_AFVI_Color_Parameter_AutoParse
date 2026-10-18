package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"afvi/teach-imgui/core"
)

// ModelInfo describes one reference model; paths are absolute. Pattern/AlignSpec may be "".
type ModelInfo struct {
	ID, Host, Model, Side, Version string
	Metal, SR, Open, Median        string
	Pattern, AlignSpec             string
}

var hosts = []string{"FM1", "FM2", "BM"}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func looksLikeReference(dir string) bool {
	for _, h := range hosts {
		if isDir(filepath.Join(dir, h)) {
			return true
		}
	}
	return false
}

// FindReferenceRoot resolves the reference directory: -ref flag, AFVI_REFERENCE_DIR,
// reference/ next to the exe (or up to 5 parents), then the working directory (and parents).
func FindReferenceRoot(override string) (string, error) {
	var candidates []string
	if override != "" {
		candidates = append(candidates, override)
	}
	if env := os.Getenv("AFVI_REFERENCE_DIR"); env != "" {
		candidates = append(candidates, env)
	}
	walk := func(start string) {
		dir := start
		for i := 0; i <= 5 && dir != ""; i++ {
			candidates = append(candidates, filepath.Join(dir, "reference"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if exe, err := os.Executable(); err == nil {
		walk(filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		walk(wd)
	}
	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil && looksLikeReference(abs) {
			return abs, nil
		}
	}
	return "", errors.New("reference directory not found")
}

func listDirs(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func normalizeModelKey(name string) string {
	s := strings.ToUpper(name)
	return strings.TrimSuffix(s, "-00")
}

func medianPath(modelDir, version, side string) string {
	return filepath.Join(modelDir, version, "Line", side, "Layer", "MEDIAN", "Median_0_1_0.tif")
}

// ScanModels mirrors teach-app/server.ts scanModels: every PxRepository model with
// Metal/SR/Open and a version holding MEDIAN (preferring 2.0 for FM, 3.5 for BM).
func ScanModels(refRoot string) []ModelInfo {
	var out []ModelInfo
	for _, host := range hosts {
		repo := filepath.Join(refRoot, host, "PxRepository")
		for _, model := range listDirs(repo) {
			modelDir := filepath.Join(repo, model)
			metal, sr, open := filepath.Join(modelDir, "Metal.tif"), filepath.Join(modelDir, "SR.tif"), filepath.Join(modelDir, "Open.tif")
			if !isFile(metal) || !isFile(sr) || !isFile(open) {
				continue
			}
			side, preferred := "TOP", "2.0"
			if host == "BM" {
				side, preferred = "BOTTOM", "3.5"
			}
			sideDir := map[string]string{"TOP": "Top", "BOTTOM": "Bottom"}[side]
			version := ""
			if isFile(medianPath(modelDir, preferred, sideDir)) {
				version = preferred
			} else {
				for _, v := range listDirs(modelDir) {
					if isFile(medianPath(modelDir, v, sideDir)) {
						version = v
						break
					}
				}
			}
			if version == "" {
				continue
			}
			info := ModelInfo{
				ID: host + "/" + model, Host: host, Model: model, Side: side, Version: version,
				Metal: metal, SR: sr, Open: open, Median: medianPath(modelDir, version, sideDir),
			}
			if p := filepath.Join(modelDir, version, "Line", sideDir, "Layer", "GB", "Pattern.tif"); isFile(p) {
				info.Pattern = p
			}
			specRoot := filepath.Join(refRoot, host, "PxInventory", "INSPECT_SPEC")
			for _, dir := range listDirs(specRoot) {
				if normalizeModelKey(dir) != normalizeModelKey(model) {
					continue
				}
				if p := filepath.Join(specRoot, dir, side, "AlignSpec.xml"); isFile(p) {
					info.AlignSpec = p
					break
				}
			}
			out = append(out, info)
		}
	}
	return out
}

var (
	reUnit   = regexp.MustCompile(`(?is)<Unit\b[^>]*>(.*?)</Unit>`)
	reParam  = regexp.MustCompile(`(?i)<Param\b([^>]*)/?>`)
	reType   = regexp.MustCompile(`(?i)Type="(\d+)"`)
	reID     = regexp.MustCompile(`(?i)ID="(\d+)"`)
	reLeft   = regexp.MustCompile(`(?i)Left="(-?\d+)"`)
	reTop    = regexp.MustCompile(`(?i)Top="(-?\d+)"`)
	reRight  = regexp.MustCompile(`(?i)Right="(-?\d+)"`)
	reBottom = regexp.MustCompile(`(?i)Bottom="(-?\d+)"`)
)

// ParseAlignSpec mirrors teach-app/src/worker.ts parseAlignSpec: Type="0" Params of the
// first <Unit> become machine ROIs named P<ID>.
func ParseAlignSpec(xml string) []core.AlignRoi {
	var rois []core.AlignRoi
	unit := reUnit.FindStringSubmatch(xml)
	if unit == nil {
		return rois
	}
	for _, m := range reParam.FindAllStringSubmatch(unit[1], -1) {
		attrs := m[1]
		typ := reType.FindStringSubmatch(attrs)
		if typ == nil || typ[1] != "0" {
			continue
		}
		id, l, t, r, b := reID.FindStringSubmatch(attrs), reLeft.FindStringSubmatch(attrs), reTop.FindStringSubmatch(attrs), reRight.FindStringSubmatch(attrs), reBottom.FindStringSubmatch(attrs)
		if id == nil || l == nil || t == nil || r == nil || b == nil {
			continue
		}
		x, _ := strconv.Atoi(l[1])
		y, _ := strconv.Atoi(t[1])
		right, _ := strconv.Atoi(r[1])
		bottom, _ := strconv.Atoi(b[1])
		w, h := right-x, bottom-y
		if w <= 0 || h <= 0 {
			continue
		}
		rois = append(rois, core.AlignRoi{Name: "P" + id[1], Rect: core.Rect{X: float64(x), Y: float64(y), W: float64(w), H: float64(h)}})
	}
	return rois
}

// Scene is the loaded model shared by all panels; treat it as read-only.
type Scene struct {
	Info        ModelInfo
	W, H        int
	Median      *core.GrayImage
	Material    []uint8
	Light       *core.LightScene
	Stats       [4]core.MaterialStat // MEDIAN statistics per material
	MachineRois []core.AlignRoi
	LoadMs      float64
}

// LoadScene decodes the four layers in parallel and builds the light scene.
func LoadScene(info ModelInfo) (*Scene, error) {
	start := time.Now()
	paths := []string{info.Metal, info.SR, info.Open, info.Median}
	imgs := make([]*core.GrayImage, len(paths))
	errs := make([]error, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			imgs[i], errs[i] = core.ReadTiffGray(p)
		}(i, p)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Base(paths[i]), err)
		}
	}
	material, err := core.BuildMaterialMap(imgs[0], imgs[1], imgs[2], 128)
	if err != nil {
		return nil, err
	}
	median := imgs[3]
	if median.Width*median.Height != len(material) {
		return nil, fmt.Errorf("MEDIAN %dx%d does not match layers", median.Width, median.Height)
	}
	light, err := core.NewLightScene(median, material)
	if err != nil {
		return nil, err
	}
	stats, err := core.MaterialStats(median, material)
	if err != nil {
		return nil, err
	}
	s := &Scene{Info: info, W: median.Width, H: median.Height, Median: median, Material: material, Light: light, Stats: stats}
	if info.AlignSpec != "" {
		if data, err := os.ReadFile(info.AlignSpec); err == nil {
			s.MachineRois = ParseAlignSpec(strings.TrimPrefix(string(data), "\xef\xbb\xbf"))
		}
	}
	s.LoadMs = float64(time.Since(start).Microseconds()) / 1000
	return s, nil
}
