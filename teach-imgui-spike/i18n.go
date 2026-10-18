package main

var langs = []struct{ Code, Label string }{
	{"zh", "中文"},
	{"en", "English"},
	{"ko", "한국어"},
}

var messages = map[string]map[string]string{
	"zh": {
		"title": "AFVI 教学 · ImGui 原型", "lang": "语言", "theme": "主题", "dark": "深色", "light": "浅色",
		"sec.light": "光源 (Red)", "enable": "启用", "value": "光量", "gain": "增益", "offset": "偏移", "texture": "纹理强度",
		"sec.refl": "反射率 (Red)", "sec.overlay": "叠加层", "overlayOn": "显示 10000 个 ROI 框", "fit": "适应窗口",
		"sec.hist": "GV 直方图", "sec.table": "连通域列表 (10000 行)", "loading": "正在加载 reference…",
		"col.id": "编号", "col.kind": "类型", "col.area": "面积", "col.peak": "峰值Δ", "col.mean": "均值Δ", "col.bg": "背景 GV",
		"bright": "亮", "darkKind": "暗", "rendering": "渲染中…", "sample": "示例：亮点检出 · 被拒 · 面积不足",
	},
	"en": {
		"title": "AFVI Teach · ImGui spike", "lang": "Language", "theme": "Theme", "dark": "Dark", "light": "Light",
		"sec.light": "Light (Red)", "enable": "Enable", "value": "Value", "gain": "Gain", "offset": "Offset", "texture": "Texture",
		"sec.refl": "Reflectance (Red)", "sec.overlay": "Overlay", "overlayOn": "Show 10000 ROI boxes", "fit": "Fit view",
		"sec.hist": "GV histogram", "sec.table": "Blob list (10000 rows)", "loading": "Loading reference…",
		"col.id": "ID", "col.kind": "Type", "col.area": "Area", "col.peak": "Peak Δ", "col.mean": "Mean Δ", "col.bg": "Bg GV",
		"bright": "Bright", "darkKind": "Dark", "rendering": "Rendering…", "sample": "Sample: bright defect detected · rejected · below size",
	},
	"ko": {
		"title": "AFVI 교육 · ImGui 프로토타입", "lang": "언어", "theme": "테마", "dark": "다크", "light": "라이트",
		"sec.light": "광원 (Red)", "enable": "사용", "value": "광량", "gain": "게인", "offset": "오프셋", "texture": "텍스처 강도",
		"sec.refl": "반사율 (Red)", "sec.overlay": "오버레이", "overlayOn": "ROI 박스 10000개 표시", "fit": "화면 맞춤",
		"sec.hist": "GV 히스토그램", "sec.table": "블롭 목록 (10000행)", "loading": "reference 로딩 중…",
		"col.id": "번호", "col.kind": "유형", "col.area": "면적", "col.peak": "피크Δ", "col.mean": "평균Δ", "col.bg": "배경 GV",
		"bright": "밝음", "darkKind": "어두움", "rendering": "렌더링 중…", "sample": "예시: 밝은 결함 검출 · 거부 · 면적 부족",
	},
}

func (a *app) t(key string) string {
	if v, ok := messages[a.lang][key]; ok {
		return v
	}
	if v, ok := messages["zh"][key]; ok {
		return v
	}
	return key
}
