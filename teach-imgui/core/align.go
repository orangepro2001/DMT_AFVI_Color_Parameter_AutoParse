package core

import (
	"fmt"
	"math"
	"runtime"
	"sync"
)

// AlignRoi 是带名字的对齐 ROI。
type AlignRoi struct {
	Name string
	Rect
}

// AlignConfig 是对齐配置。
type AlignConfig struct {
	SearchRadius      float64
	PyramidFactor     int
	MinNcc            float64
	MinUniqueness     float64
	RansacThresholdPx float64
	RansacIterations  int
	OkResidualPx      float64
	NgResidualPx      float64
	Seed              uint32
}

// DefaultAlignConfig 是默认对齐配置。
var DefaultAlignConfig = AlignConfig{
	SearchRadius:      120,
	PyramidFactor:     4,
	MinNcc:            0.6,
	MinUniqueness:     0.15,
	RansacThresholdPx: 3,
	RansacIterations:  200,
	OkResidualPx:      1.5,
	NgResidualPx:      5,
	Seed:              1,
}

// NccSurface 是 NCC 搜索面。
type NccSurface struct {
	Width, Height    int
	OriginX, OriginY float64
	Step             int
	Values           []float32
}

// RoiMatch 是单个 ROI 的匹配结果。
type RoiMatch struct {
	Name       string
	Template   Point
	Expected   Point
	Found      *Point
	Ncc        float64
	SecondNcc  float64
	Uniqueness float64
	Located    bool
	Reason     string
	Surface    *NccSurface
}

// VerdictLevel 是判定等级。
type VerdictLevel string

// 判定等级常量。
const (
	VerdictOK     VerdictLevel = "ok"
	VerdictManual VerdictLevel = "manual"
	VerdictNG     VerdictLevel = "ng"
)

// AlignVerdictReason 是判定原因。
type AlignVerdictReason struct {
	Code    string
	Message string
}

// AlignReport 是对齐报告。
type AlignReport struct {
	Matches     []RoiMatch
	Fit         *Similarity
	Inliers     []int
	Residuals   []float64
	ResidualRms float64
	MeanNcc     float64
	Level       VerdictLevel
	Reasons     []AlignVerdictReason
}

// TruthComparison 是与真值的比较结果。
type TruthComparison struct {
	PerRoiErrorPx []float64
	MeanErrorPx   float64
	MaxErrorPx    float64
}

// Ncc 计算归一化互相关。
func Ncc(a, b []float32) float64 {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	if n == 0 {
		return 0
	}
	meanA := 0.0
	meanB := 0.0
	for i := 0; i < n; i++ {
		meanA += float64(a[i])
		meanB += float64(b[i])
	}
	meanA /= float64(n)
	meanB /= float64(n)
	num := 0.0
	varA := 0.0
	varB := 0.0
	for i := 0; i < n; i++ {
		da := float64(a[i]) - meanA
		db := float64(b[i]) - meanB
		num += da * db
		varA += da * da
		varB += db * db
	}
	if varA <= 0 || varB <= 0 {
		return 0
	}
	return num / math.Sqrt(varA*varB)
}

func patchStd(img *GrayImage, roi Rect) float64 {
	x0 := int(math.Floor(math.Max(roi.X, 0)))
	y0 := int(math.Floor(math.Max(roi.Y, 0)))
	x1 := int(math.Ceil(roi.X + roi.W))
	if x1 > img.Width {
		x1 = img.Width
	}
	y1 := int(math.Ceil(roi.Y + roi.H))
	if y1 > img.Height {
		y1 = img.Height
	}
	w := x1 - x0
	h := y1 - y0
	if w <= 0 || h <= 0 {
		return 0
	}
	sum := 0.0
	sumSq := 0.0
	count := w * h
	for y := y0; y < y1; y++ {
		row := y * img.Width
		for x := x0; x < x1; x++ {
			v := float64(img.Data[row+x])
			sum += v
			sumSq += v * v
		}
	}
	mean := sum / float64(count)
	v := sumSq/float64(count) - mean*mean
	if v < 0 {
		v = 0
	}
	return math.Sqrt(v)
}

func extractPatch(img *GrayImage, x0, y0, w, h int) ([]float32, bool) {
	if x0 < 0 || y0 < 0 || x0+w > img.Width || y0+h > img.Height {
		return nil, false
	}
	out := make([]float32, w*h)
	for y := 0; y < h; y++ {
		row := (y0 + y) * img.Width
		for x := 0; x < w; x++ {
			out[y*w+x] = float32(img.Data[row+x0+x])
		}
	}
	return out, true
}

