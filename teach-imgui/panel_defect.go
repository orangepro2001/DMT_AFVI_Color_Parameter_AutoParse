package main

import (
	"fmt"
	"math"

	"github.com/AllenDang/cimgui-go/imgui"

	"afvi/teach-imgui/core"
)

func init() {
	registerPanel(2, func(a *App) Panel { return newDefectPanel(a) })
	Messages(map[string]string{
		"defect.section.channel":           "渲染通道",
		"defect.section.brush":             "笔刷",
		"defect.tool.brightSpot":           "亮点",
		"defect.tool.darkSpot":             "暗点",
		"defect.tool.brightLine":           "亮线",
		"defect.tool.darkLine":             "暗线",
		"defect.tool.foreign":              "异物",
		"defect.tool.contamination":        "污染",
		"defect.tool.hint":                 "工具：{name}",
		"defect.brush.radius":              "半径",
		"defect.brush.deltaGv":             "ΔGV",
		"defect.brush.softness":            "柔和度",
		"defect.brush.foreignMetal":        "异物材料 metal",
		"defect.brush.foreignSr":           "异物材料 sr",
		"defect.brush.foreignOpen":         "异物材料 open",
		"defect.brush.contaminationFactor": "污染系数",
		"defect.brush.undo":                "撤销",
		"defect.brush.clear":               "清空",
		"defect.brush.empty":               "尚无笔画。",
		"defect.brush.delete":              "删除",
		"defect.section.params":            "检出参数",
		"defect.param.brightTh":            "Bright TH",
		"defect.param.darkTh":              "Dark TH",
		"defect.param.brightMinSize":       "Bright Size",
		"defect.param.darkMinSize":         "Dark Size",
		"defect.param.minDefectSize":       "Min Size",
		"defect.params.region":             "检查区域",
		"defect.section.tools":             "工具",
		"defect.tool.probe":                "探查（拖框）",
		"defect.tool.probeHint":            "在视图上拖框进行探查",
		"defect.view.test":                 "测试图",
		"defect.view.golden":               "标准图",
		"defect.view.diff":                 "差异图",
		"defect.section.result":            "检出结果",
		"defect.section.probe":             "探查",
		"defect.result.empty":              "尚未执行检出。",
		"defect.result.detectedCount":      "检出数",
		"defect.result.rejectedCount":      "被拒数",
		"defect.col.kind":                  "类型",
		"defect.col.area":                  "面积",
		"defect.col.peakDelta":             "峰值Δ",
		"defect.col.meanDelta":             "均值Δ",
		"defect.col.result":                "结果",
		"defect.col.rule":                  "规则",
		"defect.kind.bright":               "亮",
		"defect.kind.dark":                 "暗",
		"defect.result.detected":           "检出",
		"defect.result.simulated":          "已模拟参数",
		"defect.result.unsimulated":        "未模拟参数",
		"defect.probe.empty":               "尚未探查。",
		"defect.probe.brightInsufficient":  "最大亮差 {max} < Bright TH {th}：差值不足，不会检出",
		"defect.probe.brightTooSmall":      "超阈像素 {pixels} < Size {size}：面积不足",
		"defect.probe.brightDetect":        "亮缺陷会检出：最大亮差 {max}，超阈像素 {pixels}",
		"defect.probe.darkInsufficient":    "最大暗差 {max} < Dark TH {th}：差值不足，不会检出",
		"defect.probe.darkTooSmall":        "超阈像素 {pixels} < Size {size}：面积不足",
		"defect.probe.darkDetect":          "暗缺陷会检出：最大暗差 {max}，超阈像素 {pixels}",
		"defect.stroke.foreign":            "异物 {material} @{x},{y}",
		"defect.stroke.contamination":      "污染 ×{factor} @{x},{y}",
		"defect.stroke.spot":               "{kind}点 r{r} {amp} @{x},{y}",
		"defect.stroke.line":               "{kind}线 r{r} {amp} @{x},{y}→{x2},{y2}",
		"defect.stroke.rect":               "{kind}块 {amp} @{x},{y}–{x2},{y2}",
		"defect.currentGray":               "缺陷 {kind}",
		"defect.tool.brightRect":           "亮块",
		"defect.tool.darkRect":             "暗块",
		"defect.section.amplitude":         "幅度模式",
		"defect.amplitude.absolute":        "绝对 ΔGV",
		"defect.amplitude.relative":        "相对 %（随光照）",
		"defect.amplitude.target":          "目标 GV",
		"defect.brush.relativePct":         "相对幅度 %",
		"defect.brush.targetBright":        "亮目标 GV",
		"defect.brush.targetDark":          "暗目标 GV",
		"defect.section.profile":           "边缘轮廓",
		"defect.profile.linear":            "线性",
		"defect.profile.gaussian":          "高斯",
		"defect.brush.grain":               "颗粒",
		"defect.brush.enabled":             "启用",
		"defect.section.random":            "随机批量",
		"defect.random.count":              "数量",
		"defect.random.seed":               "种子",
		"defect.random.kind":               "类型",
		"defect.random.kind.bright":        "亮",
		"defect.random.kind.dark":          "暗",
		"defect.random.kind.mixed":         "混合",
		"defect.random.shape":              "形状",
		"defect.random.shape.spot":         "点",
		"defect.random.shape.line":         "线",
		"defect.random.shape.mixed":        "混合",
		"defect.random.radiusMin":          "半径最小",
		"defect.random.radiusMax":          "半径最大",
		"defect.random.valueMin":           "幅度最小",
		"defect.random.valueMax":           "幅度最大",
		"defect.random.material":           "放置材料",
		"defect.random.material.all":       "全部",
		"defect.random.generate":           "生成",
		"defect.section.noise":             "成像噪声",
		"defect.noise.readSigma":           "读出噪声 σ",
		"defect.noise.shotGain":            "散粒噪声系数",
		"defect.noise.seed":                "种子",
		"defect.noise.note":                "噪声只加到测试图；标准图视为多板中值无噪声；σ² = 读出² + 散粒系数×GV，GV 越高噪声越大。",
		"defect.param.brightRelPct":        "Bright Rel %",
		"defect.param.darkRelPct":          "Dark Rel %",
		"defect.param.relNote":             "有效阈值 = TH + Golden×%，为教学近似，不代表机台 Offset1(%) 的已核实语义。",
		"defect.result.regionGoldenMean":   "区域 Golden 均值",
		"defect.result.goldenSatPct":       "Golden 饱和(255) 占比",
		"defect.result.testSatHigh":        "测试图饱和(255) 像素数",
		"defect.result.satWarn":            "Golden 饱和占比 > 5%：这些位置的亮缺陷没有余量，不可能检出。",
		"defect.col.goldenMean":            "背景 GV",
		"defect.col.threshold":             "有效 TH",
		"defect.col.saturated":             "饱和像素",
		"defect.reject.belowSize":          "面积不足",
		"defect.probe.summary":             "框内 {pixels} 像素，Golden 均值 {mean} [{min}–{max}]，饱和 {sat}",
		"defect.probe.brightInsufficient2": "亮：差值不足（最大 {max} < 有效阈值最小 {th}）",
		"defect.probe.brightTooSmall2":     "亮：最大连通超阈面积不足（{largest} < {required}，超阈总数 {pixels}）",
		"defect.probe.brightDetect2":       "亮：会检出（最大连通超阈面积 {largest} ≥ {required}）",
		"defect.probe.darkInsufficient2":   "暗：差值不足（最大 {max} < 有效阈值最小 {th}）",
		"defect.probe.darkTooSmall2":       "暗：最大连通超阈面积不足（{largest} < {required}，超阈总数 {pixels}）",
		"defect.probe.darkDetect2":         "暗：会检出（最大连通超阈面积 {largest} ≥ {required}）",
		"defect.probe.brightMargin":        "亮余量 = 255 − Golden 最小 {min} = {margin}；背景过亮，即使饱和到 255 也达不到阈值 {th}，亮缺陷不可能检出。",
		"defect.probe.darkMargin":          "暗余量 = Golden 最大 {max}；背景过暗，即使降到 0 也达不到阈值 {th}，暗缺陷不可能检出。",
		"defect.result.truncated":          "仅显示面积最大的前 {shown} 行，共 {total} 个连通域（检出 / 被拒计数仍按全部统计）。",
	}, map[string]string{
		"defect.section.channel":           "Render Channel",
		"defect.section.brush":             "Brush",
		"defect.tool.brightSpot":           "Bright spot",
		"defect.tool.darkSpot":             "Dark spot",
		"defect.tool.brightLine":           "Bright line",
		"defect.tool.darkLine":             "Dark line",
		"defect.tool.foreign":              "Foreign object",
		"defect.tool.contamination":        "Contamination",
		"defect.tool.hint":                 "Tool: {name}",
		"defect.brush.radius":              "Radius",
		"defect.brush.deltaGv":             "ΔGV",
		"defect.brush.softness":            "Softness",
		"defect.brush.foreignMetal":        "Foreign material metal",
		"defect.brush.foreignSr":           "Foreign material sr",
		"defect.brush.foreignOpen":         "Foreign material open",
		"defect.brush.contaminationFactor": "Contamination factor",
		"defect.brush.undo":                "Undo",
		"defect.brush.clear":               "Clear",
		"defect.brush.empty":               "No strokes yet.",
		"defect.brush.delete":              "Delete",
		"defect.section.params":            "Detection Parameters",
		"defect.param.brightTh":            "Bright TH",
		"defect.param.darkTh":              "Dark TH",
		"defect.param.brightMinSize":       "Bright Size",
		"defect.param.darkMinSize":         "Dark Size",
		"defect.param.minDefectSize":       "Min Size",
		"defect.params.region":             "Inspection region",
		"defect.section.tools":             "Tools",
		"defect.tool.probe":                "Probe (drag box)",
		"defect.tool.probeHint":            "Drag a box on the view to probe",
		"defect.view.test":                 "Test image",
		"defect.view.golden":               "Golden image",
		"defect.view.diff":                 "Difference image",
		"defect.section.result":            "Detection Result",
		"defect.section.probe":             "Probe",
		"defect.result.empty":              "Detection has not been run yet.",
		"defect.result.detectedCount":      "Detected",
		"defect.result.rejectedCount":      "Rejected",
		"defect.col.kind":                  "Type",
		"defect.col.area":                  "Area",
		"defect.col.peakDelta":             "Peak Δ",
		"defect.col.meanDelta":             "Mean Δ",
		"defect.col.result":                "Result",
		"defect.col.rule":                  "Rule",
		"defect.kind.bright":               "Bright",
		"defect.kind.dark":                 "Dark",
		"defect.result.detected":           "Detected",
		"defect.result.simulated":          "Simulated parameters",
		"defect.result.unsimulated":        "Unsimulated parameters",
		"defect.probe.empty":               "No probe yet.",
		"defect.probe.brightInsufficient":  "Max bright delta {max} < Bright TH {th}: delta too small, not detected",
		"defect.probe.brightTooSmall":      "Above-threshold pixels {pixels} < Size {size}: area too small",
		"defect.probe.brightDetect":        "Bright defect will be detected: max bright delta {max}, above-threshold pixels {pixels}",
		"defect.probe.darkInsufficient":    "Max dark delta {max} < Dark TH {th}: delta too small, not detected",
		"defect.probe.darkTooSmall":        "Above-threshold pixels {pixels} < Size {size}: area too small",
		"defect.probe.darkDetect":          "Dark defect will be detected: max dark delta {max}, above-threshold pixels {pixels}",
		"defect.stroke.foreign":            "Foreign {material} @{x},{y}",
		"defect.stroke.contamination":      "Contamination ×{factor} @{x},{y}",
		"defect.stroke.spot":               "{kind} spot r{r} {amp} @{x},{y}",
		"defect.stroke.line":               "{kind} line r{r} {amp} @{x},{y}→{x2},{y2}",
		"defect.stroke.rect":               "{kind} rect {amp} @{x},{y}–{x2},{y2}",
		"defect.currentGray":               "Defect {kind}",
		"defect.tool.brightRect":           "Bright rect",
		"defect.tool.darkRect":             "Dark rect",
		"defect.section.amplitude":         "Amplitude Mode",
		"defect.amplitude.absolute":        "Absolute ΔGV",
		"defect.amplitude.relative":        "Relative % (scales with light)",
		"defect.amplitude.target":          "Target GV",
		"defect.brush.relativePct":         "Relative amplitude %",
		"defect.brush.targetBright":        "Bright target GV",
		"defect.brush.targetDark":          "Dark target GV",
		"defect.section.profile":           "Edge Profile",
		"defect.profile.linear":            "Linear",
		"defect.profile.gaussian":          "Gaussian",
		"defect.brush.grain":               "Grain",
		"defect.brush.enabled":             "Enabled",
		"defect.section.random":            "Random Batch",
		"defect.random.count":              "Count",
		"defect.random.seed":               "Seed",
		"defect.random.kind":               "Kind",
		"defect.random.kind.bright":        "Bright",
		"defect.random.kind.dark":          "Dark",
		"defect.random.kind.mixed":         "Mixed",
		"defect.random.shape":              "Shape",
		"defect.random.shape.spot":         "Spot",
		"defect.random.shape.line":         "Line",
		"defect.random.shape.mixed":        "Mixed",
		"defect.random.radiusMin":          "Radius min",
		"defect.random.radiusMax":          "Radius max",
		"defect.random.valueMin":           "Value min",
		"defect.random.valueMax":           "Value max",
		"defect.random.material":           "Placement material",
		"defect.random.material.all":       "All",
		"defect.random.generate":           "Generate",
		"defect.section.noise":             "Imaging Noise",
		"defect.noise.readSigma":           "Read noise σ",
		"defect.noise.shotGain":            "Shot noise gain",
		"defect.noise.seed":                "Seed",
		"defect.noise.note":                "Noise is added to the test image only; the golden image is treated as a multi-board median with no noise; σ² = read² + shotGain×GV, so higher GV means more noise.",
		"defect.param.brightRelPct":        "Bright Rel %",
		"defect.param.darkRelPct":          "Dark Rel %",
		"defect.param.relNote":             "Effective threshold = TH + Golden×%, a teaching approximation that does not represent the verified semantics of the machine Offset1(%).",
		"defect.result.regionGoldenMean":   "Region golden mean",
		"defect.result.goldenSatPct":       "Golden saturated (255) share",
		"defect.result.testSatHigh":        "Test saturated (255) pixels",
		"defect.result.satWarn":            "Golden saturated share > 5%: bright defects at these positions have no headroom and cannot be detected.",
		"defect.col.goldenMean":            "Background GV",
		"defect.col.threshold":             "Effective TH",
		"defect.col.saturated":             "Saturated px",
		"defect.reject.belowSize":          "Below size",
		"defect.probe.summary":             "{pixels} pixels in box, golden mean {mean} [{min}–{max}], saturated {sat}",
		"defect.probe.brightInsufficient2": "Bright: delta too small (max {max} < min effective threshold {th})",
		"defect.probe.brightTooSmall2":     "Bright: largest connected above-threshold area too small ({largest} < {required}, total above-threshold {pixels})",
		"defect.probe.brightDetect2":       "Bright: will be detected (largest connected above-threshold area {largest} ≥ {required})",
		"defect.probe.darkInsufficient2":   "Dark: delta too small (max {max} < min effective threshold {th})",
		"defect.probe.darkTooSmall2":       "Dark: largest connected above-threshold area too small ({largest} < {required}, total above-threshold {pixels})",
		"defect.probe.darkDetect2":         "Dark: will be detected (largest connected above-threshold area {largest} ≥ {required})",
		"defect.probe.brightMargin":        "Bright headroom = 255 − golden min {min} = {margin}; the background is too bright, so even saturating to 255 cannot reach threshold {th} and bright defects cannot be detected.",
		"defect.probe.darkMargin":          "Dark headroom = golden max {max}; the background is too dark, so even dropping to 0 cannot reach threshold {th} and dark defects cannot be detected.",
		"defect.result.truncated":          "Showing the largest {shown} of {total} blobs (detected / rejected counts still cover all).",
	}, map[string]string{
		"defect.section.channel":           "렌더링 채널",
		"defect.section.brush":             "브러시",
		"defect.tool.brightSpot":           "밝은 점",
		"defect.tool.darkSpot":             "어두운 점",
		"defect.tool.brightLine":           "밝은 선",
		"defect.tool.darkLine":             "어두운 선",
		"defect.tool.foreign":              "이물",
		"defect.tool.contamination":        "오염",
		"defect.tool.hint":                 "도구: {name}",
		"defect.brush.radius":              "반경",
		"defect.brush.deltaGv":             "ΔGV",
		"defect.brush.softness":            "부드러움",
		"defect.brush.foreignMetal":        "이물 재질 metal",
		"defect.brush.foreignSr":           "이물 재질 sr",
		"defect.brush.foreignOpen":         "이물 재질 open",
		"defect.brush.contaminationFactor": "오염 계수",
		"defect.brush.undo":                "실행 취소",
		"defect.brush.clear":               "비우기",
		"defect.brush.empty":               "아직 획이 없습니다.",
		"defect.brush.delete":              "삭제",
		"defect.section.params":            "검출 파라미터",
		"defect.param.brightTh":            "Bright TH",
		"defect.param.darkTh":              "Dark TH",
		"defect.param.brightMinSize":       "Bright Size",
		"defect.param.darkMinSize":         "Dark Size",
		"defect.param.minDefectSize":       "Min Size",
		"defect.params.region":             "검사 영역",
		"defect.section.tools":             "도구",
		"defect.tool.probe":                "탐색 (드래그 박스)",
		"defect.tool.probeHint":            "뷰에서 박스를 드래그하여 탐색합니다",
		"defect.view.test":                 "테스트 이미지",
		"defect.view.golden":               "기준 이미지",
		"defect.view.diff":                 "차이 이미지",
		"defect.section.result":            "검출 결과",
		"defect.section.probe":             "탐색",
		"defect.result.empty":              "아직 검출을 실행하지 않았습니다.",
		"defect.result.detectedCount":      "검출 수",
		"defect.result.rejectedCount":      "거부 수",
		"defect.col.kind":                  "유형",
		"defect.col.area":                  "면적",
		"defect.col.peakDelta":             "피크 Δ",
		"defect.col.meanDelta":             "평균 Δ",
		"defect.col.result":                "결과",
		"defect.col.rule":                  "규칙",
		"defect.kind.bright":               "밝음",
		"defect.kind.dark":                 "어두움",
		"defect.result.detected":           "검출",
		"defect.result.simulated":          "시뮬레이션된 파라미터",
		"defect.result.unsimulated":        "미시뮬레이션 파라미터",
		"defect.probe.empty":               "아직 탐색하지 않았습니다.",
		"defect.probe.brightInsufficient":  "최대 밝기 차 {max} < Bright TH {th}: 차이가 부족하여 검출되지 않습니다",
		"defect.probe.brightTooSmall":      "임계 초과 픽셀 {pixels} < Size {size}: 면적 부족",
		"defect.probe.brightDetect":        "밝은 결함이 검출됩니다: 최대 밝기 차 {max}, 임계 초과 픽셀 {pixels}",
		"defect.probe.darkInsufficient":    "최대 어두움 차 {max} < Dark TH {th}: 차이가 부족하여 검출되지 않습니다",
		"defect.probe.darkTooSmall":        "임계 초과 픽셀 {pixels} < Size {size}: 면적 부족",
		"defect.probe.darkDetect":          "어두운 결함이 검출됩니다: 최대 어두움 차 {max}, 임계 초과 픽셀 {pixels}",
		"defect.stroke.foreign":            "이물 {material} @{x},{y}",
		"defect.stroke.contamination":      "오염 ×{factor} @{x},{y}",
		"defect.stroke.spot":               "{kind} 점 r{r} {amp} @{x},{y}",
		"defect.stroke.line":               "{kind} 선 r{r} {amp} @{x},{y}→{x2},{y2}",
		"defect.stroke.rect":               "{kind} 사각 {amp} @{x},{y}–{x2},{y2}",
		"defect.currentGray":               "결함 {kind}",
		"defect.tool.brightRect":           "밝은 사각",
		"defect.tool.darkRect":             "어두운 사각",
		"defect.section.amplitude":         "진폭 모드",
		"defect.amplitude.absolute":        "절대 ΔGV",
		"defect.amplitude.relative":        "상대 % (조명에 비례)",
		"defect.amplitude.target":          "목표 GV",
		"defect.brush.relativePct":         "상대 진폭 %",
		"defect.brush.targetBright":        "밝은 목표 GV",
		"defect.brush.targetDark":          "어두운 목표 GV",
		"defect.section.profile":           "가장자리 프로파일",
		"defect.profile.linear":            "선형",
		"defect.profile.gaussian":          "가우시안",
		"defect.brush.grain":               "그레인",
		"defect.brush.enabled":             "사용",
		"defect.section.random":            "랜덤 배치",
		"defect.random.count":              "개수",
		"defect.random.seed":               "시드",
		"defect.random.kind":               "유형",
		"defect.random.kind.bright":        "밝음",
		"defect.random.kind.dark":          "어두움",
		"defect.random.kind.mixed":         "혼합",
		"defect.random.shape":              "모양",
		"defect.random.shape.spot":         "점",
		"defect.random.shape.line":         "선",
		"defect.random.shape.mixed":        "혼합",
		"defect.random.radiusMin":          "반경 최소",
		"defect.random.radiusMax":          "반경 최대",
		"defect.random.valueMin":           "진폭 최소",
		"defect.random.valueMax":           "진폭 최대",
		"defect.random.material":           "배치 재질",
		"defect.random.material.all":       "전체",
		"defect.random.generate":           "생성",
		"defect.section.noise":             "이미징 노이즈",
		"defect.noise.readSigma":           "읽기 노이즈 σ",
		"defect.noise.shotGain":            "샷 노이즈 계수",
		"defect.noise.seed":                "시드",
		"defect.noise.note":                "노이즈는 테스트 이미지에만 추가됩니다. 기준 이미지는 다중 보드 중앙값으로 노이즈가 없다고 간주합니다. σ² = 읽기² + 샷 계수×GV 이므로 GV가 높을수록 노이즈가 큽니다.",
		"defect.param.brightRelPct":        "Bright Rel %",
		"defect.param.darkRelPct":          "Dark Rel %",
		"defect.param.relNote":             "유효 임계값 = TH + Golden×% 로, 교육용 근사이며 기기 Offset1(%)의 검증된 의미를 나타내지 않습니다.",
		"defect.result.regionGoldenMean":   "영역 Golden 평균",
		"defect.result.goldenSatPct":       "Golden 포화(255) 비율",
		"defect.result.testSatHigh":        "테스트 포화(255) 픽셀 수",
		"defect.result.satWarn":            "Golden 포화 비율 > 5%: 이 위치의 밝은 결함은 여유가 없어 검출할 수 없습니다.",
		"defect.col.goldenMean":            "배경 GV",
		"defect.col.threshold":             "유효 TH",
		"defect.col.saturated":             "포화 픽셀",
		"defect.reject.belowSize":          "면적 부족",
		"defect.probe.summary":             "박스 내 {pixels} 픽셀, Golden 평균 {mean} [{min}–{max}], 포화 {sat}",
		"defect.probe.brightInsufficient2": "밝음: 차이 부족 (최대 {max} < 유효 임계 최소 {th})",
		"defect.probe.brightTooSmall2":     "밝음: 최대 연결 임계 초과 면적 부족 ({largest} < {required}, 임계 초과 총 {pixels})",
		"defect.probe.brightDetect2":       "밝음: 검출됩니다 (최대 연결 임계 초과 면적 {largest} ≥ {required})",
		"defect.probe.darkInsufficient2":   "어두움: 차이 부족 (최대 {max} < 유효 임계 최소 {th})",
		"defect.probe.darkTooSmall2":       "어두움: 최대 연결 임계 초과 면적 부족 ({largest} < {required}, 임계 초과 총 {pixels})",
		"defect.probe.darkDetect2":         "어두움: 검출됩니다 (최대 연결 임계 초과 면적 {largest} ≥ {required})",
		"defect.probe.brightMargin":        "밝은 여유 = 255 − Golden 최소 {min} = {margin}; 배경이 너무 밝아 255로 포화되어도 임계 {th}에 도달할 수 없어 밝은 결함을 검출할 수 없습니다.",
		"defect.probe.darkMargin":          "어두운 여유 = Golden 최대 {max}; 배경이 너무 어두워 0으로 내려가도 임계 {th}에 도달할 수 없어 어두운 결함을 검출할 수 없습니다.",
		"defect.result.truncated":          "면적이 큰 상위 {shown}개만 표시합니다. 전체 {total}개 (검출/거부 수는 전체 기준).",
	})
}

