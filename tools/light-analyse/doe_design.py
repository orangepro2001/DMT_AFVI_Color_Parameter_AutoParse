#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LightAnalyse 阶段一 —— 量程标定档位 + Box-Behnken/退化设计 运行单生成器（Excel 载体）

核心规则（Plan/01 §2，2026-09-23 修订）:
  - 档位按「颜色×角度」9 轴独立配置，缺省 [0, 1024]
  - 三档强制等距整数: low, mid=low+(high-low)//2, high=low+2*half
  - 退化轴可禁用（levels.json 中该轴 = null 或 {"fixed": N}）:
      k=3 活跃轴 → BBD 15 点
      k=2        → 3² 全因子 9 点 + 3 中心 = 12 点
      k=1        → 6 点 [-1,-1,0,0,+1,+1]
      k=0        → 1 点（常数记录）
    禁用轴固定在指定值（默认 0 = 该路光不用），不参与拟合与调光。
  - 运行序: 共享 mulberry32 PRNG + Fisher-Yates（与 light-sampling-guide.html
    逐位一致，跨语言可复现，任意禁用配置都同源）

用法:
  python doe_design.py                          # 全部默认档位 [0,1024]
  python doe_design.py --levels out/levels.json # 量程标定后重新生成

levels.json 格式（可只写部分轴；值支持 [low,high] / [low,mid,high] / null=禁用(固定0) / {"fixed":N}=禁用(固定N)）:
  {"Red": {"0deg": [0, 15], "30deg": null, "60deg": {"fixed": 30}}, ...}