func nccAt(img *GrayImage, patch []float32, pw, ph, x0, y0 int) float64 {
	sub, ok := extractPatch(img, x0, y0, pw, ph)
	if !ok {
		return -2
	}
	return Ncc(patch, sub)
}

// MatchRoi 在 input 中匹配单个 ROI。
func MatchRoi(template, input *GrayImage, roi AlignRoi, prior Similarity, cfg AlignConfig) RoiMatch {
	f := cfg.PyramidFactor
	if f < 1 {
		f = 1
	}
	tplSmall, err := DownsampleArea(template, f)
	if err != nil {
		return RoiMatch{Name: roi.Name, Reason: "out-of-range"}
	}
	inSmall, err := DownsampleArea(input, f)
	if err != nil {
		return RoiMatch{Name: roi.Name, Reason: "out-of-range"}
	}
	return matchRoiPyramid(template, input, tplSmall, inSmall, f, roi, prior, cfg)
}

func matchRoiPyramid(
	template, input, tplSmall, inSmall *GrayImage,
	f int,
	roi AlignRoi,
	prior Similarity,
	cfg AlignConfig,
) RoiMatch {
	center := Point{X: roi.X + roi.W/2, Y: roi.Y + roi.H/2}
	expected := ApplySimilarity(prior, center)
	base := RoiMatch{
		Name:     roi.Name,
		Template: center,
		Expected: expected,
	}

	pw := int(math.Round(roi.W))
	if pw < 1 {
		pw = 1
	}
	ph := int(math.Round(roi.H))
	if ph < 1 {
		ph = 1
	}
	px0 := int(math.Floor(roi.X))
	if px0 < 0 {
		px0 = 0
	}
	py0 := int(math.Floor(roi.Y))
	if py0 < 0 {
		py0 = 0
	}
	patch, ok := extractPatch(template, px0, py0, pw, ph)
	if !ok {
		base.Reason = "out-of-range"
		return base
	}
	if patchStd(template, roi.Rect) < 2 {
		base.Reason = "flat"
		return base
	}

	pwS := pw / f
	if pwS < 1 {
		pwS = 1
	}
	phS := ph / f
	if phS < 1 {
		phS = 1
	}
	patchSmall, ok := extractPatch(tplSmall, px0/f, py0/f, pwS, phS)
	if !ok {
		base.Reason = "out-of-range"
		return base
	}

	radiusS := int(math.Ceil(cfg.SearchRadius / float64(f)))
	cxS := int(math.Round((expected.X - float64(pw)/2) / float64(f)))
	cyS := int(math.Round((expected.Y - float64(ph)/2) / float64(f)))
	originX := cxS - radiusS
	originY := cyS - radiusS
	sizeS := radiusS*2 + 1
	values := make([]float32, sizeS*sizeS)
	for i := range values {
		values[i] = -2
	}
	peak := -2.0
	peakX := 0
	peakY := 0
	anyValid := false
	for dy := 0; dy < sizeS; dy++ {
		for dx := 0; dx < sizeS; dx++ {
			x0 := originX + dx
			y0 := originY + dy
			score := nccAt(inSmall, patchSmall, pwS, phS, x0, y0)
			values[dy*sizeS+dx] = float32(score)
			if score > -2 {
				anyValid = true
			}
			if score > peak {
				peak = score
				peakX = dx
				peakY = dy
			}
		}
	}
	if !anyValid {
		base.Reason = "out-of-range"
		return base
	}

	surface := &NccSurface{
		Width:   sizeS,
		Height:  sizeS,
		OriginX: float64(originX * f),
		OriginY: float64(originY * f),
		Step:    f,
		Values:  values,
	}

	minSep := int(math.Floor(float64(minInt(roi.W, roi.H)) / (2 * float64(f))))
	if minSep < 2 {
		minSep = 2
	}
	second := -2.0
	for dy := 0; dy < sizeS; dy++ {
		for dx := 0; dx < sizeS; dx++ {
			if maxInt(absInt(dx-peakX), absInt(dy-peakY)) <= minSep {
				continue
			}
			score := float64(values[dy*sizeS+dx])
			if score > second {
				second = score
			}
		}
	}
	if second < -1 {
		second = 0
	}

	fineX := originX*f + peakX*f
	fineY := originY*f + peakY*f
	rangeV := f + 1
	bestScore := -2.0
	bestX := fineX
	bestY := fineY
	gridSize := rangeV*2 + 1
	scoreGrid := make([]float64, gridSize*gridSize)
	for i := range scoreGrid {
		scoreGrid[i] = -2
	}
	for dy := -rangeV; dy <= rangeV; dy++ {
		for dx := -rangeV; dx <= rangeV; dx++ {
			x0 := fineX + dx
			y0 := fineY + dy
			score := nccAt(input, patch, pw, ph, x0, y0)
			scoreGrid[(dy+rangeV)*gridSize+(dx+rangeV)] = score
			if score > bestScore {
				bestScore = score
				bestX = x0
				bestY = y0
			}
		}
	}

	getScore := func(dx, dy int) float64 {
		if dx < -rangeV || dx > rangeV || dy < -rangeV || dy > rangeV {
			return -2
		}
		return scoreGrid[(dy+rangeV)*gridSize+(dx+rangeV)]
	}
	bestDx := bestX - fineX
	bestDy := bestY - fineY
	subX := float64(bestX)
	subY := float64(bestY)
	s0x := getScore(bestDx-1, bestDy)
	s1x := getScore(bestDx, bestDy)
	s2x := getScore(bestDx+1, bestDy)
	if s0x > -2 && s1x > -2 && s2x > -2 {
		denom := s0x - 2*s1x + s2x
		if denom != 0 {
			delta := (0.5 * (s0x - s2x)) / denom
			if delta > -1 && delta < 1 {
				subX = float64(bestX) + delta
			}
		}
	}
	s0y := getScore(bestDx, bestDy-1)
	s1y := getScore(bestDx, bestDy)
	s2y := getScore(bestDx, bestDy+1)
	if s0y > -2 && s1y > -2 && s2y > -2 {
		denom := s0y - 2*s1y + s2y
		if denom != 0 {
			delta := (0.5 * (s0y - s2y)) / denom
			if delta > -1 && delta < 1 {
				subY = float64(bestY) + delta
			}
		}
	}

	found := Point{X: subX + float64(pw)/2, Y: subY + float64(ph)/2}
	uniqueness := bestScore - second
	located := bestScore >= cfg.MinNcc
	base.Found = &found
	base.Ncc = bestScore
	base.SecondNcc = second
	base.Uniqueness = uniqueness
	base.Located = located
	if located {
		base.Reason = ""
	} else {
		base.Reason = "low-ncc"
	}
	base.Surface = surface
	return base
}