const maxOverlayLabels = 200

// defectTool 是当前笔刷工具。
type defectTool int

// 笔刷工具常量。
const (
	toolNone defectTool = iota
	toolBrightSpot
	toolDarkSpot
	toolBrightLine
	toolDarkLine
	toolBrightRect
	toolDarkRect
	toolForeign
	toolContamination
	toolProbe
)

// strokeEntry 是一条笔画（GV 或场景）及其启用状态。
type strokeEntry struct {
	gv      *core.DefectStroke
	scene   *core.SceneStroke
	enabled bool
}

// DefectPanel 移植 teach-app/src/defect-panel.ts 为原生 ImGui 面板。
type DefectPanel struct {
	a *App

	tool              defectTool
	radius            float64
	deltaGv           float64
	softness          float64
	amplitude         core.DefectAmplitude
	relativePct       float64
	targetBright      float64
	targetDark        float64
	profile           core.DefectProfile
	grain             float64
	foreignMaterial   uint8
	contaminationFact float64
	strokes           []strokeEntry
	params            core.DefectParams
	regionMaterials   []uint8
	viewKind          string // "test" | "golden" | "diff"
	channel           core.CameraChannel
	noise             core.SensorNoise

	randomCount     int
	randomSeed      uint32
	randomKind      core.RandomKind
	randomShape     core.RandomShape
	randomRadiusMin float64
	randomRadiusMax float64
	randomValueMin  float64
	randomValueMax  float64
	randomMaterial  int // -1 = all, else material index

	strokeSeed uint32

	golden *core.GrayImage
	test   *core.GrayImage

	lastReport *core.DefectReport
	lastProbe  *core.ProbeReport
	probeRect  *core.Rect

	active bool

	renderRev   uint64
	renderedRev uint64

	dragging  bool
	dragStart core.Point
	dragCur   core.Point
}

