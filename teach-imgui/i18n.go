package main

import (
	"fmt"
	"strings"
)

// Lang is a UI language code.
type Lang string

const (
	LangZh Lang = "zh"
	LangEn Lang = "en"
	LangKo Lang = "ko"
)

// Langs lists the selectable languages in display order; labels stay in their own script.
var Langs = []struct {
	Code  Lang
	Label string
}{
	{LangZh, "中文"},
	{LangEn, "English"},
	{LangKo, "한국어"},
}

var (
	currentLang  = LangZh
	dictionaries = map[Lang]map[string]string{LangZh: {}, LangEn: {}, LangKo: {}}
)

// Messages registers translations; every panel calls it from init() for its own keys.
func Messages(zh, en, ko map[string]string) {
	for lang, dict := range map[Lang]map[string]string{LangZh: zh, LangEn: en, LangKo: ko} {
		for k, v := range dict {
			dictionaries[lang][k] = v
		}
	}
}

// SetLang switches the UI language at runtime; no reload is needed in immediate mode.
func SetLang(l Lang) {
	if _, ok := dictionaries[l]; ok {
		currentLang = l
	}
}

// CurrentLang returns the active UI language.
func CurrentLang() Lang { return currentLang }

// ParseLang maps a flag value to a language, defaulting to Chinese.
func ParseLang(s string) Lang {
	switch Lang(strings.ToLower(s)) {
	case LangEn:
		return LangEn
	case LangKo:
		return LangKo
	}
	return LangZh
}

// T looks up key in the current language (falling back to zh, then the key itself) and
// replaces {name} placeholders from alternating name/value arguments.
func T(key string, args ...any) string {
	s, ok := dictionaries[currentLang][key]
	if !ok {
		s, ok = dictionaries[LangZh][key]
	}
	if !ok {
		s = key
	}
	for i := 0; i+1 < len(args); i += 2 {
		name, _ := args[i].(string)
		var val string
		switch v := args[i+1].(type) {
		case string:
			val = v
		default:
			val = fmt.Sprint(v)
		}
		s = strings.ReplaceAll(s, "{"+name+"}", val)
	}
	return s
}

func init() {
	Messages(map[string]string{
		"app.title":          "AFVI 教学核心",
		"top.model":          "型号",
		"top.theme":          "主题",
		"top.lang":           "语言",
		"theme.dark":         "深色（夜间）",
		"theme.light":        "浅色（经典）",
		"tab.light":          "光照与 GV",
		"tab.align":          "对齐",
		"tab.defect":         "缺陷检出",
		"status.zoom":        "缩放 {pct}%",
		"status.elapsed":     "耗时 {ms} ms",
		"status.elapsedNone": "耗时 —",
		"status.loading":     "加载中…",
		"status.loaded":      "已加载 {w}×{h} · 用时 {ms} ms",
		"status.loadFailed":  "加载失败：{msg}",
		"status.noModels":    "无可用型号",
		"status.busy":        "计算中…",
		"msg.noModels":       "reference 中没有可用型号。\n\n期望的目录结构：\nreference/<FM1|FM2|BM>/PxRepository/<型号>/\n  Metal.tif, SR.tif, Open.tif\n  <版本>/Line/<Top|Bottom>/Layer/MEDIAN/Median_0_1_0.tif",
		"msg.noReference":    "找不到 reference 目录。可设置环境变量 AFVI_REFERENCE_DIR，或用 -ref 指定。",
		"common.error":       "错误：{msg}",
		"common.none":        "—",
		"viewer.hintPan":     "滚轮缩放 · 中键/右键拖动平移 · 双击适应窗口",
	}, map[string]string{
		"app.title":          "AFVI Teaching Core",
		"top.model":          "Model",
		"top.theme":          "Theme",
		"top.lang":           "Language",
		"theme.dark":         "Dark (night)",
		"theme.light":        "Light (classic)",
		"tab.light":          "Light & GV",
		"tab.align":          "Alignment",
		"tab.defect":         "Defect Detection",
		"status.zoom":        "Zoom {pct}%",
		"status.elapsed":     "Elapsed {ms} ms",
		"status.elapsedNone": "Elapsed —",
		"status.loading":     "Loading…",
		"status.loaded":      "Loaded {w}×{h} · {ms} ms",
		"status.loadFailed":  "Load failed: {msg}",
		"status.noModels":    "No models available",
		"status.busy":        "Computing…",
		"msg.noModels":       "No usable models in reference.\n\nExpected directory layout:\nreference/<FM1|FM2|BM>/PxRepository/<model>/\n  Metal.tif, SR.tif, Open.tif\n  <version>/Line/<Top|Bottom>/Layer/MEDIAN/Median_0_1_0.tif",
		"msg.noReference":    "Reference directory not found. Set AFVI_REFERENCE_DIR or pass -ref.",
		"common.error":       "Error: {msg}",
		"common.none":        "—",
		"viewer.hintPan":     "Wheel to zoom · middle/right drag to pan · double-click to fit",
	}, map[string]string{
		"app.title":          "AFVI 교육 코어",
		"top.model":          "모델",
		"top.theme":          "테마",
		"top.lang":           "언어",
		"theme.dark":         "다크(야간)",
		"theme.light":        "라이트(클래식)",
		"tab.light":          "조명 및 GV",
		"tab.align":          "정렬",
		"tab.defect":         "결함 검출",
		"status.zoom":        "확대 {pct}%",
		"status.elapsed":     "소요 {ms} ms",
		"status.elapsedNone": "소요 —",
		"status.loading":     "로딩 중…",
		"status.loaded":      "로드됨 {w}×{h} · {ms} ms",
		"status.loadFailed":  "로드 실패: {msg}",
		"status.noModels":    "사용 가능한 모델 없음",
		"status.busy":        "계산 중…",
		"msg.noModels":       "reference 에 사용 가능한 모델이 없습니다.\n\n기대 디렉터리 구조:\nreference/<FM1|FM2|BM>/PxRepository/<모델>/\n  Metal.tif, SR.tif, Open.tif\n  <버전>/Line/<Top|Bottom>/Layer/MEDIAN/Median_0_1_0.tif",
		"msg.noReference":    "reference 디렉터리를 찾을 수 없습니다. AFVI_REFERENCE_DIR 을 설정하거나 -ref 로 지정하세요.",
		"common.error":       "오류: {msg}",
		"common.none":        "—",
		"viewer.hintPan":     "휠로 확대 · 가운데/오른쪽 드래그로 이동 · 더블클릭으로 화면 맞춤",
	})
}