// FitSimilarity 最小二乘拟合相似变换。
func FitSimilarity(src, dst []Point) (Similarity, bool) {
	n := len(src)
	if len(dst) < n {
		n = len(dst)
	}
	if n < 2 {
		return Similarity{}, false
	}
	mx := 0.0
	my := 0.0
	dx0 := 0.0
	dy0 := 0.0
	for i := 0; i < n; i++ {
		mx += src[i].X
		my += src[i].Y
		dx0 += dst[i].X
		dy0 += dst[i].Y
	}
	mx /= float64(n)
	my /= float64(n)
	dx0 /= float64(n)
	dy0 /= float64(n)
	numRe := 0.0
	numIm := 0.0
	den := 0.0
	for i := 0; i < n; i++ {
		sx := src[i].X - mx
		sy := src[i].Y - my
		tx := dst[i].X - dx0
		ty := dst[i].Y - dy0
		numRe += tx*sx + ty*sy
		numIm += ty*sx - tx*sy
		den += sx*sx + sy*sy
	}
	if den == 0 {
		return Similarity{}, false
	}
	aRe := numRe / den
	aIm := numIm / den
	scale := math.Hypot(aRe, aIm)
	thetaDeg := (math.Atan2(aIm, aRe) * 180) / math.Pi
	tx := dx0 - (aRe*mx - aIm*my)
	ty := dy0 - (aIm*mx + aRe*my)
	return Similarity{Tx: tx, Ty: ty, ThetaDeg: thetaDeg, Scale: scale}, true
}

func residual(s Similarity, p, q Point) float64 {
	f := ApplySimilarity(s, p)
	return math.Hypot(f.X-q.X, f.Y-q.Y)
}