func newDefectPanel(a *App) *DefectPanel {
	return &DefectPanel{
		a:                 a,
		tool:              toolNone,
		radius:            6,
		deltaGv:           60,
		softness:          0.3,
		amplitude:         core.AmpAbsolute,
		relativePct:       40,
		targetBright:      250,
		targetDark:        10,
		profile:           core.ProfileLinear,
		grain:             0,
		foreignMaterial:   core.MatMetal,
		contaminationFact: 1.5,
		params:            core.DefaultDefectParams,
		viewKind:          "test",
		channel:           core.ChRed,
		noise:             core.SensorNoise{Seed: 1},
		randomCount:       10,
		randomSeed:        1,
		randomKind:        core.RandomMixedKind,
		randomShape:       core.RandomMixedShape,
		randomRadiusMin:   2,
		randomRadiusMax:   8,
		randomValueMin:    30,
		randomValueMax:    80,
		randomMaterial:    -1,
		strokeSeed:        1,
		renderRev:         1,
	}
}

func (p *DefectPanel) ID() string    { return "defect" }
func (p *DefectPanel) Title() string { return T("tab.defect") }

func (p *DefectPanel) Activate() {
	p.active = true
	if p.lastReport == nil || p.renderRev != p.renderedRev {
		p.requestRun()
	} else {
		p.requestView()
	}
}

