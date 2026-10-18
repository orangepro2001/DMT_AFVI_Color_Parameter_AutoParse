import type { Rect } from '../../teach-core/src/gray.ts';
import type { CameraChannel, Material } from '../../teach-core/src/light.ts';
import type {
  DefectAmplitude,
  DefectBlob,
  DefectParams,
  DefectProfile,
  DefectReport,
  DefectShape,
  DefectStroke,
  SceneStroke,
  SensorNoise,
} from '../../teach-core/src/defect.ts';
import { DEFAULT_DEFECT_PARAMS, generateRandomDefects } from '../../teach-core/src/index.ts';
import type { AppContext, Panel } from './main.ts';
import type { DefectRenderResult, ProbeResult } from './protocol.ts';
import { OVERLAY, button, checkbox, debounce, el, formatNumber, section, select, slider, table } from './ui.ts';
import { defineMessages, t } from './i18n.ts';

defineMessages({
  zh: {
    'defect.section.channel': '渲染通道',
    'defect.section.brush': '笔刷',
    'defect.tool.brightSpot': '亮点',
    'defect.tool.darkSpot': '暗点',
    'defect.tool.brightLine': '亮线',
    'defect.tool.darkLine': '暗线',
    'defect.tool.foreign': '异物',
    'defect.tool.contamination': '污染',
    'defect.tool.hint': '工具：{name}',
    'defect.brush.radius': '半径',
    'defect.brush.deltaGv': 'ΔGV',
    'defect.brush.softness': '柔和度',
    'defect.brush.foreignMetal': '异物材料 metal',
    'defect.brush.foreignSr': '异物材料 sr',
    'defect.brush.foreignOpen': '异物材料 open',
    'defect.brush.contaminationFactor': '污染系数',
    'defect.brush.undo': '撤销',
    'defect.brush.clear': '清空',
    'defect.brush.empty': '尚无笔画。',
    'defect.brush.delete': '删除',
    'defect.section.params': '检出参数',
    'defect.param.brightTh': 'Bright TH',
    'defect.param.darkTh': 'Dark TH',
    'defect.param.brightMinSize': 'Bright Size',
    'defect.param.darkMinSize': 'Dark Size',
    'defect.param.minDefectSize': 'Min Size',
    'defect.params.region': '检查区域',
    'defect.section.tools': '工具',
    'defect.tool.probe': '探查（拖框）',
    'defect.tool.probeHint': '在视图上拖框进行探查',
    'defect.view.test': '测试图',
    'defect.view.golden': '标准图',
    'defect.view.diff': '差异图',
    'defect.section.result': '检出结果',
    'defect.section.probe': '探查',
    'defect.result.empty': '尚未执行检出。',
    'defect.result.detectedCount': '检出数',
    'defect.result.rejectedCount': '被拒数',
    'defect.col.kind': '类型',
    'defect.col.area': '面积',
    'defect.col.peakDelta': '峰值Δ',
    'defect.col.meanDelta': '均值Δ',
    'defect.col.result': '结果',
    'defect.col.rule': '规则',
    'defect.kind.bright': '亮',
    'defect.kind.dark': '暗',
    'defect.result.detected': '检出',
    'defect.result.simulated': '已模拟参数',
    'defect.result.unsimulated': '未模拟参数',
    'defect.probe.empty': '尚未探查。',
    'defect.probe.brightInsufficient': '最大亮差 {max} < Bright TH {th}：差值不足，不会检出',
    'defect.probe.brightTooSmall': '超阈像素 {pixels} < Size {size}：面积不足',
    'defect.probe.brightDetect': '亮缺陷会检出：最大亮差 {max}，超阈像素 {pixels}',
    'defect.probe.darkInsufficient': '最大暗差 {max} < Dark TH {th}：差值不足，不会检出',
    'defect.probe.darkTooSmall': '超阈像素 {pixels} < Size {size}：面积不足',
    'defect.probe.darkDetect': '暗缺陷会检出：最大暗差 {max}，超阈像素 {pixels}',
    'defect.stroke.foreign': '异物 {material} @{x},{y}',
    'defect.stroke.contamination': '污染 ×{factor} @{x},{y}',
    'defect.stroke.spot': '{kind}点 r{r} {amp} @{x},{y}',
    'defect.stroke.line': '{kind}线 r{r} {amp} @{x},{y}→{x2},{y2}',
    'defect.stroke.rect': '{kind}块 {amp} @{x},{y}–{x2},{y2}',
    'defect.currentGray': '缺陷 {kind}',
    'defect.tool.brightRect': '亮块',
    'defect.tool.darkRect': '暗块',
    'defect.section.amplitude': '幅度模式',
    'defect.amplitude.absolute': '绝对 ΔGV',
    'defect.amplitude.relative': '相对 %（随光照）',
    'defect.amplitude.target': '目标 GV',
    'defect.brush.relativePct': '相对幅度 %',
    'defect.brush.targetBright': '亮目标 GV',
    'defect.brush.targetDark': '暗目标 GV',
    'defect.section.profile': '边缘轮廓',
    'defect.profile.linear': '线性',
    'defect.profile.gaussian': '高斯',
    'defect.brush.grain': '颗粒',
    'defect.brush.enabled': '启用',
    'defect.section.random': '随机批量',
    'defect.random.count': '数量',
    'defect.random.seed': '种子',
    'defect.random.kind': '类型',
    'defect.random.kind.bright': '亮',
    'defect.random.kind.dark': '暗',
    'defect.random.kind.mixed': '混合',
    'defect.random.shape': '形状',
    'defect.random.shape.spot': '点',
    'defect.random.shape.line': '线',
    'defect.random.shape.mixed': '混合',
    'defect.random.radiusMin': '半径最小',
    'defect.random.radiusMax': '半径最大',
    'defect.random.valueMin': '幅度最小',
    'defect.random.valueMax': '幅度最大',
    'defect.random.material': '放置材料',
    'defect.random.material.all': '全部',
    'defect.random.generate': '生成',
    'defect.section.noise': '成像噪声',
    'defect.noise.readSigma': '读出噪声 σ',
    'defect.noise.shotGain': '散粒噪声系数',
    'defect.noise.seed': '种子',
    'defect.noise.note': '噪声只加到测试图；标准图视为多板中值无噪声；σ² = 读出² + 散粒系数×GV，GV 越高噪声越大。',
    'defect.param.brightRelPct': 'Bright Rel %',
    'defect.param.darkRelPct': 'Dark Rel %',
    'defect.param.relNote': '有效阈值 = TH + Golden×%，为教学近似，不代表机台 Offset1(%) 的已核实语义。',
    'defect.result.regionGoldenMean': '区域 Golden 均值',
    'defect.result.goldenSatPct': 'Golden 饱和(255) 占比',
    'defect.result.testSatHigh': '测试图饱和(255) 像素数',
    'defect.result.satWarn': 'Golden 饱和占比 > 5%：这些位置的亮缺陷没有余量，不可能检出。',
    'defect.col.goldenMean': '背景 GV',
    'defect.col.threshold': '有效 TH',
    'defect.col.saturated': '饱和像素',
    'defect.reject.belowSize': '面积不足',
    'defect.probe.summary': '框内 {pixels} 像素，Golden 均值 {mean} [{min}–{max}]，饱和 {sat}',
    'defect.probe.brightInsufficient2': '亮：差值不足（最大 {max} < 有效阈值最小 {th}）',
    'defect.probe.brightTooSmall2': '亮：最大连通超阈面积不足（{largest} < {required}，超阈总数 {pixels}）',
    'defect.probe.brightDetect2': '亮：会检出（最大连通超阈面积 {largest} ≥ {required}）',
    'defect.probe.darkInsufficient2': '暗：差值不足（最大 {max} < 有效阈值最小 {th}）',
    'defect.probe.darkTooSmall2': '暗：最大连通超阈面积不足（{largest} < {required}，超阈总数 {pixels}）',
    'defect.probe.darkDetect2': '暗：会检出（最大连通超阈面积 {largest} ≥ {required}）',
    'defect.probe.brightMargin': '亮余量 = 255 − Golden 最小 {min} = {margin}；背景过亮，即使饱和到 255 也达不到阈值 {th}，亮缺陷不可能检出。',
    'defect.probe.darkMargin': '暗余量 = Golden 最大 {max}；背景过暗，即使降到 0 也达不到阈值 {th}，暗缺陷不可能检出。',
    'defect.result.truncated': '仅显示面积最大的前 {shown} 行，共 {total} 个连通域（检出 / 被拒计数仍按全部统计）。',
  },
  en: {
    'defect.section.channel': 'Render Channel',
    'defect.section.brush': 'Brush',
    'defect.tool.brightSpot': 'Bright spot',
    'defect.tool.darkSpot': 'Dark spot',
    'defect.tool.brightLine': 'Bright line',
    'defect.tool.darkLine': 'Dark line',
    'defect.tool.foreign': 'Foreign object',
    'defect.tool.contamination': 'Contamination',
    'defect.tool.hint': 'Tool: {name}',
    'defect.brush.radius': 'Radius',
    'defect.brush.deltaGv': 'ΔGV',
    'defect.brush.softness': 'Softness',
    'defect.brush.foreignMetal': 'Foreign material metal',
    'defect.brush.foreignSr': 'Foreign material sr',
    'defect.brush.foreignOpen': 'Foreign material open',
    'defect.brush.contaminationFactor': 'Contamination factor',
    'defect.brush.undo': 'Undo',
    'defect.brush.clear': 'Clear',
    'defect.brush.empty': 'No strokes yet.',
    'defect.brush.delete': 'Delete',
    'defect.section.params': 'Detection Parameters',
    'defect.param.brightTh': 'Bright TH',
    'defect.param.darkTh': 'Dark TH',
    'defect.param.brightMinSize': 'Bright Size',
    'defect.param.darkMinSize': 'Dark Size',
    'defect.param.minDefectSize': 'Min Size',
    'defect.params.region': 'Inspection region',
    'defect.section.tools': 'Tools',
    'defect.tool.probe': 'Probe (drag box)',
    'defect.tool.probeHint': 'Drag a box on the view to probe',
    'defect.view.test': 'Test image',
    'defect.view.golden': 'Golden image',
    'defect.view.diff': 'Difference image',
    'defect.section.result': 'Detection Result',
    'defect.section.probe': 'Probe',
    'defect.result.empty': 'Detection has not been run yet.',
    'defect.result.detectedCount': 'Detected',
    'defect.result.rejectedCount': 'Rejected',
    'defect.col.kind': 'Type',
    'defect.col.area': 'Area',
    'defect.col.peakDelta': 'Peak Δ',
    'defect.col.meanDelta': 'Mean Δ',
    'defect.col.result': 'Result',
    'defect.col.rule': 'Rule',
    'defect.kind.bright': 'Bright',
    'defect.kind.dark': 'Dark',
    'defect.result.detected': 'Detected',
    'defect.result.simulated': 'Simulated parameters',
    'defect.result.unsimulated': 'Unsimulated parameters',
    'defect.probe.empty': 'No probe yet.',
    'defect.probe.brightInsufficient': 'Max bright delta {max} < Bright TH {th}: delta too small, not detected',
    'defect.probe.brightTooSmall': 'Above-threshold pixels {pixels} < Size {size}: area too small',
    'defect.probe.brightDetect': 'Bright defect will be detected: max bright delta {max}, above-threshold pixels {pixels}',
    'defect.probe.darkInsufficient': 'Max dark delta {max} < Dark TH {th}: delta too small, not detected',
    'defect.probe.darkTooSmall': 'Above-threshold pixels {pixels} < Size {size}: area too small',
    'defect.probe.darkDetect': 'Dark defect will be detected: max dark delta {max}, above-threshold pixels {pixels}',
    'defect.stroke.foreign': 'Foreign {material} @{x},{y}',
    'defect.stroke.contamination': 'Contamination ×{factor} @{x},{y}',
    'defect.stroke.spot': '{kind} spot r{r} {amp} @{x},{y}',
    'defect.stroke.line': '{kind} line r{r} {amp} @{x},{y}→{x2},{y2}',
    'defect.stroke.rect': '{kind} rect {amp} @{x},{y}–{x2},{y2}',
    'defect.currentGray': 'Defect {kind}',
    'defect.tool.brightRect': 'Bright rect',
    'defect.tool.darkRect': 'Dark rect',
    'defect.section.amplitude': 'Amplitude Mode',
    'defect.amplitude.absolute': 'Absolute ΔGV',
    'defect.amplitude.relative': 'Relative % (scales with light)',
    'defect.amplitude.target': 'Target GV',
    'defect.brush.relativePct': 'Relative amplitude %',
    'defect.brush.targetBright': 'Bright target GV',
    'defect.brush.targetDark': 'Dark target GV',
    'defect.section.profile': 'Edge Profile',
    'defect.profile.linear': 'Linear',
    'defect.profile.gaussian': 'Gaussian',
    'defect.brush.grain': 'Grain',
    'defect.brush.enabled': 'Enabled',
    'defect.section.random': 'Random Batch',
    'defect.random.count': 'Count',
    'defect.random.seed': 'Seed',
    'defect.random.kind': 'Kind',
    'defect.random.kind.bright': 'Bright',
    'defect.random.kind.dark': 'Dark',
    'defect.random.kind.mixed': 'Mixed',
    'defect.random.shape': 'Shape',
    'defect.random.shape.spot': 'Spot',
    'defect.random.shape.line': 'Line',
    'defect.random.shape.mixed': 'Mixed',
    'defect.random.radiusMin': 'Radius min',
    'defect.random.radiusMax': 'Radius max',
    'defect.random.valueMin': 'Value min',
    'defect.random.valueMax': 'Value max',
    'defect.random.material': 'Placement material',
    'defect.random.material.all': 'All',
    'defect.random.generate': 'Generate',
    'defect.section.noise': 'Imaging Noise',
    'defect.noise.readSigma': 'Read noise σ',
    'defect.noise.shotGain': 'Shot noise gain',
    'defect.noise.seed': 'Seed',
    'defect.noise.note': 'Noise is added to the test image only; the golden image is treated as a multi-board median with no noise; σ² = read² + shotGain×GV, so higher GV means more noise.',
    'defect.param.brightRelPct': 'Bright Rel %',
    'defect.param.darkRelPct': 'Dark Rel %',
    'defect.param.relNote': 'Effective threshold = TH + Golden×%, a teaching approximation that does not represent the verified semantics of the machine Offset1(%).',
    'defect.result.regionGoldenMean': 'Region golden mean',
    'defect.result.goldenSatPct': 'Golden saturated (255) share',
    'defect.result.testSatHigh': 'Test saturated (255) pixels',
    'defect.result.satWarn': 'Golden saturated share > 5%: bright defects at these positions have no headroom and cannot be detected.',
    'defect.col.goldenMean': 'Background GV',
    'defect.col.threshold': 'Effective TH',
    'defect.col.saturated': 'Saturated px',
    'defect.reject.belowSize': 'Below size',
    'defect.probe.summary': '{pixels} pixels in box, golden mean {mean} [{min}–{max}], saturated {sat}',
    'defect.probe.brightInsufficient2': 'Bright: delta too small (max {max} < min effective threshold {th})',
    'defect.probe.brightTooSmall2': 'Bright: largest connected above-threshold area too small ({largest} < {required}, total above-threshold {pixels})',
    'defect.probe.brightDetect2': 'Bright: will be detected (largest connected above-threshold area {largest} ≥ {required})',
    'defect.probe.darkInsufficient2': 'Dark: delta too small (max {max} < min effective threshold {th})',
    'defect.probe.darkTooSmall2': 'Dark: largest connected above-threshold area too small ({largest} < {required}, total above-threshold {pixels})',
    'defect.probe.darkDetect2': 'Dark: will be detected (largest connected above-threshold area {largest} ≥ {required})',
    'defect.probe.brightMargin': 'Bright headroom = 255 − golden min {min} = {margin}; the background is too bright, so even saturating to 255 cannot reach threshold {th} and bright defects cannot be detected.',
    'defect.probe.darkMargin': 'Dark headroom = golden max {max}; the background is too dark, so even dropping to 0 cannot reach threshold {th} and dark defects cannot be detected.',
    'defect.result.truncated': 'Showing the largest {shown} of {total} blobs (detected / rejected counts still cover all).',
  },
  ko: {
    'defect.section.channel': '렌더링 채널',
    'defect.section.brush': '브러시',
    'defect.tool.brightSpot': '밝은 점',
    'defect.tool.darkSpot': '어두운 점',
    'defect.tool.brightLine': '밝은 선',
    'defect.tool.darkLine': '어두운 선',
    'defect.tool.foreign': '이물',
    'defect.tool.contamination': '오염',
    'defect.tool.hint': '도구: {name}',
    'defect.brush.radius': '반경',
    'defect.brush.deltaGv': 'ΔGV',
    'defect.brush.softness': '부드러움',
    'defect.brush.foreignMetal': '이물 재질 metal',
    'defect.brush.foreignSr': '이물 재질 sr',
    'defect.brush.foreignOpen': '이물 재질 open',
    'defect.brush.contaminationFactor': '오염 계수',
    'defect.brush.undo': '실행 취소',
    'defect.brush.clear': '비우기',
    'defect.brush.empty': '아직 획이 없습니다.',
    'defect.brush.delete': '삭제',
    'defect.section.params': '검출 파라미터',
    'defect.param.brightTh': 'Bright TH',
    'defect.param.darkTh': 'Dark TH',
    'defect.param.brightMinSize': 'Bright Size',
    'defect.param.darkMinSize': 'Dark Size',
    'defect.param.minDefectSize': 'Min Size',
    'defect.params.region': '검사 영역',
    'defect.section.tools': '도구',
    'defect.tool.probe': '탐색 (드래그 박스)',
    'defect.tool.probeHint': '뷰에서 박스를 드래그하여 탐색합니다',
    'defect.view.test': '테스트 이미지',
    'defect.view.golden': '기준 이미지',
    'defect.view.diff': '차이 이미지',
    'defect.section.result': '검출 결과',
    'defect.section.probe': '탐색',
    'defect.result.empty': '아직 검출을 실행하지 않았습니다.',
    'defect.result.detectedCount': '검출 수',
    'defect.result.rejectedCount': '거부 수',
    'defect.col.kind': '유형',
    'defect.col.area': '면적',
    'defect.col.peakDelta': '피크 Δ',
    'defect.col.meanDelta': '평균 Δ',
    'defect.col.result': '결과',
    'defect.col.rule': '규칙',
    'defect.kind.bright': '밝음',
    'defect.kind.dark': '어두움',
    'defect.result.detected': '검출',
    'defect.result.simulated': '시뮬레이션된 파라미터',
    'defect.result.unsimulated': '미시뮬레이션 파라미터',
    'defect.probe.empty': '아직 탐색하지 않았습니다.',
    'defect.probe.brightInsufficient': '최대 밝기 차 {max} < Bright TH {th}: 차이가 부족하여 검출되지 않습니다',
    'defect.probe.brightTooSmall': '임계 초과 픽셀 {pixels} < Size {size}: 면적 부족',
    'defect.probe.brightDetect': '밝은 결함이 검출됩니다: 최대 밝기 차 {max}, 임계 초과 픽셀 {pixels}',
    'defect.probe.darkInsufficient': '최대 어두움 차 {max} < Dark TH {th}: 차이가 부족하여 검출되지 않습니다',
    'defect.probe.darkTooSmall': '임계 초과 픽셀 {pixels} < Size {size}: 면적 부족',
    'defect.probe.darkDetect': '어두운 결함이 검출됩니다: 최대 어두움 차 {max}, 임계 초과 픽셀 {pixels}',
    'defect.stroke.foreign': '이물 {material} @{x},{y}',
    'defect.stroke.contamination': '오염 ×{factor} @{x},{y}',
    'defect.stroke.spot': '{kind} 점 r{r} {amp} @{x},{y}',
    'defect.stroke.line': '{kind} 선 r{r} {amp} @{x},{y}→{x2},{y2}',
    'defect.stroke.rect': '{kind} 사각 {amp} @{x},{y}–{x2},{y2}',
    'defect.currentGray': '결함 {kind}',
    'defect.tool.brightRect': '밝은 사각',
    'defect.tool.darkRect': '어두운 사각',
    'defect.section.amplitude': '진폭 모드',
    'defect.amplitude.absolute': '절대 ΔGV',
    'defect.amplitude.relative': '상대 % (조명에 비례)',
    'defect.amplitude.target': '목표 GV',
    'defect.brush.relativePct': '상대 진폭 %',
    'defect.brush.targetBright': '밝은 목표 GV',
    'defect.brush.targetDark': '어두운 목표 GV',
    'defect.section.profile': '가장자리 프로파일',
    'defect.profile.linear': '선형',
    'defect.profile.gaussian': '가우시안',
    'defect.brush.grain': '그레인',
    'defect.brush.enabled': '사용',
    'defect.section.random': '랜덤 배치',
    'defect.random.count': '개수',
    'defect.random.seed': '시드',
    'defect.random.kind': '유형',
    'defect.random.kind.bright': '밝음',
    'defect.random.kind.dark': '어두움',
    'defect.random.kind.mixed': '혼합',
    'defect.random.shape': '모양',
    'defect.random.shape.spot': '점',
    'defect.random.shape.line': '선',
    'defect.random.shape.mixed': '혼합',
    'defect.random.radiusMin': '반경 최소',
    'defect.random.radiusMax': '반경 최대',
    'defect.random.valueMin': '진폭 최소',
    'defect.random.valueMax': '진폭 최대',
    'defect.random.material': '배치 재질',
    'defect.random.material.all': '전체',
    'defect.random.generate': '생성',
    'defect.section.noise': '이미징 노이즈',
    'defect.noise.readSigma': '읽기 노이즈 σ',
    'defect.noise.shotGain': '샷 노이즈 계수',
    'defect.noise.seed': '시드',
    'defect.noise.note': '노이즈는 테스트 이미지에만 추가됩니다. 기준 이미지는 다중 보드 중앙값으로 노이즈가 없다고 간주합니다. σ² = 읽기² + 샷 계수×GV 이므로 GV가 높을수록 노이즈가 큽니다.',
    'defect.param.brightRelPct': 'Bright Rel %',
    'defect.param.darkRelPct': 'Dark Rel %',
    'defect.param.relNote': '유효 임계값 = TH + Golden×% 로, 교육용 근사이며 기기 Offset1(%)의 검증된 의미를 나타내지 않습니다.',
    'defect.result.regionGoldenMean': '영역 Golden 평균',
    'defect.result.goldenSatPct': 'Golden 포화(255) 비율',
    'defect.result.testSatHigh': '테스트 포화(255) 픽셀 수',
    'defect.result.satWarn': 'Golden 포화 비율 > 5%: 이 위치의 밝은 결함은 여유가 없어 검출할 수 없습니다.',
    'defect.col.goldenMean': '배경 GV',
    'defect.col.threshold': '유효 TH',
    'defect.col.saturated': '포화 픽셀',
    'defect.reject.belowSize': '면적 부족',
    'defect.probe.summary': '박스 내 {pixels} 픽셀, Golden 평균 {mean} [{min}–{max}], 포화 {sat}',
    'defect.probe.brightInsufficient2': '밝음: 차이 부족 (최대 {max} < 유효 임계 최소 {th})',
    'defect.probe.brightTooSmall2': '밝음: 최대 연결 임계 초과 면적 부족 ({largest} < {required}, 임계 초과 총 {pixels})',
    'defect.probe.brightDetect2': '밝음: 검출됩니다 (최대 연결 임계 초과 면적 {largest} ≥ {required})',
    'defect.probe.darkInsufficient2': '어두움: 차이 부족 (최대 {max} < 유효 임계 최소 {th})',
    'defect.probe.darkTooSmall2': '어두움: 최대 연결 임계 초과 면적 부족 ({largest} < {required}, 임계 초과 총 {pixels})',
    'defect.probe.darkDetect2': '어두움: 검출됩니다 (최대 연결 임계 초과 면적 {largest} ≥ {required})',
    'defect.probe.brightMargin': '밝은 여유 = 255 − Golden 최소 {min} = {margin}; 배경이 너무 밝아 255로 포화되어도 임계 {th}에 도달할 수 없어 밝은 결함을 검출할 수 없습니다.',
    'defect.probe.darkMargin': '어두운 여유 = Golden 최대 {max}; 배경이 너무 어두워 0으로 내려가도 임계 {th}에 도달할 수 없어 어두운 결함을 검출할 수 없습니다.',
    'defect.result.truncated': '면적이 큰 상위 {shown}개만 표시합니다. 전체 {total}개 (검출/거부 수는 전체 기준).',
  },
});