// RansacSimilarity 用 RANSAC 拟合相似变换。
func RansacSimilarity(src, dst []Point, thresholdPx float64, iterations int, seed uint32) (*Similarity, []int) {
	n := len(src)
	if len(dst) < n {
		n = len(dst)
	}
	if n < 2 {
		return nil, nil
	}
	var bestFit *Similarity
	var bestInliers []int
	bestResidualSum := math.Inf(1)

	evaluate := func(fit Similarity, ok bool) {
		if !ok {
			return
		}
		inliers := make([]int, 0, n)
		sum := 0.0
		for i := 0; i < n; i++ {
			r := residual(fit, src[i], dst[i])
			if r < thresholdPx {
				inliers = append(inliers, i)
				sum += r
			}
		}
		if len(inliers) > len(bestInliers) || (len(inliers) == len(bestInliers) && sum < bestResidualSum) {
			f := fit
			bestFit = &f
			bestInliers = inliers
			bestResidualSum = sum
		}
	}

	if n <= 12 {
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				fit, ok := FitSimilarity([]Point{src[i], src[j]}, []Point{dst[i], dst[j]})
				evaluate(fit, ok)
			}
		}
	} else {
		rng := NewRng(seed)
		for it := 0; it < iterations; it++ {
			i := rng.NextInt(n)
			j := rng.NextInt(n)
			if j == i {
				j = (j + 1) % n
			}
			fit, ok := FitSimilarity([]Point{src[i], src[j]}, []Point{dst[i], dst[j]})
			evaluate(fit, ok)
		}
	}

	if bestFit == nil || len(bestInliers) < 2 {
		return bestFit, bestInliers
	}
	srcIn := make([]Point, len(bestInliers))
	dstIn := make([]Point, len(bestInliers))
	for k, i := range bestInliers {
		srcIn[k] = src[i]
		dstIn[k] = dst[i]
	}
	if refined, ok := FitSimilarity(srcIn, dstIn); ok {
		bestFit = &refined
	}
	return bestFit, bestInliers
}