func (p *DefectPanel) Deactivate() {
	p.active = false
	p.dragging = false
}

func (p *DefectPanel) ModelLoaded() {
	p.strokes = nil
	p.lastReport = nil
	p.lastProbe = nil
	p.probeRect = nil
	p.golden = nil
	p.test = nil
	p.strokeSeed = 1
	p.renderRev++
}

func (p *DefectPanel) LightChanged() {
	p.renderRev++
	if p.active {
		p.requestRun()
	}
}

func (p *DefectPanel) Selftest() {
	if len(p.strokes) == 0 {
		cx, cy := p.findSrPoint()
		stroke := &core.DefectStroke{
			Kind:      core.Bright,
			Shape:     core.ShapeSpot,
			X:         float64(cx),
			Y:         float64(cy),
			Radius:    6,
			DeltaGv:   60,
			Softness:  0.3,
			Amplitude: core.AmpAbsolute,
			Profile:   core.ProfileLinear,
			Grain:     0,
			Seed:      1,
		}
		p.strokes = append(p.strokes, strokeEntry{gv: stroke, enabled: true})
		p.strokeSeed = 2
	}
	p.generateRandom(1, 10)
	p.renderRev++
	p.requestRun()
}

// findSrPoint 在材料图中寻找 SR 区域中心点（移植 TS findSrPoint）。
func (p *DefectPanel) findSrPoint() (int, int) {
	scene := p.a.Scene
	if scene == nil {
		return 0, 0
	}
	width, height := scene.W, scene.H
	cx := width / 2
	cy := height / 2
	material := scene.Material
	isSr := func(x, y int) bool {
		if x < 3 || y < 3 || x >= width-3 || y >= height-3 {
			return false
		}
		for dy := -3; dy <= 3; dy++ {
			for dx := -3; dx <= 3; dx++ {
				if material[(y+dy)*width+(x+dx)] != core.MatSR {
					return false
				}
			}
		}
		return true
	}
	if isSr(cx, cy) {
		return cx, cy
	}
	maxRing := width
	if height > maxRing {
		maxRing = height
	}
	for r := 8; r <= maxRing; r += 8 {
		for d := -r; d <= r; d += 8 {
			candidates := [][2]int{
				{cx + d, cy - r},
				{cx + d, cy + r},
				{cx - r, cy + d},
				{cx + r, cy + d},
			}
			for _, c := range candidates {
				if isSr(c[0], c[1]) {
					return c[0], c[1]
				}
			}
		}
	}
	return cx, cy
}

// gvStrokes 返回启用的 GV 笔画。
func (p *DefectPanel) gvStrokes() []core.DefectStroke {
	var out []core.DefectStroke
	for _, e := range p.strokes {
		if e.gv != nil && e.enabled {
			out = append(out, *e.gv)
		}
	}
	return out
}

// sceneStrokes 返回启用的场景笔画。
func (p *DefectPanel) sceneStrokes() []core.SceneStroke {
	var out []core.SceneStroke
	for _, e := range p.strokes {
		if e.scene != nil && e.enabled {
			out = append(out, *e.scene)
		}
	}
	return out
}

