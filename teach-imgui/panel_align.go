package main

import (
	"fmt"
	"math"
	"time"

	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

func init() {
	registerPanel(1, func(a *App) Panel {
		return &AlignPanel{
			a:         a,
			scale:     2,
			source:    "median",
			viewKind:  "template",
			tool:      "none",
			selected:  -1,
			autoRun:   true,
			dirty:     true,
			params:    defaultWarpParams(),
			config:    core.DefaultAlignConfig,
			occValue:  0,
			lastScale: 2,
		}
	})
	Messages(map[string]string{
		"align.section.source":         "源图",
		"align.source.median":          "MEDIAN 原图",
		"align.source.light":           "当前光照渲染图",
		"align.section.warp":           "扭曲参数",
		"align.param.tx":               "tx",
		"align.param.ty":               "ty",
		"align.param.theta":            "旋转°",
		"align.param.scale":            "缩放",
		"align.param.shearX":           "剪切 X",
		"align.param.shearY":           "剪切 Y",
		"align.param.bendAmplitude":    "弯曲幅度",
		"align.param.bendWavelength":   "弯曲波长",
		"align.param.blurSigma":        "模糊 σ",
		"align.param.noiseSigma":       "噪声 σ",
		"align.param.gain":             "增益",
		"align.param.offset":           "偏移",
		"align.param.gradient":         "光照梯度",
		"align.param.seed":             "随机种子",
		"align.resetAll":               "全部归零",
		"align.section.occlusion":      "遮挡",
		"align.occlusion.draw":         "画遮挡（拖框）",
		"align.occlusion.hint":         "在模板视图拖框添加遮挡",
		"align.occlusion.fill":         "填充值",
		"align.occlusion.empty":        "尚无遮挡。",
		"align.occlusion.delete":       "删除",
		"align.section.match":          "匹配参数",
		"align.match.searchRadius":     "搜索半径",
		"align.match.pyramid1":         "金字塔 1",
		"align.match.pyramid2":         "金字塔 2",
		"align.match.pyramid4":         "金字塔 4",
		"align.match.pyramid8":         "金字塔 8",
		"align.match.minNcc":           "最小 NCC",
		"align.match.minUniqueness":    "最小唯一性",
		"align.match.ransac":           "RANSAC 阈值",
		"align.match.okResidual":       "OK 残差",
		"align.match.ngResidual":       "NG 残差",
		"align.section.roi":            "ROI",
		"align.roi.restore":            "恢复机台定位点",
		"align.roi.new":                "新建 ROI（拖框）",
		"align.roi.newHint":            "在模板视图拖框新建 ROI",
		"align.roi.select":             "选择/移动",
		"align.roi.selectHint":         "拖动 ROI 移动，Delete 删除选中",
		"align.roi.empty":              "尚无 ROI。",
		"align.section.action":         "执行",
		"align.action.generate":        "生成输入图",
		"align.action.run":             "执行对齐",
		"align.action.autoRun":         "参数变化后自动执行",
		"align.view.template":          "模板",
		"align.view.input":             "输入",
		"align.view.diff":              "差异",
		"align.section.verdict":        "判定",
		"align.section.ncc":            "NCC 曲面",
		"align.result.empty":           "尚未执行对齐。",
		"align.result.fitFailed":       "失败",
		"align.result.fit":             "拟合",
		"align.result.truthMean":       "真值误差 mean",
		"align.result.truthMax":        "真值误差 max",
		"align.result.residualRms":     "内点残差 RMS",
		"align.result.meanNcc":         "平均 NCC",
		"align.result.elapsed":         "耗时",
		"align.col.roi":                "ROI",
		"align.col.ncc":                "NCC",
		"align.col.uniqueness":         "唯一性",
		"align.col.located":            "定位",
		"align.col.residual":           "残差",
		"align.col.reason":             "原因",
		"align.yes":                    "是",
		"align.no":                     "否",
		"align.needRois":               "至少需要 2 个 ROI",
		"align.currentGray":            "对齐 {kind}",
		"align.reason.too-few-located": "定位成功的 ROI 只有 {n} 个，至少需要 2 个",
		"align.reason.no-fit":          "无法拟合相似变换",
		"align.reason.residual-high":   "内点残差 RMS {rms}px 超过 NG 阈值 {th}px",
		"align.reason.outlier":         "存在定位成功但被判定为外点的 ROI",
		"align.reason.ambiguous":       "存在唯一性不足的 ROI，可能是重复纹理",
		"align.reason.residual-warn":   "内点残差 RMS {rms}px 超过 OK 阈值 {th}px",
		"align.reason.roi-missing":     "存在未定位的 ROI",
		"align.match.out-of-range":     "超出范围",
		"align.match.flat":             "纹理平坦",
		"align.match.low-ncc":          "NCC 过低",
		"align.run":                    "运行对齐",
		"align.autoRun":                "自动运行",
		"align.view":                   "视图",
		"align.workScale":              "工作分辨率",
		"align.match.pyramid":          "金字塔",
	}, map[string]string{
		"align.section.source":         "Source",
		"align.source.median":          "MEDIAN original",
		"align.source.light":           "Current lighting render",
		"align.section.warp":           "Warp Parameters",
		"align.param.tx":               "tx",
		"align.param.ty":               "ty",
		"align.param.theta":            "Rotation°",
		"align.param.scale":            "Scale",
		"align.param.shearX":           "Shear X",
		"align.param.shearY":           "Shear Y",
		"align.param.bendAmplitude":    "Bend amplitude",
		"align.param.bendWavelength":   "Bend wavelength",
		"align.param.blurSigma":        "Blur σ",
		"align.param.noiseSigma":       "Noise σ",
		"align.param.gain":             "Gain",
		"align.param.offset":           "Offset",
		"align.param.gradient":         "Lighting gradient",
		"align.param.seed":             "Random seed",
		"align.resetAll":               "Reset All",
		"align.section.occlusion":      "Occlusion",
		"align.occlusion.draw":         "Draw occlusion (drag box)",
		"align.occlusion.hint":         "Drag a box on the template view to add an occlusion",
		"align.occlusion.fill":         "Fill value",
		"align.occlusion.empty":        "No occlusions yet.",
		"align.occlusion.delete":       "Delete",
		"align.section.match":          "Matching Parameters",
		"align.match.searchRadius":     "Search range",
		"align.match.pyramid1":         "Pyramid 1",
		"align.match.pyramid2":         "Pyramid 2",
		"align.match.pyramid4":         "Pyramid 4",
		"align.match.pyramid8":         "Pyramid 8",
		"align.match.minNcc":           "Min NCC",
		"align.match.minUniqueness":    "Min uniqueness",
		"align.match.ransac":           "RANSAC threshold",
		"align.match.okResidual":       "OK residual",
		"align.match.ngResidual":       "NG residual",
		"align.section.roi":            "ROI",
		"align.roi.restore":            "Restore machine anchors",
		"align.roi.new":                "New ROI (drag box)",
		"align.roi.newHint":            "Drag a box on the template view to create an ROI",
		"align.roi.select":             "Select/Move",
		"align.roi.selectHint":         "Drag an ROI to move it, press Delete to remove the selected one",
		"align.roi.empty":              "No ROIs yet.",
		"align.section.action":         "Run",
		"align.action.generate":        "Generate input image",
		"align.action.run":             "Run alignment",
		"align.action.autoRun":         "Auto run on parameter change",
		"align.view.template":          "Template",
		"align.view.input":             "Input",
		"align.view.diff":              "Difference",
		"align.section.verdict":        "Verdict",
		"align.section.ncc":            "NCC Surface",
		"align.result.empty":           "Alignment has not been run yet.",
		"align.result.fitFailed":       "Failed",
		"align.result.fit":             "Fit",
		"align.result.truthMean":       "Truth error mean",
		"align.result.truthMax":        "Truth error max",
		"align.result.residualRms":     "Inlier residual RMS",
		"align.result.meanNcc":         "Mean NCC",
		"align.result.elapsed":         "Elapsed",
		"align.col.roi":                "ROI",
		"align.col.ncc":                "NCC",
		"align.col.uniqueness":         "Uniqueness",
		"align.col.located":            "Located",
		"align.col.residual":           "Residual",
		"align.col.reason":             "Reason",
		"align.yes":                    "Yes",
		"align.no":                     "No",
		"align.needRois":               "At least 2 ROIs are required",
		"align.currentGray":            "Align {kind}",
		"align.reason.too-few-located": "Only {n} ROIs were located, at least 2 are required",
		"align.reason.no-fit":          "Could not fit a similarity transform",
		"align.reason.residual-high":   "Inlier residual RMS {rms}px exceeds the NG threshold {th}px",
		"align.reason.outlier":         "A located ROI was classified as an outlier",
		"align.reason.ambiguous":       "An ROI has insufficient uniqueness, possibly a repeated texture",
		"align.reason.residual-warn":   "Inlier residual RMS {rms}px exceeds the OK threshold {th}px",
		"align.reason.roi-missing":     "Some ROIs were not located",
		"align.match.out-of-range":     "Out of range",
		"align.match.flat":             "Flat texture",
		"align.match.low-ncc":          "NCC too low",
		"align.run":                    "Run alignment",
		"align.autoRun":                "Auto run",
		"align.view":                   "View",
		"align.workScale":              "Working scale",
		"align.match.pyramid":          "Pyramid",
	}, map[string]string{
		"align.section.source":         "소스",
		"align.source.median":          "MEDIAN 원본",
		"align.source.light":           "현재 조명 렌더링",
		"align.section.warp":           "왜곡 파라미터",
		"align.param.tx":               "tx",
		"align.param.ty":               "ty",
		"align.param.theta":            "회전°",
		"align.param.scale":            "스케일",
		"align.param.shearX":           "전단 X",
		"align.param.shearY":           "전단 Y",
		"align.param.bendAmplitude":    "굽힘 진폭",
		"align.param.bendWavelength":   "굽힘 파장",
		"align.param.blurSigma":        "블러 σ",
		"align.param.noiseSigma":       "노이즈 σ",
		"align.param.gain":             "게인",
		"align.param.offset":           "오프셋",
		"align.param.gradient":         "조명 그라디언트",
		"align.param.seed":             "랜덤 시드",
		"align.resetAll":               "모두 초기화",
		"align.section.occlusion":      "가림",
		"align.occlusion.draw":         "가림 그리기 (드래그 박스)",
		"align.occlusion.hint":         "템플릿 뷰에서 박스를 드래그하여 가림을 추가합니다",
		"align.occlusion.fill":         "채움 값",
		"align.occlusion.empty":        "아직 가림이 없습니다.",
		"align.occlusion.delete":       "삭제",
		"align.section.match":          "매칭 파라미터",
		"align.match.searchRadius":     "탐색 범위",
		"align.match.pyramid1":         "피라미드 1",
		"align.match.pyramid2":         "피라미드 2",
		"align.match.pyramid4":         "피라미드 4",
		"align.match.pyramid8":         "피라미드 8",
		"align.match.minNcc":           "최소 NCC",
		"align.match.minUniqueness":    "최소 고유성",
		"align.match.ransac":           "RANSAC 임계값",
		"align.match.okResidual":       "OK 잔차",
		"align.match.ngResidual":       "NG 잔차",
		"align.section.roi":            "ROI",
		"align.roi.restore":            "기계 기준점 복원",
		"align.roi.new":                "ROI 생성 (드래그 박스)",
		"align.roi.newHint":            "템플릿 뷰에서 박스를 드래그하여 ROI 를 생성합니다",
		"align.roi.select":             "선택/이동",
		"align.roi.selectHint":         "ROI 를 드래그하여 이동, Delete 로 선택 항목 삭제",
		"align.roi.empty":              "아직 ROI 가 없습니다.",
		"align.section.action":         "실행",
		"align.action.generate":        "입력 이미지 생성",
		"align.action.run":             "정렬 실행",
		"align.action.autoRun":         "파라미터 변경 시 자동 실행",
		"align.view.template":          "템플릿",
		"align.view.input":             "입력",
		"align.view.diff":              "차이",
		"align.section.verdict":        "판정",
		"align.section.ncc":            "NCC 곡면",
		"align.result.empty":           "아직 정렬을 실행하지 않았습니다.",
		"align.result.fitFailed":       "실패",
		"align.result.fit":             "피팅",
		"align.result.truthMean":       "정답 오차 mean",
		"align.result.truthMax":        "정답 오차 max",
		"align.result.residualRms":     "인라이어 잔차 RMS",
		"align.result.meanNcc":         "평균 NCC",
		"align.result.elapsed":         "소요",
		"align.col.roi":                "ROI",
		"align.col.ncc":                "NCC",
		"align.col.uniqueness":         "고유성",
		"align.col.located":            "위치",
		"align.col.residual":           "잔차",
		"align.col.reason":             "원인",
		"align.yes":                    "예",
		"align.no":                     "아니오",
		"align.needRois":               "ROI 가 최소 2 개 필요합니다",
		"align.currentGray":            "정렬 {kind}",
		"align.reason.too-few-located": "위치를 찾은 ROI 가 {n} 개뿐이며 최소 2 개가 필요합니다",
		"align.reason.no-fit":          "유사 변환을 피팅할 수 없습니다",
		"align.reason.residual-high":   "인라이어 잔차 RMS {rms}px 가 NG 임계값 {th}px 를 초과했습니다",
		"align.reason.outlier":         "위치를 찾았지만 외점으로 판정된 ROI 가 있습니다",
		"align.reason.ambiguous":       "고유성이 부족한 ROI 가 있습니다. 반복 텍스처일 수 있습니다",
		"align.reason.residual-warn":   "인라이어 잔차 RMS {rms}px 가 OK 임계값 {th}px 를 초과했습니다",
		"align.reason.roi-missing":     "위치를 찾지 못한 ROI 가 있습니다",
		"align.match.out-of-range":     "범위 초과",
		"align.match.flat":             "평탄한 텍스처",
		"align.match.low-ncc":          "NCC 부족",
		"align.run":                    "정렬 실행",
		"align.autoRun":                "자동 실행",
		"align.view":                   "뷰",
		"align.workScale":              "작업 해상도",
		"align.match.pyramid":          "피라미드",
	})
}

// defaultWarpParams mirrors the TS initial WarpParams (Scale 1, Gain 1, rest 0).
func defaultWarpParams() core.WarpParams {
	return core.WarpParams{Scale: 1, Gain: 1}
}

// AlignPanel ports teach-app/src/align-panel.ts to native ImGui.
type AlignPanel struct {
	a *App

	rois      []core.AlignRoi
	occs      []core.Occlusion
	selected  int
	tool      string // "none" | "roi" | "select" | "occlusion"
	viewKind  string // "template" | "input" | "diff"
	source    string // "median" | "light"
	scale     int
	params    core.WarpParams
	config    core.AlignConfig
	autoRun   bool
	dirty     bool
	occValue  float64
	active    bool
	lastScale int

	template *core.GrayImage
	input    *core.GrayImage

	report       *core.AlignReport
	truth        *core.TruthComparison
	elapsedMs    float64
	heat         *core.NccSurface
	reportConfig core.AlignConfig

	dragging  bool
	dragStart core.Point
	dragCur   core.Point
	moveIdx   int
	moveOrig  core.Point
}

func (p *AlignPanel) ID() string    { return "align" }
func (p *AlignPanel) Title() string { return T("tab.align") }

func (p *AlignPanel) Activate() {
	p.active = true
	if p.dirty || p.template == nil {
		p.requestRun(true)
	} else {
		p.requestView()
	}
}

func (p *AlignPanel) Deactivate() {
	p.active = false
	p.dragging = false
}

func (p *AlignPanel) ModelLoaded() {
	p.rois = cloneRois(p.a.Scene.MachineRois)
	p.occs = nil
	p.selected = -1
	p.report = nil
	p.truth = nil
	p.heat = nil
	p.template = nil
	p.input = nil
	p.dirty = true
}

func (p *AlignPanel) LightChanged() {
	if p.source == "light" {
		p.dirty = true
		if p.active && p.autoRun {
			p.requestRun(true)
		}
	}
}

func (p *AlignPanel) Selftest() {
	if len(p.rois) < 2 {
		p.rois = cloneRois(p.a.Scene.MachineRois)
	}
	p.requestRun(true)
}

func cloneRois(in []core.AlignRoi) []core.AlignRoi {
	out := make([]core.AlignRoi, len(in))
	copy(out, in)
	return out
}

// scaledParams divides the full-resolution parameters by the working scale.
func (p *AlignPanel) scaledParams() core.WarpParams {
	s := float64(p.scale)
	out := p.params
	out.Tx /= s
	out.Ty /= s
	out.BendAmplitude /= s
	out.BendWavelength /= s
	out.BlurSigma /= s
	out.Occlusions = make([]core.Occlusion, len(p.occs))
	for i, o := range p.occs {
		out.Occlusions[i] = core.Occlusion{
			Rect:  core.Rect{X: o.X / s, Y: o.Y / s, W: o.W / s, H: o.H / s},
			Value: o.Value,
		}
	}
	return out
}

// scaledRois divides the full-resolution ROI coordinates by the working scale.
func (p *AlignPanel) scaledRois() []core.AlignRoi {
	s := float64(p.scale)
	out := make([]core.AlignRoi, len(p.rois))
	for i, r := range p.rois {
		out[i] = core.AlignRoi{
			Name: r.Name,
			Rect: core.Rect{X: r.X / s, Y: r.Y / s, W: r.W / s, H: r.H / s},
		}
	}
	return out
}

// requestRun schedules the full pipeline (warp + align + view) under key "align".
func (p *AlignPanel) requestRun(force bool) {
	a := p.a
	scene := a.Scene
	if scene == nil {
		return
	}
	if len(p.rois) < 2 {
		// Still generate and show the warped image; only the matching step needs ROIs.
		a.SetHint(T("align.needRois"))
	}
	scale := p.scale
	// Snapshot panel state: the job goroutine must not read panel fields.
	template, input := p.template, p.input
	source := p.source
	viewKind := p.viewKind
	params := p.scaledParams()
	rois := p.scaledRois()
	config := p.config
	light := a.Light.Clone()
	ch := a.CameraChannel()
	needWarp := p.dirty || p.template == nil || force
	runAlign := p.autoRun || force
	a.Jobs.Run("align", func() func() {
		start := time.Now()
		if needWarp || template == nil {
			var base *core.GrayImage
			if source == "light" {
				base = core.RenderChannel(scene.Light, &light, ch)
			} else {
				base = scene.Median
			}
			if scale > 1 {
				down, err := core.DownsampleArea(base, scale)
				if err != nil {
					return func() { a.SetHint(T("common.error", "msg", err.Error())) }
				}
				template = down
			} else {
				template = base.Clone()
			}
			input = core.ApplyWarp(template, &params, 1)
		}
		var report *core.AlignReport
		var truth *core.TruthComparison
		if runAlign && len(rois) >= 2 {
			r := core.AlignWithRois(template, input, rois, config, core.Similarity{Scale: 1})
			report = &r
			t := core.CompareToTruth(r.Fit, &params, rois, template.Width, template.Height)
			truth = &t
		}
		var pix []byte
		switch viewKind {
		case "input":
			pix = PackGray(input)
		case "diff":
			pix = PackAbsDiff(template, input)
		default:
			pix = PackGray(template)
		}
		elapsed := float64(time.Since(start).Microseconds()) / 1000
		w, h := template.Width, template.Height
		return func() {
			if a.Scene != scene {
				PutRGBA(pix)
				return
			}
			p.template = template
			p.input = input
			p.dirty = false
			if report != nil {
				p.report = report
				p.truth = truth
				p.elapsedMs = elapsed
				p.lastScale = scale
				p.reportConfig = config
				if p.selected < 0 && len(report.Matches) > 0 {
					p.selected = 0
					p.heat = report.Matches[0].Surface
				}
			}
			if p.viewKind != viewKind {
				PutRGBA(pix)
				p.requestView()
				return
			}
			if p.active {
				a.Viewer.SetImage(w, h, pix)
			} else {
				PutRGBA(pix)
			}
		}
	})
}

// requestView repacks the current view from the cached template/input under key "align-view".
func (p *AlignPanel) requestView() {
	a := p.a
	scene := a.Scene
	if scene == nil || p.template == nil || p.input == nil {
		return
	}
	viewKind := p.viewKind
	template := p.template
	input := p.input
	a.Jobs.Run("align-view", func() func() {
		var pix []byte
		switch viewKind {
		case "input":
			pix = PackGray(input)
		case "diff":
			pix = PackAbsDiff(template, input)
		default:
			pix = PackGray(template)
		}
		w, h := template.Width, template.Height
		return func() {
			if a.Scene != scene || p.template != template {
				PutRGBA(pix)
				return
			}
			if p.active {
				a.Viewer.SetImage(w, h, pix)
			} else {
				PutRGBA(pix)
			}
		}
	})
}

func (p *AlignPanel) DrawLeft() {
	a := p.a
	changed := false

	if Section(T("align.section.source"), "align-src") {
		src := 0
		if p.source == "light" {
			src = 1
		}
		if Combo(T("align.section.source"), "align-source", &src, []string{T("align.source.median"), T("align.source.light")}) {
			if src == 1 {
				p.source = "light"
			} else {
				p.source = "median"
			}
			p.dirty = true
			changed = true
		}
		sc := 0
		switch p.scale {
		case 1:
			sc = 0
		case 4:
			sc = 2
		default:
			sc = 1
		}
		if Combo(T("align.workScale"), "align-scale", &sc, []string{"1/1", "1/2", "1/4"}) {
			switch sc {
			case 0:
				p.scale = 1
			case 2:
				p.scale = 4
			default:
				p.scale = 2
			}
			p.dirty = true
			changed = true
		}
	}

	if Section(T("align.section.warp"), "align-warp") {
		changed = SliderF64(T("align.param.tx"), "align-tx", &p.params.Tx, -300, 300, "%.0f") || changed
		changed = SliderF64(T("align.param.ty"), "align-ty", &p.params.Ty, -300, 300, "%.0f") || changed
		changed = SliderF64(T("align.param.theta"), "align-theta", &p.params.ThetaDeg, -5, 5, "%.2f") || changed
		changed = SliderF64(T("align.param.scale"), "align-scale-p", &p.params.Scale, 0.95, 1.05, "%.3f") || changed
		changed = SliderF64(T("align.param.shearX"), "align-shearx", &p.params.ShearX, -0.05, 0.05, "%.3f") || changed
		changed = SliderF64(T("align.param.shearY"), "align-sheary", &p.params.ShearY, -0.05, 0.05, "%.3f") || changed
		changed = SliderF64(T("align.param.bendAmplitude"), "align-benda", &p.params.BendAmplitude, 0, 30, "%.1f") || changed
		changed = SliderF64(T("align.param.bendWavelength"), "align-bendw", &p.params.BendWavelength, 200, 6000, "%.0f") || changed
		changed = SliderF64(T("align.param.blurSigma"), "align-blur", &p.params.BlurSigma, 0, 6, "%.1f") || changed
		changed = SliderF64(T("align.param.noiseSigma"), "align-noise", &p.params.NoiseSigma, 0, 40, "%.1f") || changed
		changed = SliderF64(T("align.param.gain"), "align-gain", &p.params.Gain, 0.3, 2, "%.2f") || changed
		changed = SliderF64(T("align.param.offset"), "align-offset", &p.params.Offset, -80, 80, "%.0f") || changed
		changed = SliderF64(T("align.param.gradient"), "align-grad", &p.params.Gradient, -0.8, 0.8, "%.2f") || changed
		if Button(T("align.resetAll"), "align-reset") {
			p.params = defaultWarpParams()
			p.occs = nil
			p.dirty = true
			changed = true
		}
	}

	if Section(T("align.section.occlusion"), "align-occ") {
		if ToolButton(T("align.occlusion.draw"), "align-occ-draw", p.tool == "occlusion") {
			p.tool = "occlusion"
			a.SetHint(T("align.occlusion.hint"))
		}
		SliderF64(T("align.occlusion.fill"), "align-occ-fill", &p.occValue, 0, 255, "%.0f")
		if len(p.occs) == 0 {
			Note(T("align.occlusion.empty"))
		} else {
			del := -1
			for i, o := range p.occs {
				imgui.PushIDInt(int32(i))
				imgui.AlignTextToFramePadding()
				imgui.TextUnformatted(fmt.Sprintf("x%.0f y%.0f w%.0f h%.0f v%.0f", o.X, o.Y, o.W, o.H, o.Value))
				imgui.SameLine()
				if Button(T("align.occlusion.delete"), "align-occ-del") {
					del = i
				}
				imgui.PopID()
			}
			if del >= 0 {
				p.occs = append(p.occs[:del], p.occs[del+1:]...)
				p.dirty = true
				changed = true
			}
		}
	}

	// Matching parameters only re-run the alignment; they never invalidate the warped pair.
	rerun := false
	if Section(T("align.section.match"), "align-match") {
		rerun = SliderF64(T("align.match.searchRadius"), "align-search", &p.config.SearchRadius, 10, 400, "%.0f") || rerun
		py := 0
		switch p.config.PyramidFactor {
		case 1:
			py = 0
		case 2:
			py = 1
		case 8:
			py = 3
		default:
			py = 2
		}
		if Combo(T("align.match.pyramid"), "align-pyramid", &py, []string{
			T("align.match.pyramid1"), T("align.match.pyramid2"), T("align.match.pyramid4"), T("align.match.pyramid8"),
		}) {
			switch py {
			case 0:
				p.config.PyramidFactor = 1
			case 1:
				p.config.PyramidFactor = 2
			case 3:
				p.config.PyramidFactor = 8
			default:
				p.config.PyramidFactor = 4
			}
			rerun = true
		}
		rerun = SliderF64(T("align.match.minNcc"), "align-minncc", &p.config.MinNcc, 0, 1, "%.2f") || rerun
		rerun = SliderF64(T("align.match.minUniqueness"), "align-minuniq", &p.config.MinUniqueness, 0, 1, "%.2f") || rerun
		rerun = SliderF64(T("align.match.ransac"), "align-ransac", &p.config.RansacThresholdPx, 0.5, 20, "%.1f") || rerun
		rerun = SliderF64(T("align.match.okResidual"), "align-okres", &p.config.OkResidualPx, 0.1, 10, "%.1f") || rerun
		rerun = SliderF64(T("align.match.ngResidual"), "align-ngres", &p.config.NgResidualPx, 0.1, 20, "%.1f") || rerun
	}

	if Section(T("align.section.roi"), "align-roi") {
		if Button(T("align.roi.restore"), "align-roi-restore") {
			p.rois = cloneRois(a.Scene.MachineRois)
			p.selected = -1
			changed = true
		}
		WrapSameLine(T("align.roi.new"))
		if ToolButton(T("align.roi.new"), "align-roi-new", p.tool == "roi") {
			p.tool = "roi"
			a.SetHint(T("align.roi.newHint"))
		}
		WrapSameLine(T("align.roi.select"))
		if ToolButton(T("align.roi.select"), "align-roi-select", p.tool == "select") {
			p.tool = "select"
			a.SetHint(T("align.roi.selectHint"))
		}
		if len(p.rois) == 0 {
			Note(T("align.roi.empty"))
		} else {
			del := -1
			for i, r := range p.rois {
				imgui.PushIDInt(int32(i))
				sel := i == p.selected
				if imgui.SelectableBoolV(fmt.Sprintf("%s  x%.0f y%.0f w%.0f h%.0f", r.Name, r.X, r.Y, r.W, r.H), sel, 0, imgui.NewVec2(0, 0)) {
					p.selected = i
					a.Viewer.CenterOn(r.X/float64(p.scale)+r.W/float64(p.scale)/2, r.Y/float64(p.scale)+r.H/float64(p.scale)/2)
				}
				imgui.SameLine()
				if Button(T("align.occlusion.delete"), "align-roi-del") {
					del = i
				}
				imgui.PopID()
			}
			if del >= 0 {
				p.rois = append(p.rois[:del], p.rois[del+1:]...)
				if p.selected >= len(p.rois) {
					p.selected = -1
				}
				changed = true
			}
		}
		if imgui.IsKeyPressedBool(imgui.KeyDelete) && !imgui.IsAnyItemActive() && p.selected >= 0 && p.selected < len(p.rois) {
			p.rois = append(p.rois[:p.selected], p.rois[p.selected+1:]...)
			p.selected = -1
			changed = true
		}
	}

	if Section(T("align.section.action"), "align-action") {
		if Check(T("align.action.autoRun"), "align-autorun", &p.autoRun) {
			rerun = true
		}
		if Button(T("align.action.run"), "align-run") {
			p.requestRun(true)
		}
		WrapSameLine(T("align.action.generate"))
		if Button(T("align.action.generate"), "align-gen") {
			p.dirty = true
			p.requestRun(true)
		}
		vk := 0
		switch p.viewKind {
		case "input":
			vk = 1
		case "diff":
			vk = 2
		}
		if Combo(T("align.view"), "align-viewkind", &vk, []string{
			T("align.view.template"), T("align.view.input"), T("align.view.diff"),
		}) {
			switch vk {
			case 1:
				p.viewKind = "input"
			case 2:
				p.viewKind = "diff"
			default:
				p.viewKind = "template"
			}
			if p.dirty || p.template == nil {
				p.requestRun(true)
			} else {
				p.requestView()
			}
		}
	}

	if changed {
		p.dirty = true
	}
	if (changed || rerun) && p.autoRun {
		p.requestRun(false)
	}
}

func (p *AlignPanel) DrawRight() {
	a := p.a
	if Section(T("align.section.verdict"), "align-verdict") {
		if p.report == nil {
			Note(T("align.result.empty"))
		} else {
			r := p.report
			Badge(r.Level)
			if len(r.Reasons) > 0 {
				for _, reason := range r.Reasons {
					Warn(p.reasonText(reason))
				}
			}
			rows := [][2]string{}
			if r.Fit != nil {
				rows = append(rows, [2]string{"tx", F(r.Fit.Tx*float64(p.lastScale), 2)})
				rows = append(rows, [2]string{"ty", F(r.Fit.Ty*float64(p.lastScale), 2)})
				rows = append(rows, [2]string{"θ", F(r.Fit.ThetaDeg, 3)})
				rows = append(rows, [2]string{"scale", F(r.Fit.Scale, 5)})
			} else {
				rows = append(rows, [2]string{T("align.result.fit"), T("align.result.fitFailed")})
			}
			if p.truth != nil {
				rows = append(rows, [2]string{T("align.result.truthMean"), F(p.truth.MeanErrorPx*float64(p.lastScale), 3) + " px"})
				rows = append(rows, [2]string{T("align.result.truthMax"), F(p.truth.MaxErrorPx*float64(p.lastScale), 3) + " px"})
			}
			rows = append(rows, [2]string{T("align.result.residualRms"), F(r.ResidualRms*float64(p.lastScale), 3) + " px"})
			rows = append(rows, [2]string{T("align.result.meanNcc"), F(r.MeanNcc, 4)})
			rows = append(rows, [2]string{T("align.result.elapsed"), F(p.elapsedMs, 1) + " ms"})
			KVTable("align-kv", rows)

			headers := []string{
				T("align.col.roi"), T("align.col.ncc"), T("align.col.uniqueness"),
				T("align.col.located"), T("align.col.residual"), T("align.col.reason"),
			}
			matches := r.Matches
			residuals := r.Residuals
			clicked := DataTable("align-matches", headers, len(matches), 8*imgui.FrameHeightWithSpacing()+8, func(row, col int) string {
				m := matches[row]
				switch col {
				case 0:
					return m.Name
				case 1:
					return F(m.Ncc, 4)
				case 2:
					return F(m.Uniqueness, 4)
				case 3:
					if m.Located {
						return T("align.yes")
					}
					return T("align.no")
				case 4:
					if row < len(residuals) && residuals[row] >= 0 {
						return F(residuals[row]*float64(p.lastScale), 3)
					}
					return "—"
				}
				return p.matchReasonText(m.Reason)
			}, p.selected)
			if clicked >= 0 && clicked < len(matches) {
				p.selected = clicked
				m := matches[clicked]
				p.heat = m.Surface
				if m.Found != nil {
					a.Viewer.CenterOn(m.Found.X, m.Found.Y)
				} else {
					a.Viewer.CenterOn(m.Expected.X, m.Expected.Y)
				}
			}
		}
	}
	if Section(T("align.section.ncc"), "align-ncc") {
		if p.heat == nil {
			Note(T("align.result.empty"))
		} else {
			size := imgui.ContentRegionAvail().X
			if size > 320 {
				size = 320
			}
			Heatmap("align", p.heat, size)
		}
	}
}

// reasonText renders a verdict reason using the translated code and computed values.
func (p *AlignPanel) reasonText(r core.AlignVerdictReason) string {
	switch r.Code {
	case "too-few-located":
		n := 0
		if p.report != nil {
			for _, m := range p.report.Matches {
				if m.Located {
					n++
				}
			}
		}
		return T("align.reason.too-few-located", "n", n)
	case "no-fit":
		return T("align.reason.no-fit")
	case "residual-high":
		return T("align.reason.residual-high",
			"rms", F(p.report.ResidualRms*float64(p.lastScale), 3),
			"th", F(p.reportConfig.NgResidualPx, 3))
	case "outlier":
		return T("align.reason.outlier")
	case "ambiguous":
		return T("align.reason.ambiguous")
	case "residual-warn":
		return T("align.reason.residual-warn",
			"rms", F(p.report.ResidualRms*float64(p.lastScale), 3),
			"th", F(p.reportConfig.OkResidualPx, 3))
	case "roi-missing":
		return T("align.reason.roi-missing")
	}
	return r.Code
}

// matchReasonText translates a per-ROI reason code.
func (p *AlignPanel) matchReasonText(code string) string {
	switch code {
	case "out-of-range":
		return T("align.match.out-of-range")
	case "flat":
		return T("align.match.flat")
	case "low-ncc":
		return T("align.match.low-ncc")
	}
	return code
}

func (p *AlignPanel) Overlay(o *Overlay) {
	s := float64(p.scale)
	if p.viewKind == "template" {
		for i, r := range p.rois {
			th := float32(1.5)
			if i == p.selected {
				th = 3
			}
			o.Rect(r.X/s, r.Y/s, r.W/s, r.H/s, OverlayWarn, th)
			o.Text(r.X/s, r.Y/s, 2, 12, OverlayWarn, r.Name)
		}
		for _, occ := range p.occs {
			o.FillRect(occ.X/s, occ.Y/s, occ.W/s, occ.H/s, OverlayNGFill)
			o.Rect(occ.X/s, occ.Y/s, occ.W/s, occ.H/s, OverlayNG, 1.5)
		}
	} else if p.report != nil {
		for i, m := range p.report.Matches {
			halfW := 20.0
			halfH := 20.0
			if i < len(p.rois) {
				halfW = p.rois[i].W / s / 2
				halfH = p.rois[i].H / s / 2
			}
			o.DashedRect(m.Expected.X-halfW, m.Expected.Y-halfH, halfW*2, halfH*2, OverlayMuted, 1.5)
			if m.Found != nil {
				col := OverlayNG
				if m.Located {
					col = OverlayOK
				}
				o.Rect(m.Found.X-halfW, m.Found.Y-halfH, halfW*2, halfH*2, col, 2)
				o.Text(m.Found.X-halfW, m.Found.Y-halfH, 0, -4, col, fmt.Sprintf("%s %s", m.Name, F(m.Ncc, 3)))
				o.Line(m.Template.X, m.Template.Y, m.Found.X, m.Found.Y, col, 1)
			}
		}
	}
	if p.dragging {
		o.DragBox(p.dragStart.X, p.dragStart.Y, p.dragCur.X, p.dragCur.Y, OverlayROI)
	}
}

func (p *AlignPanel) Pointer(ev PointerEvent) bool {
	s := float64(p.scale)
	switch p.tool {
	case "roi", "occlusion":
		switch ev.Kind {
		case PointerDown:
			p.dragging = true
			p.dragStart = core.Point{X: ev.X, Y: ev.Y}
			p.dragCur = p.dragStart
			return true
		case PointerMove:
			if p.dragging {
				p.dragCur = core.Point{X: ev.X, Y: ev.Y}
			}
			return true
		case PointerUp:
			if !p.dragging {
				return false
			}
			p.dragging = false
			x := math.Min(p.dragStart.X, p.dragCur.X)
			y := math.Min(p.dragStart.Y, p.dragCur.Y)
			w := math.Abs(p.dragCur.X - p.dragStart.X)
			h := math.Abs(p.dragCur.Y - p.dragStart.Y)
			if w >= 4 && h >= 4 {
				if p.tool == "roi" {
					p.rois = append(p.rois, core.AlignRoi{
						Name: fmt.Sprintf("R%d", len(p.rois)+1),
						Rect: core.Rect{X: x * s, Y: y * s, W: w * s, H: h * s},
					})
				} else {
					p.occs = append(p.occs, core.Occlusion{
						Rect:  core.Rect{X: x * s, Y: y * s, W: w * s, H: h * s},
						Value: p.occValue,
					})
				}
				p.dirty = true
				if p.autoRun {
					p.requestRun(false)
				}
			}
			p.tool = "none"
			return true
		}
		return false
	case "select":
		switch ev.Kind {
		case PointerDown:
			idx := p.hitTest(ev.X, ev.Y)
			if idx >= 0 {
				p.selected = idx
				p.moveIdx = idx
				p.moveOrig = core.Point{X: ev.X, Y: ev.Y}
				p.dragging = true
				return true
			}
			p.selected = -1
			return false
		case PointerMove:
			if p.dragging && p.moveIdx >= 0 && p.moveIdx < len(p.rois) {
				r := &p.rois[p.moveIdx]
				r.X += (ev.X - p.moveOrig.X) * s
				r.Y += (ev.Y - p.moveOrig.Y) * s
				p.moveOrig = core.Point{X: ev.X, Y: ev.Y}
				return true
			}
			return false
		case PointerUp:
			if p.dragging {
				p.dragging = false
				p.moveIdx = -1
				p.dirty = true
				if p.autoRun {
					p.requestRun(false)
				}
				return true
			}
			return false
		}
	}
	return false
}

// hitTest returns the topmost ROI containing the working-resolution point.
func (p *AlignPanel) hitTest(x, y float64) int {
	s := float64(p.scale)
	fx := x * s
	fy := y * s
	for i := len(p.rois) - 1; i >= 0; i-- {
		r := p.rois[i]
		if fx >= r.X && fy >= r.Y && fx <= r.X+r.W && fy <= r.Y+r.H {
			return i
		}
	}
	return -1
}

func (p *AlignPanel) Hover(x, y int) string {
	var img *core.GrayImage
	switch p.viewKind {
	case "input":
		img = p.input
	case "diff":
		img = p.input
	default:
		img = p.template
	}
	if img == nil || x < 0 || y < 0 || x >= img.Width || y >= img.Height {
		return ""
	}
	if p.viewKind == "diff" && p.template != nil {
		d := int(img.Data[y*img.Width+x]) - int(p.template.Data[y*p.template.Width+x])
		if d < 0 {
			d = -d
		}
		return fmt.Sprintf("GV %d", d)
	}
	return fmt.Sprintf("GV %d", img.Data[y*img.Width+x])
}