const MAX_BLOB_ROWS = 300;
const MAX_OVERLAY_LABELS = 200;

type Tool =
  | 'none'
  | 'brightSpot'
  | 'darkSpot'
  | 'brightLine'
  | 'darkLine'
  | 'brightRect'
  | 'darkRect'
  | 'foreign'
  | 'contamination'
  | 'probe';

interface StrokeEntry {
  stroke: DefectStroke | SceneStroke;
  kind: 'gv' | 'scene';
  label: string;
  enabled: boolean;
}

export class DefectPanel implements Panel {
  private ctx: AppContext;
  private left: HTMLElement;
  private right: HTMLElement;
  private tool: Tool = 'none';
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private radius = 6;
  private deltaGv = 60;
  private softness = 0.3;
  private amplitude: DefectAmplitude = 'absolute';
  private relativePct = 40;
  private targetBright = 250;
  private targetDark = 10;
  private profile: DefectProfile = 'linear';
  private grain = 0;
  private foreignMaterial: Material = 'metal';
  private contaminationFactor = 1.5;
  private strokes: StrokeEntry[] = [];
  private params: DefectParams;
  private regionMaterials: Material[] = [];
  private viewKind: 'test' | 'golden' | 'diff' = 'test';
  private channel: CameraChannel = 'Red';
  private dragging = false;
  private dragStart: [number, number] = [0, 0];
  private dragCurrent: [number, number] = [0, 0];
  private probeRect: Rect | null = null;
  private lastReport: DefectReport | null = null;
  private lastProbe: ProbeResult | null = null;
  private renderDirty = true;
  private detectDirty = true;
  private active = false;
  private resultHost: HTMLElement;
  private probeHost: HTMLElement;
  private strokeListHost: HTMLElement;
  private scheduleRun: () => void;
  private noise: SensorNoise = { readSigma: 0, shotGain: 0, seed: 1 };
  private randomCount = 10;
  private randomSeed = 1;
  private randomKind: 'bright' | 'dark' | 'mixed' = 'mixed';
  private randomShape: 'spot' | 'line' | 'mixed' = 'mixed';
  private randomRadiusMin = 2;
  private randomRadiusMax = 8;
  private randomValueMin = 30;
  private randomValueMax = 80;
  private randomMaterial: Material | 'all' = 'all';
  private strokeSeed = 1;