// requestRun 提交渲染 + 检出任务（key "defect"）。
func (p *DefectPanel) requestRun() {
	a := p.a
	scene := a.Scene
	if scene == nil {
		return
	}
	needRender := p.renderRev != p.renderedRev || p.golden == nil
	rev := p.renderRev
	light := a.Light.Clone()
	ch := p.channel
	noise := p.noise
	params := p.params
	viewKind := p.viewKind
	gv := p.gvStrokes()
	sc := p.sceneStrokes()
	regionMats := append([]uint8(nil), p.regionMaterials...)
	golden, test := p.golden, p.test
	a.Jobs.Run("defect", func() func() {
		if needRender {
			golden, test = core.RenderDefectPair(scene.Light, &light, ch, sc, gv, noise)
		}
		var region []uint8
		if len(regionMats) > 0 {
			region = core.MaterialMask(scene.Light, regionMats)
		}
		report, err := core.DetectDefects(golden, test, params, region)
		if err != nil {
			return func() { a.SetHint(T("common.error", "msg", err.Error())) }
		}
		var pix []byte
		switch viewKind {
		case "golden":
			pix = PackGray(golden)
		case "diff":
			pix = PackSignedDiff(golden, test)
		default:
			pix = PackGray(test)
		}
		w, h := golden.Width, golden.Height
		return func() {
			if a.Scene != scene {
				PutRGBA(pix)
				return
			}
			p.golden = golden
			p.test = test
			if needRender {
				p.renderedRev = rev
			}
			p.lastReport = &report
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

// requestView 从已有 golden/test 重新打包当前视图（key "defect-view"）。
func (p *DefectPanel) requestView() {
	a := p.a
	scene := a.Scene
	if scene == nil || p.golden == nil || p.test == nil {
		return
	}
	viewKind := p.viewKind
	golden, test := p.golden, p.test
	a.Jobs.Run("defect-view", func() func() {
		var pix []byte
		switch viewKind {
		case "golden":
			pix = PackGray(golden)
		case "diff":
			pix = PackSignedDiff(golden, test)
		default:
			pix = PackGray(test)
		}
		w, h := golden.Width, golden.Height
		return func() {
			if a.Scene != scene || p.golden != golden {
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

// requestProbe 在矩形区域上执行探查（key "defect-probe"）。
func (p *DefectPanel) requestProbe(rect core.Rect) {
	a := p.a
	scene := a.Scene
	if scene == nil || p.golden == nil || p.test == nil {
		return
	}
	params := p.params
	regionMats := append([]uint8(nil), p.regionMaterials...)
	golden, test := p.golden, p.test
	a.Jobs.Run("defect-probe", func() func() {
		var region []uint8
		if len(regionMats) > 0 {
			region = core.MaterialMask(scene.Light, regionMats)
		}
		report, err := core.ProbeArea(golden, test, rect, params, region)
		if err != nil {
			return func() { a.SetHint(T("common.error", "msg", err.Error())) }
		}
		return func() {
			if a.Scene != scene || p.golden != golden {
				return
			}
			p.lastProbe = &report
		}
	})
}

// generateRandom 在 UI 线程生成随机缺陷笔画。
func (p *DefectPanel) generateRandom(seed uint32, count int) {
	scene := p.a.Scene
	if scene == nil {
		return
	}
	var materials []uint8
	if p.randomMaterial >= 0 {
		materials = []uint8{uint8(p.randomMaterial)}
	}
	opts := core.RandomDefectOptions{
		Count:         count,
		Seed:          seed,
		Width:         scene.W,
		Height:        scene.H,
		Kind:          p.randomKind,
		Shape:         p.randomShape,
		RadiusMin:     math.Min(p.randomRadiusMin, p.randomRadiusMax),
		RadiusMax:     math.Max(p.randomRadiusMin, p.randomRadiusMax),
		ValueMin:      math.Min(p.randomValueMin, p.randomValueMax),
		ValueMax:      math.Max(p.randomValueMin, p.randomValueMax),
		Amplitude:     p.amplitude,
		Profile:       p.profile,
		Softness:      p.softness,
		Grain:         p.grain,
		LineLengthMax: 60,
		Material:      scene.Material,
		Materials:     materials,
	}
	strokes := core.GenerateRandomDefects(opts)
	for i := range strokes {
		s := strokes[i]
		p.strokes = append(p.strokes, strokeEntry{gv: &s, enabled: true})
	}
	p.renderRev++
}

// strokeLabel 按当前语言生成笔画标签。
func (p *DefectPanel) strokeLabel(s *core.DefectStroke) string {
	kind := T("defect.kind.dark")
	if s.Kind == core.Bright {
		kind = T("defect.kind.bright")
	}
	var amp string
	switch s.Amplitude {
	case core.AmpRelative:
		pct := int(math.Round(s.RelativePct))
		if s.Kind == core.Bright {
			amp = fmt.Sprintf("+%d%%", pct)
		} else {
			amp = fmt.Sprintf("−%d%%", pct)
		}
	case core.AmpTarget:
		tg := s.TargetGv
		if !s.HasTarget {
			if s.Kind == core.Bright {
				tg = 255
			} else {
				tg = 0
			}
		}
		amp = fmt.Sprintf("→%d", int(math.Round(tg)))
	default:
		amp = fmt.Sprintf("Δ%d", int(math.Round(s.DeltaGv)))
	}
	x := F(s.X, 0)
	y := F(s.Y, 0)
	switch s.Shape {
	case core.ShapeRect:
		return T("defect.stroke.rect", "kind", kind, "amp", amp, "x", x, "y", y, "x2", F(s.X2, 0), "y2", F(s.Y2, 0))
	case core.ShapeLine:
		return T("defect.stroke.line", "kind", kind, "r", F(s.Radius, 1), "amp", amp, "x", x, "y", y, "x2", F(s.X2, 0), "y2", F(s.Y2, 0))
	}
	return T("defect.stroke.spot", "kind", kind, "r", F(s.Radius, 1), "amp", amp, "x", x, "y", y)
}

// gvAmplitudeFields 按当前幅度模式填充 GV 笔画字段。
func (p *DefectPanel) gvAmplitudeFields(kind core.DefectKind) (core.DefectAmplitude, float64, float64, float64, bool) {
	switch p.amplitude {
	case core.AmpRelative:
		return core.AmpRelative, 0, p.relativePct, 0, false
	case core.AmpTarget:
		tg := p.targetDark
		if kind == core.Bright {
			tg = p.targetBright
		}
		return core.AmpTarget, 0, 0, tg, true
	}
	return core.AmpAbsolute, p.deltaGv, 0, 0, false
}

func (p *DefectPanel) placeSpot(x, y, radius float64) {
	switch p.tool {
	case toolForeign:
		s := core.SceneStroke{
			Mode:     core.SceneMaterial,
			Shape:    core.ShapeSpot,
			X:        x,
			Y:        y,
			Radius:   radius,
			Material: p.foreignMaterial,
		}
		p.strokes = append(p.strokes, strokeEntry{scene: &s, enabled: true})
	case toolContamination:
		s := core.SceneStroke{
			Mode:   core.SceneTexture,
			Shape:  core.ShapeSpot,
			X:      x,
			Y:      y,
			Radius: radius,
			Factor: p.contaminationFact,
		}
		p.strokes = append(p.strokes, strokeEntry{scene: &s, enabled: true})
	default:
		kind := core.Dark
		if p.tool == toolBrightSpot {
			kind = core.Bright
		}
		amp, dg, pct, tg, hasTg := p.gvAmplitudeFields(kind)
		s := core.DefectStroke{
			Kind:        kind,
			Shape:       core.ShapeSpot,
			X:           x,
			Y:           y,
			Radius:      radius,
			DeltaGv:     dg,
			Softness:    p.softness,
			Amplitude:   amp,
			RelativePct: pct,
			TargetGv:    tg,
			HasTarget:   hasTg,
			Profile:     p.profile,
			Grain:       p.grain,
			Seed:        p.strokeSeed,
		}
		p.strokeSeed++
		p.strokes = append(p.strokes, strokeEntry{gv: &s, enabled: true})
	}
	p.renderRev++
	p.requestRun()
}

func (p *DefectPanel) placeLine(x, y, x2, y2 float64) {
	kind := core.Dark
	if p.tool == toolBrightLine {
		kind = core.Bright
	}
	amp, dg, pct, tg, hasTg := p.gvAmplitudeFields(kind)
	s := core.DefectStroke{
		Kind:        kind,
		Shape:       core.ShapeLine,
		X:           x,
		Y:           y,
		X2:          x2,
		Y2:          y2,
		Radius:      p.radius,
		DeltaGv:     dg,
		Softness:    p.softness,
		Amplitude:   amp,
		RelativePct: pct,
		TargetGv:    tg,
		HasTarget:   hasTg,
		Profile:     p.profile,
		Grain:       p.grain,
		Seed:        p.strokeSeed,
	}
	p.strokeSeed++
	p.strokes = append(p.strokes, strokeEntry{gv: &s, enabled: true})
	p.renderRev++
	p.requestRun()
}

func (p *DefectPanel) placeRect(x, y, x2, y2 float64) {
	kind := core.Dark
	if p.tool == toolBrightRect {
		kind = core.Bright
	}
	amp, dg, pct, tg, hasTg := p.gvAmplitudeFields(kind)
	s := core.DefectStroke{
		Kind:        kind,
		Shape:       core.ShapeRect,
		X:           x,
		Y:           y,
		X2:          x2,
		Y2:          y2,
		Radius:      0,
		DeltaGv:     dg,
		Softness:    p.softness,
		Amplitude:   amp,
		RelativePct: pct,
		TargetGv:    tg,
		HasTarget:   hasTg,
		Profile:     p.profile,
		Grain:       p.grain,
		Seed:        p.strokeSeed,
	}
	p.strokeSeed++
	p.strokes = append(p.strokes, strokeEntry{gv: &s, enabled: true})
	p.renderRev++
	p.requestRun()
}

func (p *DefectPanel) DrawLeft() {
	a := p.a
	changed := false

	if Section(T("defect.section.channel"), "defect-ch") {
		ch := int(p.channel)
		if Combo(T("defect.section.channel"), "defect-channel", &ch, []string{"Red", "Green", "Blue"}) {
			p.channel = core.CameraChannel(ch)
			p.renderRev++
			changed = true
		}
	}

	if Section(T("defect.section.brush"), "defect-brush") {
		tools := []struct {
			tool  defectTool
			label string
		}{
			{toolBrightSpot, T("defect.tool.brightSpot")},
			{toolDarkSpot, T("defect.tool.darkSpot")},
			{toolBrightLine, T("defect.tool.brightLine")},
			{toolDarkLine, T("defect.tool.darkLine")},
			{toolBrightRect, T("defect.tool.brightRect")},
			{toolDarkRect, T("defect.tool.darkRect")},
			{toolForeign, T("defect.tool.foreign")},
			{toolContamination, T("defect.tool.contamination")},
		}
		for i, entry := range tools {
			if i > 0 {
				WrapSameLine(entry.label)
			}
			if ToolButton(entry.label, fmt.Sprintf("defect-tool-%d", i), p.tool == entry.tool) {
				p.tool = entry.tool
				a.SetHint(T("defect.tool.hint", "name", entry.label))
			}
		}
		SliderF64(T("defect.brush.radius"), "defect-radius", &p.radius, 0.5, 40, "%.1f")
		SliderF64(T("defect.brush.softness"), "defect-softness", &p.softness, 0, 1, "%.2f")
		// Combo order is metal, sr, open; map from the material index (metal=3, sr=1, open=2).
		fm := 0
		switch p.foreignMaterial {
		case core.MatSR:
			fm = 1
		case core.MatOpen:
			fm = 2
		}
		if Combo(T("defect.tool.foreign"), "defect-foreign", &fm, []string{
			T("defect.brush.foreignMetal"), T("defect.brush.foreignSr"), T("defect.brush.foreignOpen"),
		}) {
			switch fm {
			case 1:
				p.foreignMaterial = core.MatSR
			case 2:
				p.foreignMaterial = core.MatOpen
			default:
				p.foreignMaterial = core.MatMetal
			}
		}
		SliderF64(T("defect.brush.contaminationFactor"), "defect-contam", &p.contaminationFact, 0.2, 3, "%.2f")

		if len(p.strokes) == 0 {
			Note(T("defect.brush.empty"))
		} else {
			del := -1
			for i := range p.strokes {
				e := &p.strokes[i]
				imgui.PushIDInt(int32(i))
				if imgui.Checkbox("##en", &e.enabled) {
					p.renderRev++
					changed = true
				}
				imgui.SameLine()
				label := ""
				if e.gv != nil {
					label = p.strokeLabel(e.gv)
				} else if e.scene != nil {
					if e.scene.Mode == core.SceneMaterial {
						label = T("defect.stroke.foreign", "material", core.MaterialNames[e.scene.Material&3], "x", F(e.scene.X, 0), "y", F(e.scene.Y, 0))
					} else {
						label = T("defect.stroke.contamination", "factor", F(e.scene.Factor, 2), "x", F(e.scene.X, 0), "y", F(e.scene.Y, 0))
					}
				}
				imgui.AlignTextToFramePadding()
				imgui.TextUnformatted(label)
				imgui.SameLine()
				if Button(T("defect.brush.delete"), "defect-del") {
					del = i
				}
				imgui.PopID()
			}
			if del >= 0 {
				p.strokes = append(p.strokes[:del], p.strokes[del+1:]...)
				p.renderRev++
				changed = true
			}
		}
		if Button(T("defect.brush.undo"), "defect-undo") {
			if len(p.strokes) > 0 {
				p.strokes = p.strokes[:len(p.strokes)-1]
				p.renderRev++
				changed = true
			}
		}
		imgui.SameLine()
		if Button(T("defect.brush.clear"), "defect-clear") {
			p.strokes = nil
			p.renderRev++
			changed = true
		}
	}

	if Section(T("defect.section.amplitude"), "defect-amp") {
		amp := int(p.amplitude)
		if Combo(T("defect.section.amplitude"), "defect-ampmode", &amp, []string{
			T("defect.amplitude.absolute"), T("defect.amplitude.relative"), T("defect.amplitude.target"),
		}) {
			p.amplitude = core.DefectAmplitude(amp)
		}
		switch p.amplitude {
		case core.AmpRelative:
			SliderF64(T("defect.brush.relativePct"), "defect-relpct", &p.relativePct, 1, 300, "%.0f")
		case core.AmpTarget:
			SliderF64(T("defect.brush.targetBright"), "defect-tgb", &p.targetBright, 0, 255, "%.0f")
			SliderF64(T("defect.brush.targetDark"), "defect-tgd", &p.targetDark, 0, 255, "%.0f")
		default:
			SliderF64(T("defect.brush.deltaGv"), "defect-deltagv", &p.deltaGv, 1, 255, "%.0f")
		}
	}

	if Section(T("defect.section.profile"), "defect-profile") {
		pr := int(p.profile)
		if Combo(T("defect.section.profile"), "defect-profilemode", &pr, []string{
			T("defect.profile.linear"), T("defect.profile.gaussian"),
		}) {
			p.profile = core.DefectProfile(pr)
		}
		SliderF64(T("defect.brush.grain"), "defect-grain", &p.grain, 0, 1, "%.2f")
	}

	if Section(T("defect.section.params"), "defect-params") {
		rerun := false
		rerun = SliderF64(T("defect.param.brightTh"), "defect-bth", &p.params.BrightTh, 1, 255, "%.0f") || rerun
		rerun = SliderF64(T("defect.param.darkTh"), "defect-dth", &p.params.DarkTh, 1, 255, "%.0f") || rerun
		bs := p.params.BrightMinSize
		if SliderInt(T("defect.param.brightMinSize"), "defect-bsize", &bs, 1, 500) {
			p.params.BrightMinSize = bs
			rerun = true
		}
		ds := p.params.DarkMinSize
		if SliderInt(T("defect.param.darkMinSize"), "defect-dsize", &ds, 1, 500) {
			p.params.DarkMinSize = ds
			rerun = true
		}
		ms := p.params.MinDefectSize
		if SliderInt(T("defect.param.minDefectSize"), "defect-minsize", &ms, 1, 500) {
			p.params.MinDefectSize = ms
			rerun = true
		}
		rerun = SliderF64(T("defect.param.brightRelPct"), "defect-brel", &p.params.BrightRelPct, 0, 50, "%.1f") || rerun
		rerun = SliderF64(T("defect.param.darkRelPct"), "defect-drel", &p.params.DarkRelPct, 0, 50, "%.1f") || rerun
		Note(T("defect.param.relNote"))
		Note(T("defect.params.region"))
		for _, m := range []uint8{core.MatMetal, core.MatSR, core.MatOpen, core.MatBase} {
			on := false
			for _, rm := range p.regionMaterials {
				if rm == m {
					on = true
				}
			}
			if Check(core.MaterialNames[m], fmt.Sprintf("defect-region-%d", m), &on) {
				if on {
					p.regionMaterials = append(p.regionMaterials, m)
				} else {
					out := p.regionMaterials[:0]
					for _, rm := range p.regionMaterials {
						if rm != m {
							out = append(out, rm)
						}
					}
					p.regionMaterials = out
				}
				rerun = true
			}
		}
		if rerun {
			changed = true
		}
	}

	if SectionClosed(T("defect.section.random"), "defect-random") {
		cnt := p.randomCount
		if SliderInt(T("defect.random.count"), "defect-rcount", &cnt, 1, 200) {
			p.randomCount = cnt
		}
		seed := int(p.randomSeed)
		if SliderInt(T("defect.random.seed"), "defect-rseed", &seed, 1, 9999) {
			p.randomSeed = uint32(seed)
		}
		rk := int(p.randomKind)
		if Combo(T("defect.random.kind"), "defect-rkind", &rk, []string{
			T("defect.random.kind.bright"), T("defect.random.kind.dark"), T("defect.random.kind.mixed"),
		}) {
			p.randomKind = core.RandomKind(rk)
		}
		rs := int(p.randomShape)
		if Combo(T("defect.random.shape"), "defect-rshape", &rs, []string{
			T("defect.random.shape.spot"), T("defect.random.shape.line"), T("defect.random.shape.mixed"),
		}) {
			p.randomShape = core.RandomShape(rs)
		}
		SliderF64(T("defect.random.radiusMin"), "defect-rrmin", &p.randomRadiusMin, 0.5, 40, "%.1f")
		SliderF64(T("defect.random.radiusMax"), "defect-rrmax", &p.randomRadiusMax, 0.5, 40, "%.1f")
		SliderF64(T("defect.random.valueMin"), "defect-rvmin", &p.randomValueMin, 1, 300, "%.0f")
		SliderF64(T("defect.random.valueMax"), "defect-rvmax", &p.randomValueMax, 1, 300, "%.0f")
		// Combo order is all, metal, sr, open, base; randomMaterial is a material index or -1.
		comboToMat := []int{-1, core.MatMetal, core.MatSR, core.MatOpen, core.MatBase}
		rm := 0
		for i, m := range comboToMat {
			if m == p.randomMaterial {
				rm = i
			}
		}
		if Combo(T("defect.random.material"), "defect-rmat", &rm, []string{
			T("defect.random.material.all"), "metal", "sr", "open", "base",
		}) {
			p.randomMaterial = comboToMat[rm]
		}
		if Button(T("defect.random.generate"), "defect-rgen") {
			p.generateRandom(p.randomSeed, p.randomCount)
			changed = true
		}
	}

	if Section(T("defect.section.noise"), "defect-noise") {
		rs := p.noise.ReadSigma
		if SliderF64(T("defect.noise.readSigma"), "defect-readsigma", &rs, 0, 20, "%.1f") {
			p.noise.ReadSigma = rs
			p.renderRev++
			changed = true
		}
		sg := p.noise.ShotGain
		if SliderF64(T("defect.noise.shotGain"), "defect-shotgain", &sg, 0, 2, "%.2f") {
			p.noise.ShotGain = sg
			p.renderRev++
			changed = true
		}
		ns := int(p.noise.Seed)
		if SliderInt(T("defect.noise.seed"), "defect-noiseseed", &ns, 1, 9999) {
			p.noise.Seed = uint32(ns)
			p.renderRev++
			changed = true
		}
		Note(T("defect.noise.note"))
	}

	if Section(T("defect.section.tools"), "defect-tools") {
		if ToolButton(T("defect.tool.probe"), "defect-probe", p.tool == toolProbe) {
			p.tool = toolProbe
			a.SetHint(T("defect.tool.probeHint"))
		}
		vk := 0
		switch p.viewKind {
		case "golden":
			vk = 1
		case "diff":
			vk = 2
		}
		if Combo(T("defect.section.tools"), "defect-viewkind", &vk, []string{
			T("defect.view.test"), T("defect.view.golden"), T("defect.view.diff"),
		}) {
			switch vk {
			case 1:
				p.viewKind = "golden"
			case 2:
				p.viewKind = "diff"
			default:
				p.viewKind = "test"
			}
			if p.renderRev != p.renderedRev || p.golden == nil {
				p.requestRun()
			} else {
				p.requestView()
			}
		}
	}

	if changed {
		p.requestRun()
	}
}

func (p *DefectPanel) DrawRight() {
	a := p.a
	if Section(T("defect.section.result"), "defect-result") {
		if p.lastReport == nil {
			Note(T("defect.result.empty"))
		} else {
			r := p.lastReport
			stats := r.RegionStats
			satPct := 0.0
			if stats.Pixels > 0 {
				satPct = float64(stats.GoldenSaturatedHigh) / float64(stats.Pixels) * 100
			}
			rows := [][2]string{
				{T("defect.result.detectedCount"), fmt.Sprint(r.DetectedCount)},
				{T("defect.result.rejectedCount"), fmt.Sprint(r.RejectedCount)},
				{T("defect.result.regionGoldenMean"), F(stats.GoldenMean, 1)},
				{T("defect.result.goldenSatPct"), F(satPct, 1) + "%"},
				{T("defect.result.testSatHigh"), fmt.Sprint(stats.TestSaturatedHigh)},
			}
			KVTable("defect-kv", rows)
			if satPct > 5 {
				Warn(T("defect.result.satWarn"))
			}

			headers := []string{
				T("defect.col.kind"), T("defect.col.area"), T("defect.col.peakDelta"), T("defect.col.meanDelta"),
				T("defect.col.goldenMean"), T("defect.col.threshold"), T("defect.col.saturated"),
				T("defect.col.result"), T("defect.col.rule"),
			}
			blobs := r.Blobs
			clicked := DataTable("defect-blobs", headers, len(blobs), 12*imgui.FrameHeightWithSpacing()+8, func(row, col int) string {
				b := blobs[row]
				switch col {
				case 0:
					if b.Kind == core.Bright {
						return T("defect.kind.bright")
					}
					return T("defect.kind.dark")
				case 1:
					return fmt.Sprint(b.Area)
				case 2:
					return F(b.PeakDelta, 1)
				case 3:
					return F(b.MeanDelta, 1)
				case 4:
					return F(b.GoldenMean, 1)
				case 5:
					return F(b.ThresholdMean, 1)
				case 6:
					return fmt.Sprint(b.SaturatedPixels)
				case 7:
					if b.Detected {
						return T("defect.result.detected")
					}
					if b.RejectReason == "below-size" {
						return T("defect.reject.belowSize")
					}
					return b.RejectReason
				}
				return b.Rule
			}, -1)
			if clicked >= 0 && clicked < len(blobs) {
				a.Viewer.CenterOn(blobs[clicked].Centroid.X, blobs[clicked].Centroid.Y)
			}

			Note(T("defect.result.simulated"))
			for _, s := range r.SimulatedParams {
				Note(s)
			}
			Note(T("defect.result.unsimulated"))
			for _, s := range r.UnsimulatedParams {
				Note(s)
			}
		}
	}
	if Section(T("defect.section.probe"), "defect-probe-sec") {
		p.drawProbe()
	}
}

// drawProbe 渲染探查结果（与 TS renderProbe 相同的逐行解释）。
func (p *DefectPanel) drawProbe() {
	probe := p.lastProbe
	if probe == nil || probe.Pixels == 0 {
		Note(T("defect.probe.empty"))
		return
	}
	Note(T("defect.probe.summary",
		"pixels", fmt.Sprint(probe.Pixels),
		"mean", F(probe.GoldenMean, 1),
		"min", fmt.Sprint(probe.GoldenMin),
		"max", fmt.Sprint(probe.GoldenMax),
		"sat", fmt.Sprint(probe.GoldenSaturatedHigh)))
	if !probe.WouldDetectBright {
		if probe.MaxBright < probe.BrightThMin {
			th := F(probe.BrightThMin, 1)
			if probe.BrightThMax-probe.BrightThMin > 0.05 {
				th = F(probe.BrightThMin, 1) + "–" + F(probe.BrightThMax, 1)
			}
			Note(T("defect.probe.brightInsufficient2", "max", F(probe.MaxBright, 1), "th", th))
		} else {
			Note(T("defect.probe.brightTooSmall2",
				"largest", fmt.Sprint(probe.LargestBright),
				"required", fmt.Sprint(probe.RequiredBright),
				"pixels", fmt.Sprint(probe.BrightPixels)))
		}
	} else {
		Note(T("defect.probe.brightDetect2",
			"largest", fmt.Sprint(probe.LargestBright),
			"required", fmt.Sprint(probe.RequiredBright)))
	}
	if !probe.WouldDetectDark {
		if probe.MaxDark < probe.DarkThMin {
			th := F(probe.DarkThMin, 1)
			if probe.DarkThMax-probe.DarkThMin > 0.05 {
				th = F(probe.DarkThMin, 1) + "–" + F(probe.DarkThMax, 1)
			}
			Note(T("defect.probe.darkInsufficient2", "max", F(probe.MaxDark, 1), "th", th))
		} else {
			Note(T("defect.probe.darkTooSmall2",
				"largest", fmt.Sprint(probe.LargestDark),
				"required", fmt.Sprint(probe.RequiredDark),
				"pixels", fmt.Sprint(probe.DarkPixels)))
		}
	} else {
		Note(T("defect.probe.darkDetect2",
			"largest", fmt.Sprint(probe.LargestDark),
			"required", fmt.Sprint(probe.RequiredDark)))
	}
	brightMargin := 255 - probe.GoldenMin
	if float64(brightMargin) < probe.BrightThMin {
		Note(T("defect.probe.brightMargin",
			"min", fmt.Sprint(probe.GoldenMin),
			"margin", fmt.Sprint(brightMargin),
			"th", F(probe.BrightThMin, 1)))
	}
	darkMargin := probe.GoldenMax
	if float64(darkMargin) < probe.DarkThMin {
		Note(T("defect.probe.darkMargin",
			"max", fmt.Sprint(probe.GoldenMax),
			"th", F(probe.DarkThMin, 1)))
	}
}

func (p *DefectPanel) Overlay(o *Overlay) {
	if p.lastReport != nil {
		labels := 0
		for _, b := range p.lastReport.Blobs {
			if !o.Visible(b.BBox.X, b.BBox.Y, b.BBox.W, b.BBox.H) {
				continue
			}
			if b.Detected {
				o.Rect(b.BBox.X, b.BBox.Y, b.BBox.W, b.BBox.H, OverlayOK, 2)
			} else {
				o.Rect(b.BBox.X, b.BBox.Y, b.BBox.W, b.BBox.H, OverlayWarn, 1)
				a, bb := o.ToScreen(b.BBox.X, b.BBox.Y), o.ToScreen(b.BBox.X+b.BBox.W, b.BBox.Y+b.BBox.H)
				if bb.X-a.X >= 24 && labels < maxOverlayLabels {
					o.Text(b.BBox.X, b.BBox.Y, 2, -2, OverlayWarn, fmt.Sprintf("%s %d", T("defect.col.area"), b.Area))
					labels++
				}
			}
		}
	}
	for _, e := range p.strokes {
		col := OverlayROI
		if !e.enabled {
			col = OverlayMuted
		}
		if e.gv != nil {
			s := e.gv
			switch s.Shape {
			case core.ShapeSpot:
				o.Circle(s.X, s.Y, s.Radius, col, 1)
			case core.ShapeRect:
				o.Rect(math.Min(s.X, s.X2), math.Min(s.Y, s.Y2), math.Abs(s.X2-s.X), math.Abs(s.Y2-s.Y), col, 1)
			default:
				o.Line(s.X, s.Y, s.X2, s.Y2, col, 1)
			}
		} else if e.scene != nil {
			s := e.scene
			switch s.Shape {
			case core.ShapeSpot:
				o.Circle(s.X, s.Y, s.Radius, col, 1)
			case core.ShapeRect:
				o.Rect(math.Min(s.X, s.X2), math.Min(s.Y, s.Y2), math.Abs(s.X2-s.X), math.Abs(s.Y2-s.Y), col, 1)
			default:
				o.Line(s.X, s.Y, s.X2, s.Y2, col, 1)
			}
		}
	}
	if p.probeRect != nil {
		o.DashedRect(p.probeRect.X, p.probeRect.Y, p.probeRect.W, p.probeRect.H, OverlayProbe, 1.5)
	}
	if p.dragging {
		o.DragBox(p.dragStart.X, p.dragStart.Y, p.dragCur.X, p.dragCur.Y, OverlayROI)
	}
}

func (p *DefectPanel) Pointer(ev PointerEvent) bool {
	if p.tool == toolNone {
		return false
	}
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
		dist := math.Hypot(p.dragCur.X-p.dragStart.X, p.dragCur.Y-p.dragStart.Y)
		switch p.tool {
		case toolProbe:
			if w >= 2 && h >= 2 {
				r := core.Rect{X: x, Y: y, W: w, H: h}
				p.probeRect = &r
				p.requestProbe(r)
			}
		case toolBrightRect, toolDarkRect:
			if w >= 2 && h >= 2 {
				p.placeRect(p.dragStart.X, p.dragStart.Y, p.dragCur.X, p.dragCur.Y)
			}
		case toolBrightSpot, toolDarkSpot, toolForeign, toolContamination:
			radius := p.radius
			if dist >= 2 {
				radius = dist
			}
			p.placeSpot(p.dragStart.X, p.dragStart.Y, radius)
		case toolBrightLine, toolDarkLine:
			if w >= 2 || h >= 2 {
				p.placeLine(p.dragStart.X, p.dragStart.Y, p.dragCur.X, p.dragCur.Y)
			}
		}
		p.tool = toolNone
		return true
	}
	return false
}

func (p *DefectPanel) Hover(x, y int) string {
	var img *core.GrayImage
	switch p.viewKind {
	case "golden":
		img = p.golden
	default:
		img = p.test
	}
	if img == nil || x < 0 || y < 0 || x >= img.Width || y >= img.Height {
		return ""
	}
	if p.viewKind == "diff" && p.golden != nil {
		d := int(img.Data[y*img.Width+x]) - int(p.golden.Data[y*p.golden.Width+x])
		return fmt.Sprintf("Δ %d", d)
	}
	return fmt.Sprintf("GV %d", img.Data[y*img.Width+x])
}