// AlignWithRois 对多个 ROI 做对齐并给出判定。
func AlignWithRois(template, input *GrayImage, rois []AlignRoi, cfg AlignConfig, prior Similarity) AlignReport {
	f := cfg.PyramidFactor
	if f < 1 {
		f = 1
	}
	tplSmall, errT := DownsampleArea(template, f)
	inSmall, errI := DownsampleArea(input, f)
	matches := make([]RoiMatch, len(rois))
	if errT != nil || errI != nil {
		for i, roi := range rois {
			matches[i] = RoiMatch{Name: roi.Name, Reason: "out-of-range"}
		}
	} else {
		workers := runtime.NumCPU()
		if workers < 1 {
			workers = 1
		}
		if workers > len(rois) {
			workers = len(rois)
		}
		if workers <= 1 {
			for i, roi := range rois {
				matches[i] = matchRoiPyramid(template, input, tplSmall, inSmall, f, roi, prior, cfg)
			}
		} else {
			var wg sync.WaitGroup
			chunk := (len(rois) + workers - 1) / workers
			for w := 0; w < workers; w++ {
				i0 := w * chunk
				i1 := i0 + chunk
				if i1 > len(rois) {
					i1 = len(rois)
				}
				if i0 >= i1 {
					break
				}
				wg.Add(1)
				go func(i0, i1 int) {
					defer wg.Done()
					for i := i0; i < i1; i++ {
						matches[i] = matchRoiPyramid(template, input, tplSmall, inSmall, f, rois[i], prior, cfg)
					}
				}(i0, i1)
			}
			wg.Wait()
		}
	}

	locatedIdx := make([]int, 0, len(matches))
	src := make([]Point, 0, len(matches))
	dst := make([]Point, 0, len(matches))
	for i := range matches {
		m := &matches[i]
		if m.Located && m.Found != nil {
			locatedIdx = append(locatedIdx, i)
			src = append(src, m.Template)
			dst = append(dst, *m.Found)
		}
	}

	var fit *Similarity
	var inliers []int
	if len(src) >= 2 {
		fit, inliers = RansacSimilarity(src, dst, cfg.RansacThresholdPx, cfg.RansacIterations, cfg.Seed)
	}

	residuals := make([]float64, len(matches))
	for i := range residuals {
		residuals[i] = -1
	}
	residualRms := 0.0
	if fit != nil {
		sumSq := 0.0
		for _, idx := range inliers {
			m := &matches[locatedIdx[idx]]
			r := residual(*fit, m.Template, *m.Found)
			residuals[locatedIdx[idx]] = r
			sumSq += r * r
		}
		if len(inliers) > 0 {
			residualRms = math.Sqrt(sumSq / float64(len(inliers)))
		}
	}

	nccSum := 0.0
	nccCount := 0
	for i := range matches {
		if matches[i].Located {
			nccSum += matches[i].Ncc
			nccCount++
		}
	}
	meanNcc := 0.0
	if nccCount > 0 {
		meanNcc = nccSum / float64(nccCount)
	}

	reasons := make([]AlignVerdictReason, 0)
	level := VerdictOK

	locatedCount := len(locatedIdx)
	if locatedCount < 2 {
		level = VerdictNG
		reasons = append(reasons, AlignVerdictReason{
			Code:    "too-few-located",
			Message: fmt.Sprintf("定位成功的 ROI 只有 %d 个，至少需要 2 个", locatedCount),
		})
	}
	if fit == nil {
		level = VerdictNG
		reasons = append(reasons, AlignVerdictReason{Code: "no-fit", Message: "无法拟合相似变换"})
	}
	if fit != nil && residualRms > cfg.NgResidualPx {
		level = VerdictNG
		reasons = append(reasons, AlignVerdictReason{
			Code:    "residual-high",
			Message: fmt.Sprintf("内点残差 RMS %.3fpx 超过 NG 阈值 %.3gpx", residualRms, cfg.NgResidualPx),
		})
	}

	if level != VerdictNG {
		inlierSet := make(map[int]bool, len(inliers))
		for _, v := range inliers {
			inlierSet[v] = true
		}
		hasOutlier := false
		hasAmbiguous := false
		hasMissing := false
		for i := range matches {
			m := &matches[i]
			if !m.Located {
				hasMissing = true
				continue
			}
			localIdx := -1
			for k, v := range locatedIdx {
				if v == i {
					localIdx = k
					break
				}
			}
			if localIdx >= 0 && !inlierSet[localIdx] {
				hasOutlier = true
			}
			if m.Uniqueness < cfg.MinUniqueness {
				hasAmbiguous = true
			}
		}
		if hasOutlier {
			level = VerdictManual
			reasons = append(reasons, AlignVerdictReason{Code: "outlier", Message: "存在定位成功但被判定为外点的 ROI"})
		}
		if hasAmbiguous {
			level = VerdictManual
			reasons = append(reasons, AlignVerdictReason{Code: "ambiguous", Message: "存在唯一性不足的 ROI，可能是重复纹理"})
		}
		if fit != nil && residualRms > cfg.OkResidualPx {
			level = VerdictManual
			reasons = append(reasons, AlignVerdictReason{
				Code:    "residual-warn",
				Message: fmt.Sprintf("内点残差 RMS %.3fpx 超过 OK 阈值 %.3gpx", residualRms, cfg.OkResidualPx),
			})
		}
		if hasMissing {
			level = VerdictManual
			reasons = append(reasons, AlignVerdictReason{Code: "roi-missing", Message: "存在未定位的 ROI"})
		}
	}

	return AlignReport{
		Matches:     matches,
		Fit:         fit,
		Inliers:     inliers,
		Residuals:   residuals,
		ResidualRms: residualRms,
		MeanNcc:     meanNcc,
		Level:       level,
		Reasons:     reasons,
	}
}

// CompareToTruth 与真值变换比较；fit==nil 时全部为 NaN。
func CompareToTruth(fit *Similarity, p *WarpParams, rois []AlignRoi, width, height int) TruthComparison {
	perRoi := make([]float64, len(rois))
	if fit == nil {
		for i := range perRoi {
			perRoi[i] = math.NaN()
		}
		return TruthComparison{PerRoiErrorPx: perRoi, MeanErrorPx: math.NaN(), MaxErrorPx: math.NaN()}
	}
	sum := 0.0
	max := 0.0
	for i, roi := range rois {
		center := Point{X: roi.X + roi.W/2, Y: roi.Y + roi.H/2}
		predicted := ApplySimilarity(*fit, center)
		truth := WarpPoint(p, center, width, height)
		err := math.Hypot(predicted.X-truth.X, predicted.Y-truth.Y)
		perRoi[i] = err
		sum += err
		if err > max {
			max = err
		}
	}
	return TruthComparison{PerRoiErrorPx: perRoi, MeanErrorPx: sum / float64(len(rois)), MaxErrorPx: max}
}

func minInt(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