  constructor() {
    this.ctx = null as unknown as AppContext;
    this.left = el('div');
    this.right = el('div');
    this.params = { ...DEFAULT_DEFECT_PARAMS };
    this.resultHost = el('div');
    this.probeHost = el('div');
    this.strokeListHost = el('div', { class: 'list' });
    this.scheduleRun = debounce(() => {
      void this.runDetect();
    }, 300);
  }

  attach(ctx: AppContext, left: HTMLElement, right: HTMLElement): void {
    this.ctx = ctx;
    this.left = left;
    this.right = right;
    this.buildLeft();
    this.buildRight();
  }

  private selectTool(tool: Tool, label: string): void {
    this.tool = tool;
    for (const [key, node] of this.toolButtons) {
      node.classList.toggle('primary', key === tool);
    }
    this.ctx.setHint(t('defect.tool.hint', { name: label }));
  }

  private clearTool(): void {
    this.tool = 'none';
    for (const node of this.toolButtons.values()) node.classList.remove('primary');
  }

  private buildLeft(): void {
    const ctx = this.ctx;
    this.left.textContent = '';
    this.toolButtons.clear();

    const channelSection = section(t('defect.section.channel'));
    channelSection.body.appendChild(
      select(
        [
          { value: 'Red', label: 'Red' },
          { value: 'Green', label: 'Green' },
          { value: 'Blue', label: 'Blue' },
        ],
        this.channel,
        (value) => {
          this.channel = value === 'Green' ? 'Green' : value === 'Blue' ? 'Blue' : 'Red';
          this.renderDirty = true;
          this.scheduleRun();
        },
      ),
    );
    this.left.appendChild(channelSection.root);

    const brushSection = section(t('defect.section.brush'));
    const brushRow = el('div', { class: 'row wrap' });
    const tools: Array<{ tool: Tool; label: string }> = [
      { tool: 'brightSpot', label: t('defect.tool.brightSpot') },
      { tool: 'darkSpot', label: t('defect.tool.darkSpot') },
      { tool: 'brightLine', label: t('defect.tool.brightLine') },
      { tool: 'darkLine', label: t('defect.tool.darkLine') },
      { tool: 'brightRect', label: t('defect.tool.brightRect') },
      { tool: 'darkRect', label: t('defect.tool.darkRect') },
      { tool: 'foreign', label: t('defect.tool.foreign') },
      { tool: 'contamination', label: t('defect.tool.contamination') },
    ];
    for (const entry of tools) {
      const node = button(entry.label, () => {
        this.selectTool(entry.tool, entry.label);
      });
      this.toolButtons.set(entry.tool, node);
      brushRow.appendChild(node);
    }
    brushSection.body.appendChild(brushRow);
    brushSection.body.appendChild(
      slider({
        label: t('defect.brush.radius'),
        min: 0.5,
        max: 40,
        step: 0.5,
        value: this.radius,
        onInput: (v) => {
          this.radius = v;
        },
      }).root,
    );
    brushSection.body.appendChild(
      slider({
        label: t('defect.brush.softness'),
        min: 0,
        max: 1,
        step: 0.01,
        value: this.softness,
        onInput: (v) => {
          this.softness = v;
        },
      }).root,
    );
    brushSection.body.appendChild(
      select(
        [
          { value: 'metal', label: t('defect.brush.foreignMetal') },
          { value: 'sr', label: t('defect.brush.foreignSr') },
          { value: 'open', label: t('defect.brush.foreignOpen') },
        ],
        this.foreignMaterial,
        (value) => {
          this.foreignMaterial = value === 'sr' ? 'sr' : value === 'open' ? 'open' : 'metal';
        },
      ),
    );
    brushSection.body.appendChild(
      slider({
        label: t('defect.brush.contaminationFactor'),
        min: 0.2,
        max: 3,
        step: 0.05,
        value: this.contaminationFactor,
        onInput: (v) => {
          this.contaminationFactor = v;
        },
      }).root,
    );
    brushSection.body.appendChild(this.strokeListHost);
    const strokeButtons = el('div', { class: 'row' });
    strokeButtons.appendChild(
      button(t('defect.brush.undo'), () => {
        this.strokes.pop();
        this.renderDirty = true;
        this.renderStrokeList();
        this.scheduleRun();
      }),
    );
    strokeButtons.appendChild(
      button(t('defect.brush.clear'), () => {
        this.strokes = [];
        this.renderDirty = true;
        this.renderStrokeList();
        this.scheduleRun();
      }),
    );
    brushSection.body.appendChild(strokeButtons);
    this.left.appendChild(brushSection.root);

    const amplitudeSection = section(t('defect.section.amplitude'));
    const absoluteGroup = el('div');
    const relativeGroup = el('div');
    const targetGroup = el('div');
    const updateAmplitudeGroups = (): void => {
      absoluteGroup.hidden = this.amplitude !== 'absolute';
      relativeGroup.hidden = this.amplitude !== 'relative';
      targetGroup.hidden = this.amplitude !== 'target';
    };
    amplitudeSection.body.appendChild(
      select(
        [
          { value: 'absolute', label: t('defect.amplitude.absolute') },
          { value: 'relative', label: t('defect.amplitude.relative') },
          { value: 'target', label: t('defect.amplitude.target') },
        ],
        this.amplitude,
        (value) => {
          this.amplitude = value === 'relative' ? 'relative' : value === 'target' ? 'target' : 'absolute';
          updateAmplitudeGroups();
        },
      ),
    );
    absoluteGroup.appendChild(
      slider({
        label: t('defect.brush.deltaGv'),
        min: 1,
        max: 255,
        step: 1,
        value: this.deltaGv,
        onInput: (v) => {
          this.deltaGv = v;
        },
      }).root,
    );
    relativeGroup.appendChild(
      slider({
        label: t('defect.brush.relativePct'),
        min: 1,
        max: 300,
        step: 1,
        value: this.relativePct,
        onInput: (v) => {
          this.relativePct = v;
        },
      }).root,
    );
    targetGroup.appendChild(
      slider({
        label: t('defect.brush.targetBright'),
        min: 0,
        max: 255,
        step: 1,
        value: this.targetBright,
        onInput: (v) => {
          this.targetBright = v;
        },
      }).root,
    );
    targetGroup.appendChild(
      slider({
        label: t('defect.brush.targetDark'),
        min: 0,
        max: 255,
        step: 1,
        value: this.targetDark,
        onInput: (v) => {
          this.targetDark = v;
        },
      }).root,
    );
    amplitudeSection.body.appendChild(absoluteGroup);
    amplitudeSection.body.appendChild(relativeGroup);
    amplitudeSection.body.appendChild(targetGroup);
    updateAmplitudeGroups();
    this.left.appendChild(amplitudeSection.root);

    const profileSection = section(t('defect.section.profile'));
    profileSection.body.appendChild(
      select(
        [
          { value: 'linear', label: t('defect.profile.linear') },
          { value: 'gaussian', label: t('defect.profile.gaussian') },
        ],
        this.profile,
        (value) => {
          this.profile = value === 'gaussian' ? 'gaussian' : 'linear';
        },
      ),
    );
    profileSection.body.appendChild(
      slider({
        label: t('defect.brush.grain'),
        min: 0,
        max: 1,
        step: 0.01,
        value: this.grain,
        onInput: (v) => {
          this.grain = v;
        },
      }).root,
    );
    this.left.appendChild(profileSection.root);

    const paramSection = section(t('defect.section.params'));
    const addParam = (label: string, key: keyof DefectParams, min: number, max: number, step: number): void => {
      paramSection.body.appendChild(
        slider({
          label,
          min,
          max,
          step,
          value: this.params[key] ?? 0,
          onInput: (v) => {
            this.params[key] = v;
            this.detectDirty = true;
            this.scheduleRun();
          },
        }).root,
      );
    };
    addParam(t('defect.param.brightTh'), 'brightTh', 1, 255, 1);
    addParam(t('defect.param.darkTh'), 'darkTh', 1, 255, 1);
    addParam(t('defect.param.brightMinSize'), 'brightMinSize', 1, 500, 1);
    addParam(t('defect.param.darkMinSize'), 'darkMinSize', 1, 500, 1);
    addParam(t('defect.param.minDefectSize'), 'minDefectSize', 1, 500, 1);
    addParam(t('defect.param.brightRelPct'), 'brightRelPct', 0, 50, 0.5);
    addParam(t('defect.param.darkRelPct'), 'darkRelPct', 0, 50, 0.5);
    paramSection.body.appendChild(el('div', { class: 'note', text: t('defect.param.relNote') }));
    paramSection.body.appendChild(el('div', { class: 'note', text: t('defect.params.region') }));
    for (const material of ['metal', 'sr', 'open', 'base'] as Material[]) {
      paramSection.body.appendChild(
        checkbox(material, this.regionMaterials.includes(material), (checked) => {
          if (checked) {
            if (!this.regionMaterials.includes(material)) this.regionMaterials.push(material);
          } else {
            this.regionMaterials = this.regionMaterials.filter((m) => m !== material);
          }
          this.detectDirty = true;
          this.scheduleRun();
        }),
      );
    }
    this.left.appendChild(paramSection.root);

    const randomSection = section(t('defect.section.random'), true);
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.count'),
        min: 1,
        max: 200,
        step: 1,
        value: this.randomCount,
        onInput: (v) => {
          this.randomCount = Math.round(v);
        },
      }).root,
    );
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.seed'),
        min: 1,
        max: 9999,
        step: 1,
        value: this.randomSeed,
        onInput: (v) => {
          this.randomSeed = Math.round(v);
        },
      }).root,
    );
    randomSection.body.appendChild(
      select(
        [
          { value: 'bright', label: t('defect.random.kind.bright') },
          { value: 'dark', label: t('defect.random.kind.dark') },
          { value: 'mixed', label: t('defect.random.kind.mixed') },
        ],
        this.randomKind,
        (value) => {
          this.randomKind = value === 'bright' ? 'bright' : value === 'dark' ? 'dark' : 'mixed';
        },
      ),
    );
    randomSection.body.appendChild(
      select(
        [
          { value: 'spot', label: t('defect.random.shape.spot') },
          { value: 'line', label: t('defect.random.shape.line') },
          { value: 'mixed', label: t('defect.random.shape.mixed') },
        ],
        this.randomShape,
        (value) => {
          this.randomShape = value === 'spot' ? 'spot' : value === 'line' ? 'line' : 'mixed';
        },
      ),
    );
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.radiusMin'),
        min: 0.5,
        max: 40,
        step: 0.5,
        value: this.randomRadiusMin,
        onInput: (v) => {
          this.randomRadiusMin = v;
        },
      }).root,
    );
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.radiusMax'),
        min: 0.5,
        max: 40,
        step: 0.5,
        value: this.randomRadiusMax,
        onInput: (v) => {
          this.randomRadiusMax = v;
        },
      }).root,
    );
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.valueMin'),
        min: 1,
        max: 300,
        step: 1,
        value: this.randomValueMin,
        onInput: (v) => {
          this.randomValueMin = v;
        },
      }).root,
    );
    randomSection.body.appendChild(
      slider({
        label: t('defect.random.valueMax'),
        min: 1,
        max: 300,
        step: 1,
        value: this.randomValueMax,
        onInput: (v) => {
          this.randomValueMax = v;
        },
      }).root,
    );
    randomSection.body.appendChild(
      select(
        [
          { value: 'all', label: t('defect.random.material.all') },
          { value: 'metal', label: 'metal' },
          { value: 'sr', label: 'sr' },
          { value: 'open', label: 'open' },
          { value: 'base', label: 'base' },
        ],
        this.randomMaterial,
        (value) => {
          this.randomMaterial =
            value === 'metal' || value === 'sr' || value === 'open' || value === 'base' ? value : 'all';
        },
      ),
    );
    randomSection.body.appendChild(
      button(t('defect.random.generate'), () => {
        this.generateRandom();
      }),
    );
    this.left.appendChild(randomSection.root);

    const noiseSection = section(t('defect.section.noise'));
    noiseSection.body.appendChild(
      slider({
        label: t('defect.noise.readSigma'),
        min: 0,
        max: 20,
        step: 0.1,
        value: this.noise.readSigma,
        onInput: (v) => {
          this.noise = { ...this.noise, readSigma: v };
          this.renderDirty = true;
          this.scheduleRun();
        },
      }).root,
    );
    noiseSection.body.appendChild(
      slider({
        label: t('defect.noise.shotGain'),
        min: 0,
        max: 2,
        step: 0.01,
        value: this.noise.shotGain,
        onInput: (v) => {
          this.noise = { ...this.noise, shotGain: v };
          this.renderDirty = true;
          this.scheduleRun();
        },
      }).root,
    );
    noiseSection.body.appendChild(
      slider({
        label: t('defect.noise.seed'),
        min: 1,
        max: 9999,
        step: 1,
        value: this.noise.seed,
        onInput: (v) => {
          this.noise = { ...this.noise, seed: Math.round(v) };
          this.renderDirty = true;
          this.scheduleRun();
        },
      }).root,
    );
    noiseSection.body.appendChild(el('div', { class: 'note', text: t('defect.noise.note') }));
    this.left.appendChild(noiseSection.root);

    const toolSection = section(t('defect.section.tools'));
    const probeButton = button(t('defect.tool.probe'), () => {
      this.selectTool('probe', t('defect.tool.probe'));
    });
    this.toolButtons.set('probe', probeButton);
    toolSection.body.appendChild(probeButton);
    toolSection.body.appendChild(
      select(
        [
          { value: 'test', label: t('defect.view.test') },
          { value: 'golden', label: t('defect.view.golden') },
          { value: 'diff', label: t('defect.view.diff') },
        ],
        this.viewKind,
        (value) => {
          this.viewKind = value === 'golden' ? 'golden' : value === 'diff' ? 'diff' : 'test';
          if (this.renderDirty || this.detectDirty) {
            this.runDetect().catch((err: unknown) => {
              ctx.setHint(t('common.error', { msg: (err as Error).message }));
            });
          } else {
            this.showView().catch((err: unknown) => {
              ctx.setHint(t('common.error', { msg: (err as Error).message }));
            });
          }
        },
      ),
    );
    this.left.appendChild(toolSection.root);

    this.renderStrokeList();
  }

  private generateRandom(): void {
    const state = this.ctx.state;
    if (state.width === 0 || state.height === 0 || state.material === null) return;
    const material = this.randomMaterial === 'all' ? undefined : [this.randomMaterial];
    const strokes = generateRandomDefects({
      count: this.randomCount,
      seed: this.randomSeed,
      width: state.width,
      height: state.height,
      kind: this.randomKind,
      shape: this.randomShape,
      radiusMin: Math.min(this.randomRadiusMin, this.randomRadiusMax),
      radiusMax: Math.max(this.randomRadiusMin, this.randomRadiusMax),
      valueMin: Math.min(this.randomValueMin, this.randomValueMax),
      valueMax: Math.max(this.randomValueMin, this.randomValueMax),
      amplitude: this.amplitude,
      profile: this.profile,
      softness: this.softness,
      grain: this.grain,
      lineLengthMax: 60,
      material: state.material,
      materials: material,
    });
    for (const stroke of strokes) {
      this.strokes.push({
        stroke,
        kind: 'gv',
        label: this.strokeLabel(stroke),
        enabled: true,
      });
    }
    this.renderDirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private buildRight(): void {
    this.right.textContent = '';
    const resultSection = section(t('defect.section.result'));
    resultSection.body.appendChild(this.resultHost);
    this.right.appendChild(resultSection.root);
    const probeSection = section(t('defect.section.probe'));
    probeSection.body.appendChild(this.probeHost);
    this.right.appendChild(probeSection.root);
    this.renderResult();
  }

  private strokeLabel(stroke: DefectStroke): string {
    const kind = stroke.kind === 'bright' ? t('defect.kind.bright') : t('defect.kind.dark');
    const amplitude = stroke.amplitude ?? 'absolute';
    let amp: string;
    if (amplitude === 'relative') {
      const pct = Math.round(stroke.relativePct ?? 30);
      amp = stroke.kind === 'bright' ? `+${pct}%` : `−${pct}%`;
    } else if (amplitude === 'target') {
      amp = `→${Math.round(stroke.targetGv ?? (stroke.kind === 'bright' ? 255 : 0))}`;
    } else {
      amp = `Δ${Math.round(stroke.deltaGv)}`;
    }
    const x = stroke.x.toFixed(0);
    const y = stroke.y.toFixed(0);
    if (stroke.shape === 'rect') {
      return t('defect.stroke.rect', {
        kind,
        amp,
        x,
        y,
        x2: (stroke.x2 ?? stroke.x).toFixed(0),
        y2: (stroke.y2 ?? stroke.y).toFixed(0),
      });
    }
    if (stroke.shape === 'line') {
      return t('defect.stroke.line', {
        kind,
        r: stroke.radius.toFixed(1),
        amp,
        x,
        y,
        x2: (stroke.x2 ?? stroke.x).toFixed(0),
        y2: (stroke.y2 ?? stroke.y).toFixed(0),
      });
    }
    return t('defect.stroke.spot', { kind, r: stroke.radius.toFixed(1), amp, x, y });
  }

  private renderStrokeList(): void {
    this.strokeListHost.textContent = '';
    if (this.strokes.length === 0) {
      this.strokeListHost.appendChild(el('div', { class: 'note', text: t('defect.brush.empty') }));
      return;
    }
    for (let i = 0; i < this.strokes.length; i++) {
      const entry = this.strokes[i];
      const item = el('div', { class: 'list-item' });
      const toggle = el('input', { type: 'checkbox', checked: entry.enabled, title: t('defect.brush.enabled') });
      toggle.addEventListener('change', () => {
        entry.enabled = toggle.checked;
        this.renderDirty = true;
        this.scheduleRun();
      });
      item.appendChild(toggle);
      item.appendChild(el('span', { class: 'grow', text: entry.label }));
      item.appendChild(
        button(t('defect.brush.delete'), () => {
          this.strokes.splice(i, 1);
          this.renderDirty = true;
          this.renderStrokeList();
          this.scheduleRun();
        }),
      );
      this.strokeListHost.appendChild(item);
    }
  }

  private gvStrokes(): DefectStroke[] {
    const out: DefectStroke[] = [];
    for (const entry of this.strokes) {
      if (entry.kind === 'gv' && entry.enabled) out.push(entry.stroke as DefectStroke);
    }
    return out;
  }

  private sceneStrokes(): SceneStroke[] {
    const out: SceneStroke[] = [];
    for (const entry of this.strokes) {
      if (entry.kind === 'scene' && entry.enabled) out.push(entry.stroke as SceneStroke);
    }
    return out;
  }

  private async renderDefect(): Promise<DefectRenderResult> {
    const ctx = this.ctx;
    const start = performance.now();
    const result = await ctx.client.request<DefectRenderResult>({
      type: 'defectRender',
      setting: ctx.state.lightSetting,
      channel: this.channel,
      sceneStrokes: this.sceneStrokes(),
      gvStrokes: this.gvStrokes(),
      noise: this.noise,
    });
    ctx.setElapsed(performance.now() - start);
    return result;
  }

  private async showView(): Promise<void> {
    const ctx = this.ctx;
    const image = await ctx.client.request<{ width: number; height: number; data: Uint8Array }>({
      type: 'defectView',
      kind: this.viewKind,
    });
    const size = ctx.viewer.imageSize;
    const needsFit = size.width !== image.width || size.height !== image.height;
    ctx.viewer.showGray(`defect-${this.viewKind}`, image);
    ctx.setCurrentGray(image, t('defect.currentGray', { kind: this.viewKind }));
    if (needsFit) ctx.viewer.fit();
  }

  private async runDetect(): Promise<DefectReport | null> {
    const ctx = this.ctx;
    if (this.renderDirty) {
      this.renderDirty = false;
      try {
        await this.renderDefect();
      } catch (err) {
        this.renderDirty = true;
        throw err;
      }
    }
    const start = performance.now();
    const wasDetectDirty = this.detectDirty;
    this.detectDirty = false;
    let report: DefectReport | null;
    try {
      report = await ctx.client.latest<DefectReport>('detect', {
        type: 'detect',
        params: this.params,
        regionMaterials: this.regionMaterials.length > 0 ? this.regionMaterials : null,
      });
    } catch (err) {
      if (wasDetectDirty) this.detectDirty = true;
      throw err;
    }
    if (report === null) return null;
    this.lastReport = report;
    ctx.setElapsed(performance.now() - start);
    await this.showView();
    this.renderResult();
    ctx.viewer.redraw();
    return report;
  }

  private renderResult(): void {
    this.resultHost.textContent = '';
    const report = this.lastReport;
    if (report === null) {
      this.resultHost.appendChild(el('div', { class: 'note', text: t('defect.result.empty') }));
      return;
    }
    const stats = report.regionStats;
    const satPct = stats.pixels > 0 ? (stats.goldenSaturatedHigh / stats.pixels) * 100 : 0;
    const kv = el('div', { class: 'kv' });
    kv.appendChild(el('span', { class: 'k', text: t('defect.result.detectedCount') }));
    kv.appendChild(el('span', { class: 'v', text: String(report.detectedCount) }));
    kv.appendChild(el('span', { class: 'k', text: t('defect.result.rejectedCount') }));
    kv.appendChild(el('span', { class: 'v', text: String(report.rejectedCount) }));
    kv.appendChild(el('span', { class: 'k', text: t('defect.result.regionGoldenMean') }));
    kv.appendChild(el('span', { class: 'v', text: formatNumber(stats.goldenMean, 1) }));
    kv.appendChild(el('span', { class: 'k', text: t('defect.result.goldenSatPct') }));
    kv.appendChild(el('span', { class: 'v', text: `${formatNumber(satPct, 1)}%` }));
    kv.appendChild(el('span', { class: 'k', text: t('defect.result.testSatHigh') }));
    kv.appendChild(el('span', { class: 'v', text: String(stats.testSaturatedHigh) }));
    this.resultHost.appendChild(kv);
    if (satPct > 5) {
      this.resultHost.appendChild(el('div', { class: 'note warn', text: t('defect.result.satWarn') }));
    }

    const tableNode = table(
      [
        t('defect.col.kind'),
        t('defect.col.area'),
        t('defect.col.peakDelta'),
        t('defect.col.meanDelta'),
        t('defect.col.goldenMean'),
        t('defect.col.threshold'),
        t('defect.col.saturated'),
        t('defect.col.result'),
        t('defect.col.rule'),
      ],
      [],
    );
    const tbody = tableNode.querySelector('tbody');
    if (tbody !== null) {
      const shown = report.blobs.slice(0, MAX_BLOB_ROWS);
      for (const blob of shown) {
        const tr = el('tr', { class: 'selectable' });
        tr.appendChild(el('td', { class: 'text', text: blob.kind === 'bright' ? t('defect.kind.bright') : t('defect.kind.dark') }));
        tr.appendChild(el('td', { text: String(blob.area) }));
        tr.appendChild(el('td', { text: formatNumber(blob.peakDelta, 1) }));
        tr.appendChild(el('td', { text: formatNumber(blob.meanDelta, 1) }));
        tr.appendChild(el('td', { text: formatNumber(blob.goldenMean, 1) }));
        tr.appendChild(el('td', { text: formatNumber(blob.thresholdMean, 1) }));
        tr.appendChild(el('td', { text: String(blob.saturatedPixels) }));
        const resultText = blob.detected
          ? t('defect.result.detected')
          : blob.rejectReason === 'below-size'
            ? t('defect.reject.belowSize')
            : (blob.rejectReason ?? '');
        tr.appendChild(el('td', { class: 'text', text: resultText }));
        tr.appendChild(el('td', { class: 'text', text: blob.rule }));
        tr.addEventListener('click', () => {
          this.centerOn(blob);
        });
        tbody.appendChild(tr);
      }
    }
    this.resultHost.appendChild(el('div', { class: 'table-wrap' }, [tableNode]));
    if (report.blobs.length > MAX_BLOB_ROWS) {
      this.resultHost.appendChild(
        el('div', {
          class: 'note',
          text: t('defect.result.truncated', { shown: MAX_BLOB_ROWS, total: report.blobs.length }),
        }),
      );
    }

    const simSection = el('div');
    simSection.appendChild(el('div', { class: 'note', text: t('defect.result.simulated') }));
    const simList = el('ul', { class: 'reasons' });
    for (const p of report.simulatedParams) simList.appendChild(el('li', { text: p }));
    simSection.appendChild(simList);
    simSection.appendChild(el('div', { class: 'note', text: t('defect.result.unsimulated') }));
    const unList = el('ul', { class: 'reasons' });
    for (const p of report.unsimulatedParams) unList.appendChild(el('li', { text: p }));
    simSection.appendChild(unList);
    this.resultHost.appendChild(simSection);
  }

  private centerOn(blob: DefectBlob): void {
    const ctx = this.ctx;
    const viewer = ctx.viewer;
    const size = viewer.imageSize;
    if (size.width === 0) return;
    viewer.centerOn(blob.centroid[0], blob.centroid[1]);
    viewer.redraw();
  }

  private renderProbe(): void {
    this.probeHost.textContent = '';
    const probe = this.lastProbe;
    if (probe === null) {
      this.probeHost.appendChild(el('div', { class: 'note', text: t('defect.probe.empty') }));
      return;
    }
    if (probe.pixels === 0) {
      this.probeHost.appendChild(el('div', { class: 'note', text: t('defect.probe.empty') }));
      return;
    }
    const lines: string[] = [];
    lines.push(
      t('defect.probe.summary', {
        pixels: probe.pixels,
        mean: formatNumber(probe.goldenMean, 1),
        min: probe.goldenMin,
        max: probe.goldenMax,
        sat: probe.goldenSaturatedHigh,
      }),
    );
    if (!probe.wouldDetectBright) {
      if (probe.maxBright < probe.brightThMin) {
        const brightTh =
          probe.brightThMax - probe.brightThMin > 0.05
            ? `${formatNumber(probe.brightThMin, 1)}–${formatNumber(probe.brightThMax, 1)}`
            : formatNumber(probe.brightThMin, 1);
        lines.push(
          t('defect.probe.brightInsufficient2', {
            max: formatNumber(probe.maxBright, 1),
            th: brightTh,
          }),
        );
      } else {
        lines.push(
          t('defect.probe.brightTooSmall2', {
            largest: probe.largestBright,
            required: probe.requiredBright,
            pixels: probe.brightPixels,
          }),
        );
      }
    } else {
      lines.push(
        t('defect.probe.brightDetect2', {
          largest: probe.largestBright,
          required: probe.requiredBright,
        }),
      );
    }
    if (!probe.wouldDetectDark) {
      if (probe.maxDark < probe.darkThMin) {
        const darkTh =
          probe.darkThMax - probe.darkThMin > 0.05
            ? `${formatNumber(probe.darkThMin, 1)}–${formatNumber(probe.darkThMax, 1)}`
            : formatNumber(probe.darkThMin, 1);
        lines.push(
          t('defect.probe.darkInsufficient2', {
            max: formatNumber(probe.maxDark, 1),
            th: darkTh,
          }),
        );
      } else {
        lines.push(
          t('defect.probe.darkTooSmall2', {
            largest: probe.largestDark,
            required: probe.requiredDark,
            pixels: probe.darkPixels,
          }),
        );
      }
    } else {
      lines.push(
        t('defect.probe.darkDetect2', {
          largest: probe.largestDark,
          required: probe.requiredDark,
        }),
      );
    }
    const brightMargin = 255 - probe.goldenMin;
    if (brightMargin < probe.brightThMin) {
      lines.push(
        t('defect.probe.brightMargin', {
          min: probe.goldenMin,
          margin: brightMargin,
          th: formatNumber(probe.brightThMin, 1),
        }),
      );
    }
    const darkMargin = probe.goldenMax;
    if (darkMargin < probe.darkThMin) {
      lines.push(
        t('defect.probe.darkMargin', {
          max: probe.goldenMax,
          th: formatNumber(probe.darkThMin, 1),
        }),
      );
    }
    for (const line of lines) this.probeHost.appendChild(el('div', { class: 'note', text: line }));
  }

  activate(): void {
    const ctx = this.ctx;
    this.active = true;
    if (this.renderDirty || this.detectDirty) {
      this.runDetect().catch((err: unknown) => {
        ctx.setHint(t('common.error', { msg: (err as Error).message }));
      });
    } else {
      this.showView().catch((err: unknown) => {
        ctx.setHint(t('common.error', { msg: (err as Error).message }));
      });
    }
    ctx.viewer.setOverlay((c, view) => {
      if (this.lastReport !== null) {
        const dpr = window.devicePixelRatio || 1;
        const vw = c.canvas.width / dpr;
        const vh = c.canvas.height / dpr;
        c.beginPath();
        let hasDetected = false;
        for (const blob of this.lastReport.blobs) {
          if (!blob.detected) continue;
          let [x0, y0] = view.toScreen(blob.bbox.x, blob.bbox.y);
          let [x1, y1] = view.toScreen(blob.bbox.x + blob.bbox.w, blob.bbox.y + blob.bbox.h);
          if (x1 < 0 || y1 < 0 || x0 > vw || y0 > vh) continue;
          if (x1 - x0 < 3 || y1 - y0 < 3) {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            x0 = cx - 1.5;
            y0 = cy - 1.5;
            x1 = cx + 1.5;
            y1 = cy + 1.5;
          }
          c.rect(x0, y0, x1 - x0, y1 - y0);
          hasDetected = true;
        }
        if (hasDetected) {
          c.strokeStyle = OVERLAY.ok;
          c.lineWidth = 2;
          c.stroke();
        }
        c.beginPath();
        let hasRejected = false;
        const labels: Array<[number, number, number]> = [];
        for (const blob of this.lastReport.blobs) {
          if (blob.detected) continue;
          let [x0, y0] = view.toScreen(blob.bbox.x, blob.bbox.y);
          let [x1, y1] = view.toScreen(blob.bbox.x + blob.bbox.w, blob.bbox.y + blob.bbox.h);
          if (x1 < 0 || y1 < 0 || x0 > vw || y0 > vh) continue;
          if (x1 - x0 < 3 || y1 - y0 < 3) {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            x0 = cx - 1.5;
            y0 = cy - 1.5;
            x1 = cx + 1.5;
            y1 = cy + 1.5;
          }
          c.rect(x0, y0, x1 - x0, y1 - y0);
          hasRejected = true;
          if (x1 - x0 >= 24 && labels.length < MAX_OVERLAY_LABELS) {
            labels.push([x0, y0, blob.area]);
          }
        }
        if (hasRejected) {
          c.strokeStyle = OVERLAY.warn;
          c.lineWidth = 1;
          c.stroke();
        }
        if (labels.length > 0) {
          c.fillStyle = OVERLAY.warn;
          c.font = OVERLAY.font;
          for (const [lx, ly, area] of labels) {
            c.fillText(`${t('defect.col.area')} ${area}`, lx + 2, ly - 2);
          }
        }
      }
      for (const entry of this.strokes) {
        const stroke = entry.stroke;
        c.strokeStyle = entry.enabled ? OVERLAY.roi : OVERLAY.muted;
        c.lineWidth = 1;
        if (!entry.enabled) c.setLineDash([4, 4]);
        if (stroke.shape === 'spot') {
          const [cx, cy] = view.toScreen(stroke.x, stroke.y);
          const [ex, ey] = view.toScreen(stroke.x + stroke.radius, stroke.y);
          const r = Math.hypot(ex - cx, ey - cy);
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
        } else if (stroke.shape === 'rect') {
          const x2 = stroke.x2 ?? stroke.x;
          const y2 = stroke.y2 ?? stroke.y;
          const [x0, y0] = view.toScreen(Math.min(stroke.x, x2), Math.min(stroke.y, y2));
          const [x1, y1] = view.toScreen(Math.max(stroke.x, x2), Math.max(stroke.y, y2));
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else {
          const x2 = stroke.x2 ?? stroke.x;
          const y2 = stroke.y2 ?? stroke.y;
          const [x0, y0] = view.toScreen(stroke.x, stroke.y);
          const [x1, y1] = view.toScreen(x2, y2);
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
        }
        if (!entry.enabled) c.setLineDash([]);
      }
      if (this.probeRect !== null) {
        const [x0, y0] = view.toScreen(this.probeRect.x, this.probeRect.y);
        const [x1, y1] = view.toScreen(this.probeRect.x + this.probeRect.w, this.probeRect.y + this.probeRect.h);
        c.strokeStyle = OVERLAY.probe;
        c.setLineDash([6, 4]);
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        c.setLineDash([]);
      }
      if (this.dragging) {
        const [x0, y0] = view.toScreen(
          Math.min(this.dragStart[0], this.dragCurrent[0]),
          Math.min(this.dragStart[1], this.dragCurrent[1]),
        );
        const [x1, y1] = view.toScreen(
          Math.max(this.dragStart[0], this.dragCurrent[0]),
          Math.max(this.dragStart[1], this.dragCurrent[1]),
        );
        c.strokeStyle = OVERLAY.roi;
        c.setLineDash([6, 4]);
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        c.setLineDash([]);
      }
    });
    ctx.viewer.onPointer((p) => this.handlePointer(p));
  }

  private handlePointer(p: { type: 'down' | 'move' | 'up'; x: number; y: number; button: number }): boolean {
    if (this.tool === 'none') return false;
    if (p.type === 'down' && p.button === 0) {
      this.dragging = true;
      this.dragStart = [p.x, p.y];
      this.dragCurrent = [p.x, p.y];
      return true;
    }
    if (p.type === 'move' && this.dragging) {
      this.dragCurrent = [p.x, p.y];
      this.ctx.viewer.redraw();
      return true;
    }
    if (p.type === 'up' && this.dragging) {
      this.dragging = false;
      const x = Math.min(this.dragStart[0], this.dragCurrent[0]);
      const y = Math.min(this.dragStart[1], this.dragCurrent[1]);
      const w = Math.abs(this.dragCurrent[0] - this.dragStart[0]);
      const h = Math.abs(this.dragCurrent[1] - this.dragStart[1]);
      const dragDist = Math.hypot(this.dragCurrent[0] - this.dragStart[0], this.dragCurrent[1] - this.dragStart[1]);
      if (this.tool === 'probe') {
        if (w >= 2 && h >= 2) {
          this.probeRect = { x, y, w, h };
          this.runProbe(this.probeRect).catch((err: unknown) => {
            this.ctx.setHint(t('common.error', { msg: (err as Error).message }));
          });
        }
      } else if (this.tool === 'brightRect' || this.tool === 'darkRect') {
        if (w >= 2 && h >= 2) {
          this.placeRect(this.dragStart[0], this.dragStart[1], this.dragCurrent[0], this.dragCurrent[1]);
        }
      } else if (this.tool === 'brightSpot' || this.tool === 'darkSpot' || this.tool === 'foreign' || this.tool === 'contamination') {
        const radius = dragDist >= 2 ? dragDist : this.radius;
        this.placeSpot(this.dragStart[0], this.dragStart[1], radius);
      } else if (this.tool === 'brightLine' || this.tool === 'darkLine') {
        if (w >= 2 || h >= 2) {
          this.placeLine(this.dragStart[0], this.dragStart[1], this.dragCurrent[0], this.dragCurrent[1]);
        }
      }
      this.clearTool();
      return true;
    }
    return false;
  }

  private gvAmplitudeFields(kind: 'bright' | 'dark'): {
    amplitude: DefectAmplitude;
    deltaGv: number;
    relativePct?: number;
    targetGv?: number;
  } {
    if (this.amplitude === 'relative') {
      return { amplitude: 'relative', relativePct: this.relativePct, deltaGv: 0 };
    }
    if (this.amplitude === 'target') {
      return {
        amplitude: 'target',
        targetGv: kind === 'bright' ? this.targetBright : this.targetDark,
        deltaGv: 0,
      };
    }
    return { amplitude: 'absolute', deltaGv: this.deltaGv };
  }

  private placeSpot(x: number, y: number, radius: number): void {
    if (this.tool === 'foreign') {
      const stroke: SceneStroke = {
        mode: 'material',
        shape: 'spot',
        x,
        y,
        radius,
        material: this.foreignMaterial,
      };
      this.strokes.push({
        stroke,
        kind: 'scene',
        label: t('defect.stroke.foreign', { material: this.foreignMaterial, x: x.toFixed(0), y: y.toFixed(0) }),
        enabled: true,
      });
    } else if (this.tool === 'contamination') {
      const stroke: SceneStroke = {
        mode: 'texture',
        shape: 'spot',
        x,
        y,
        radius,
        factor: this.contaminationFactor,
      };
      this.strokes.push({
        stroke,
        kind: 'scene',
        label: t('defect.stroke.contamination', { factor: this.contaminationFactor, x: x.toFixed(0), y: y.toFixed(0) }),
        enabled: true,
      });
    } else {
      const kind = this.tool === 'brightSpot' ? 'bright' : 'dark';
      const stroke: DefectStroke = {
        kind,
        shape: 'spot',
        x,
        y,
        radius,
        softness: this.softness,
        profile: this.profile,
        grain: this.grain,
        seed: this.strokeSeed++,
        ...this.gvAmplitudeFields(kind),
      };
      this.strokes.push({
        stroke,
        kind: 'gv',
        label: this.strokeLabel(stroke),
        enabled: true,
      });
    }
    this.renderDirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private placeLine(x: number, y: number, x2: number, y2: number): void {
    const kind = this.tool === 'brightLine' ? 'bright' : 'dark';
    const stroke: DefectStroke = {
      kind,
      shape: 'line',
      x,
      y,
      x2,
      y2,
      radius: this.radius,
      softness: this.softness,
      profile: this.profile,
      grain: this.grain,
      seed: this.strokeSeed++,
      ...this.gvAmplitudeFields(kind),
    };
    this.strokes.push({
      stroke,
      kind: 'gv',
      label: this.strokeLabel(stroke),
      enabled: true,
    });
    this.renderDirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private placeRect(x: number, y: number, x2: number, y2: number): void {
    const kind = this.tool === 'brightRect' ? 'bright' : 'dark';
    const stroke: DefectStroke = {
      kind,
      shape: 'rect',
      x,
      y,
      x2,
      y2,
      radius: 0,
      softness: this.softness,
      profile: this.profile,
      grain: this.grain,
      seed: this.strokeSeed++,
      ...this.gvAmplitudeFields(kind),
    };
    this.strokes.push({
      stroke,
      kind: 'gv',
      label: this.strokeLabel(stroke),
      enabled: true,
    });
    this.renderDirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private async runProbe(rect: Rect): Promise<void> {
    const ctx = this.ctx;
    const result = await ctx.client.request<ProbeResult>({
      type: 'probe',
      rect,
      params: this.params,
      regionMaterials: this.regionMaterials.length > 0 ? this.regionMaterials : null,
    });
    this.lastProbe = result;
    this.renderProbe();
    ctx.viewer.redraw();
  }

  deactivate(): void {
    this.active = false;
    this.ctx.viewer.onPointer(null);
    this.ctx.viewer.setOverlay(null);
  }

  themeChanged(): void {
    this.ctx.viewer.redraw();
  }

  refresh(): void {
    this.renderDirty = true;
    if (this.active) this.scheduleRun();
  }

  reset(): void {
    this.strokes = [];
    this.strokeSeed = 1;
    this.lastReport = null;
    this.lastProbe = null;
    this.probeRect = null;
    this.renderDirty = true;
    this.detectDirty = true;
    this.renderStrokeList();
    this.renderResult();
    this.renderProbe();
    this.ctx.viewer.redraw();
  }

  private findSrPoint(): [number, number] {
    const state = this.ctx.state;
    const material = state.material;
    const width = state.width;
    const height = state.height;
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    if (material === null || width === 0 || height === 0) return [cx, cy];
    const isSr = (x: number, y: number): boolean => {
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (material[(y + dy) * width + (x + dx)] !== 1) return false;
        }
      }
      return true;
    };
    if (isSr(cx, cy)) return [cx, cy];
    const maxRing = Math.max(width, height);
    for (let r = 8; r <= maxRing; r += 8) {
      for (let d = -r; d <= r; d += 8) {
        const candidates: Array<[number, number]> = [
          [cx + d, cy - r],
          [cx + d, cy + r],
          [cx - r, cy + d],
          [cx + r, cy + d],
        ];
        for (const [x, y] of candidates) {
          if (isSr(x, y)) return [x, y];
        }
      }
    }
    return [cx, cy];
  }

  async runFull(): Promise<unknown> {
    if (this.strokes.length === 0) {
      const [cx, cy] = this.findSrPoint();
      const stroke: DefectStroke = {
        kind: 'bright',
        shape: 'spot',
        x: cx,
        y: cy,
        radius: 6,
        deltaGv: 60,
        softness: 0.3,
        amplitude: 'absolute',
        profile: 'linear',
        grain: 0,
        seed: 1,
      };
      this.strokes.push({
        stroke,
        kind: 'gv',
        label: this.strokeLabel(stroke),
        enabled: true,
      });
      this.renderDirty = true;
      this.renderStrokeList();
    }
    return this.runDetect();
  }

  getLeft(): HTMLElement {
    return this.left;
  }

  getRight(): HTMLElement {
    return this.right;
  }
}