"""

import argparse
import json
import math
import os
from datetime import datetime

try:
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    raise SystemExit("需要 openpyxl: pip install openpyxl")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "out")

DEFAULT_SEED = 20260923
DEFAULT_SAT = 250
DEFAULT_WINDOW = (60, 200)
ANGLES = ("0deg", "30deg", "60deg")
COLORS = ("Red", "Green", "Blue")

# 3 因子 Box-Behnken 15 点（12 边中点 + 3 中心）
BBD_CODED = [
    (-1, -1, 0), (+1, -1, 0), (-1, +1, 0), (+1, +1, 0),
    (-1, 0, -1), (+1, 0, -1), (-1, 0, +1), (+1, 0, +1),
    (0, -1, -1), (0, +1, -1), (0, -1, +1), (0, +1, +1),
    (0, 0, 0), (0, 0, 0), (0, 0, 0),
]
# 验证点：分数位置 f（实数 = round(low + f*(high-low))，只作用在活跃轴上）
VERIFY_FRACTIONS = [(0.25, 0.25, 0.25), (0.75, 0.25, 0.50), (0.25, 0.75, 0.75), (1.00, 1.00, 0.25)]


# ---------------- 共享 PRNG（与向导 JS 逐位一致；勿改，改则两载体失联） ----------------
def mulberry32(seed):
    """mulberry32 的 32 位无符号模运算实现，与 JS Math.imul 版逐位一致"""
    st = seed & 0xFFFFFFFF
    def rnd():
        nonlocal st
        st = (st + 0x6D2B79F5) & 0xFFFFFFFF
        t = (((st ^ (st >> 15)) * ((st | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF)
        t = (((t + (((t ^ (t >> 7)) * ((61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t)
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


def shuffled(seq, rnd):
    """Fisher-Yates（降序，floor(rnd*(i+1))）—— 与 JS 实现逐位一致"""
    out = list(seq)
    for i in range(len(out) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


# ---------------- 档位/禁用配置 ----------------
def make_levels(low, high, axis=""):
    low, high = int(low), int(high)
    if not (0 <= low < high <= 1024):
        raise ValueError(f"{axis}: 档位区间非法 [{low}, {high}] (需 0 <= low < high <= 1024)")
    if high - low < 2:
        raise ValueError(f"{axis}: 窗口跨度 <2，无法取三档。请禁用该轴或调整曝光/增益（Plan/01 §2.5）")
    half = (high - low) // 2
    return [low, low + half, low + 2 * half]


def normalize_levels(user_levels):
    """用户输入 → 9 轴完整配置 {color: {angle: {"levels":[lo,mid,hi]} | {"disabled":True,"fixed":N}}}"""
    out = {}
    for color in COLORS:
        out[color] = {}
        for angle in ANGLES:
            axis = f"{color}_{angle}"
            raw = ((user_levels or {}).get(color) or {}).get(angle, [0, 1024])
            if raw is None:
                out[color][angle] = {"disabled": True, "fixed": 0}
            elif isinstance(raw, dict) and (raw.get("disabled") or "fixed" in raw):
                out[color][angle] = {"disabled": True, "fixed": int(raw.get("fixed", 0))}
            else:
                if isinstance(raw, dict):
                    low, high = raw["low"], raw["high"]
                elif len(raw) == 2:
                    low, high = raw
                elif len(raw) == 3:
                    low, mid, high = raw
                    if abs(mid - (low + high) / 2) > 1e-9:
                        raise ValueError(f"{axis}: 中档 {mid} 不是算术中点 (low={low}, high={high})。"
                                         f"等距是编码变换的前提（Plan/01 §2.4），请只给 [low, high]")
                else:
                    raise ValueError(f"{axis}: 档位格式应为 [low, high] / [low,mid,high] / null / {{\"fixed\":N}}，得到 {raw}")
                out[color][angle] = {"levels": make_levels(low, high, axis)}
    return out


def load_levels_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return normalize_levels(json.load(f))


def axis_active(cfg):
    return "levels" in cfg


def color_active_axes(levels, color):
    return [i for i, a in enumerate(ANGLES) if axis_active(levels[color][a])]


# ---------------- 设计模式 ----------------
def design_patterns(k):
    """返回活跃轴上的编码运行列表（未洗牌）。"""
    if k == 3:
        return list(BBD_CODED)
    if k == 2:
        combos = [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1)]     # 3² 全因子
        centers = [(0, 0)] * 3
        return [tuple(p) for p in combos + centers]
    if k == 1:
        return [(-1,), (-1,), (0,), (0,), (1,), (1,)]
    return [(0,)]                                                     # k=0: 常数记录


def color_verify_count(k):
    return 0 if k == 0 else 4


def build_runs(levels, seed=DEFAULT_SEED):
    """全部运行行。design 行洗牌（跨色连续消耗同一 rnd）；verify 行按色追加在色尾。"""
    rnd = mulberry32(seed)
    rows = []
    order = 1
    v_counter = 0
    for color in COLORS:
        act = color_active_axes(levels, color)
        k = len(act)
        fixed_map = {i: levels[color][ANGLES[i]]["fixed"] for i in range(3) if not axis_active(levels[color][ANGLES[i]])}
        patterns = shuffled(design_patterns(k), rnd)
        for point, pat in enumerate(patterns, 1):
            coded_full = [None, None, None]
            for j, ai in enumerate(act):
                coded_full[ai] = pat[j]
            real = [levels[color][ANGLES[i]]["fixed"] if i in fixed_map
                    else round(levels[color][ANGLES[i]]["levels"][1] + coded_full[i] * (levels[color][ANGLES[i]]["levels"][2] - levels[color][ANGLES[i]]["levels"][1]))
                    for i in range(3)]
            rows.append({
                "run_order": order, "color": color, "point_id": point,
                "type": "center" if all(p == 0 for p in pat) else "edge",
                "coded": tuple(coded_full), "real": real, "active": act, "fixed": dict(fixed_map),
            })
            order += 1
        for vf in range(color_verify_count(k)):
            frac = VERIFY_FRACTIONS[vf]
            real = []
            coded_actual = []
            for i in range(3):
                if i in fixed_map:
                    real.append(fixed_map[i]); coded_actual.append(None)
                else:
                    lv = levels[color][ANGLES[i]]["levels"]
                    # floor(x+0.5) 四舍五入——Python round 是银行家舍入，与 JS 不一致，禁用
                    v = int(math.floor(lv[0] + frac[act.index(i)] * (lv[2] - lv[0]) + 0.5))
                    real.append(v)
                    coded_actual.append(round((v - lv[1]) / (lv[2] - lv[1]), 3))
            v_counter += 1
            rows.append({
                "run_order": f"V{v_counter}", "color": color, "point_id": f"V{vf + 1}",
                "type": "verify", "coded": tuple(coded_actual), "real": real,
                "active": act, "fixed": dict(fixed_map),
            })
            order += 1
    return rows


# ---------------------------------------------------------------- Excel
HEADER = ["run_order", "color", "point_id", "type",
          "x1_c", "x2_c", "x3_c", "L_0deg", "L_30deg", "L_60deg",
          "GV_1", "GV_2", "GV_3", "GV_median", "note"]
THIN = Border(left=Side(style="thin"), right=Side(style="thin"),
              top=Side(style="thin"), bottom=Side(style="thin"))


def style_header(ws):
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
        cell.border = THIN
        cell.alignment = Alignment(horizontal="center")
    ws.freeze_panes = "A2"


def write_data_sheet(ws, rows):
    ws.append(HEADER)
    style_header(ws)
    fill_auto = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")
    fill_manual = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    for i, r in enumerate(rows, 2):
        coded_cells = [("" if c is None else (c if isinstance(c, int) else round(c, 3))) for c in r["coded"]]
        ws.append([r["run_order"], r["color"], r["point_id"], r["type"],
                   *coded_cells, *r["real"], "", "", "",
                   f"=MEDIAN(K{i}:M{i})", ""])
        for col in range(1, 16):
            cell = ws.cell(row=i, column=col)
            cell.border = THIN
            cell.fill = fill_manual if col in (11, 12, 13) else fill_auto
            if col in (8, 9, 10):
                cell.font = Font(bold=True)
    for col in range(1, 15):
        ws.column_dimensions[get_column_letter(col)].width = 11
    ws.column_dimensions["O"].width = 28


def write_guide_sheet(ws, levels, sat, window):
    ws.column_dimensions["A"].width = 110
    n_design = sum(len(design_patterns(len(color_active_axes(levels, c)))) for c in COLORS)
    lines = [
        ("LightAnalyse 采样运行单（Excel 载体）", True),
        ("", False),
        (f"设计点 {n_design} + 验证点 12（禁用轴不参与；禁用轴的光保持关闭或固定值）。", False),
        ("推荐使用 light-sampling-guide.html 向导执行（自动算中位数、防饱和、可断点续采）；", False),
        ("本表为纸面备份 / 离线录入载体，两者运行序同源一致。", False),
        ("", False),
        ("每个点的操作：", True),
        ("1. 把光源颜色设为该行 color；活跃角度分别设为 L_0deg / L_30deg / L_60deg 列的值（加粗列）。", False),
        ("2. 标记为「禁用」的角度：该路光保持关闭（或其固定值），全程不动。", False),
        ("3. 等待 >=1s 稳定，读 GV 三次，填入黄色列 K/L/M；中位数 N 列自动计算。", False),
        ("4. 若中位数 >= %d（饱和阈值）或恒为 255：停止该颜色，回向导重新标定，整色重测。" % sat, False),
        ("5. 每完成 5 个设计点，回中心点（活跃轴取各自 mid 档）复测一次，记录在 note。", False),
        ("6. 三次读数极差 > 5：在 note 里标记。note 含「作废」的行将被拟合脚本剔除。", False),
        ("", False),
        ("当前档位表（low, mid, high / 禁用）——数据必须与档位一起记录：", True),
    ]
    for text, bold in lines:
        ws.append([text])
        cell = ws.cell(row=ws.max_row, column=1)
        cell.font = Font(bold=bold, size=13 if bold and text.startswith("LightAnalyse") else 11)
    for color in COLORS:
        for angle in ANGLES:
            cfg = levels[color][angle]
            if axis_active(cfg):
                low, mid, high = cfg["levels"]
                tag = "" if (low, mid, high) == (0, 512, 1024) else "  <- 标定量程"
                ws.append([f"levels_{color}_{angle} = {low}, {mid}, {high}{tag}"])
            else:
                ws.append([f"levels_{color}_{angle} = 禁用 (固定 {cfg['fixed']})"])
    ws.append([f"saturation_threshold = {sat}"])
    ws.append([f"gv_window = {window[0]}, {window[1]}"])


def write_meta_sheet(ws, machine, model, levels, sat, window):
    rows = [
        ["Key", "Value", "说明"],
        ["machine_id", machine, "设备编号 FM1/FM2/BM"],
        ["model_name", model, "产品型号"],
        ["saturation_threshold", sat, "饱和判定阈值（GV）"],
        ["gv_window", f"{window[0]}, {window[1]}", "标定用目标窗口 low, high"],
        ["measured_by", "", "采集人"],
        ["measured_at", datetime.now().strftime("%Y-%m-%d"), "采集日期"],
        ["exposure_ms", "", "曝光时间（如调整过必须记录）"],
        ["notes", "", "环境、镜头、温度等"],
    ]
    for color in COLORS:
        for angle in ANGLES:
            cfg = levels[color][angle]
            if axis_active(cfg):
                low, mid, high = cfg["levels"]
                rows.append([f"levels_{color}_{angle}", f"{low}, {mid}, {high}",
                             "档位 [low, mid, high]，mid 为算术中点"])
            else:
                rows.append([f"levels_{color}_{angle}", f"disabled,fixed={cfg['fixed']}",
                             "禁用轴：不参与设计/拟合/调光，光保持固定值"])
    for r in rows:
        ws.append(r)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 46


def generate_excel(out_path, levels, machine, model, seed=DEFAULT_SEED,
                   sat=DEFAULT_SAT, window=DEFAULT_WINDOW):
    wb = openpyxl.Workbook()
    write_guide_sheet(wb.active, levels, sat, window)
    wb.active.title = "guide"
    all_runs = build_runs(levels, seed)
    design = [r for r in all_runs if r["type"] != "verify"]
    verify = [r for r in all_runs if r["type"] == "verify"]
    write_data_sheet(wb.create_sheet("design"), design)
    write_data_sheet(wb.create_sheet("verify"), verify)
    write_meta_sheet(wb.create_sheet("meta"), machine, model, levels, sat, window)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)
    return design, verify


def print_table(design, verify, levels):
    print(f"{'run':>4} {'color':6} {'pt':>3} {'type':6} {'c(0,30,60)':20} {'L(0,30,60)':20}")
    for r in design:
        print(f"{r['run_order']:>4} {r['color']:6} {r['point_id']:>3} {r['type']:6} "
              f"{str(r['coded']):20} {str(r['real']):20}")
    for r in verify:
        print(f"{r['run_order']:>4} {r['color']:6} {r['point_id']:>3} {'verify':6} "
              f"{str(r['coded']):20} {str(r['real']):20}")
    print("\n档位表 (low, mid, high / 禁用):")
    for color in COLORS:
        for angle in ANGLES:
            cfg = levels[color][angle]
            if axis_active(cfg):
                tag = "" if cfg["levels"] == [0, 512, 1024] else "  <- calibrated"
                print(f"  {color}_{angle:6} = {cfg['levels']}{tag}")
            else:
                print(f"  {color}_{angle:6} = 禁用 (固定 {cfg['fixed']})")


def main():
    p = argparse.ArgumentParser(description="LightAnalyse BBD/退化设计 运行单生成器（Excel 载体）")
    p.add_argument("--levels", help="档位 JSON（9 轴，可只写部分；null=禁用该轴）")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED,
                   help="运行序随机种子（默认 20260923，与向导同源）")
    p.add_argument("--out", default=os.path.join(OUT_DIR, "samples.xlsx"))
    p.add_argument("--machine", default="FM1")
    p.add_argument("--model", default="6ST2001Q01")
    p.add_argument("--sat-threshold", type=float, default=DEFAULT_SAT)
    p.add_argument("--gv-window", default=f"{DEFAULT_WINDOW[0]},{DEFAULT_WINDOW[1]}")
    args = p.parse_args()

    levels = load_levels_json(args.levels) if args.levels else normalize_levels(None)
    window = tuple(int(x) for x in args.gv_window.split(","))
    design, verify = generate_excel(args.out, levels, args.machine, args.model,
                                    args.seed, args.sat_threshold, window)
    print(f"Excel generated: {args.out}  (seed={args.seed})")
    print(f"design {len(design)} rows, verify {len(verify)} rows\n")
    print_table(design, verify, levels)
    if args.levels is None:
        print("\n[提示] 当前全部为默认档位 [0,1024]。现场量程标定后请用 --levels 重新生成，")
        print("       否则饱和轴将产出全 255 的零信息数据（Plan/01 §2.1）。")


if __name__ == "__main__":
    main()
