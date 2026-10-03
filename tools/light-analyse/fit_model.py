#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LightAnalyse 阶段二 —— 三波长(红/绿/蓝) 响应面自动拟合脚本（动态定项版）

输入（二选一，也支持 --demo 自检）:
  1) HTML 采样向导导出的 CSV:  light_analyse_data_YYYY-MM-DD.csv（带 # 档位头部）
  2) doe_design.py 生成并回填好的 Excel:  samples.xlsx (design/verify/meta sheets)

输出:
  out/light-models.json   每色一个模型: 活跃轴二次响应面系数(编码空间 + 展开到实际值)
  out/fit_report.md       拟合质量报告(档位/指标/公式/验证点/诊断)

模型（动态定项，Plan/02 §1 / §1.1）:
  - 活跃轴 = 3 → 10 项; 某轴被禁用（采样时恒定）→ 其各项从模型中移除
    k=3: 10 项; k=2: 6 项; k=1: 3 项; k=0: 仅常数
  - 禁用轴的值是模型的运行假设: 预测仅在禁用轴保持其固定值时有效（报告/UI 中注明）
  - 编码: u_i = (L_i - center_i) / half_i, center/half 从设计点实数列反推（数据为唯一事实源）

剔除规则: note 列包含 作废 / invalid / discard / 弃用 的行不参与拟合(会打印原因)
"""

import argparse
import csv
import json
import math
import os
import random
import shutil
import sys
from datetime import datetime, timezone

try:
    import numpy as _np
except ImportError:
    _np = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "out")

BBD_CODED = [
    (-1, -1, 0), (+1, -1, 0), (-1, +1, 0), (+1, +1, 0),
    (-1, 0, -1), (+1, 0, -1), (-1, 0, +1), (+1, 0, +1),
    (0, -1, -1), (0, +1, -1), (0, -1, +1), (0, +1, +1),
    (0, 0, 0), (0, 0, 0), (0, 0, 0),
]
VERIFY_FRACTIONS = [(0.25, 0.25, 0.25), (0.75, 0.25, 0.50), (0.25, 0.75, 0.75), (1.00, 1.00, 0.25)]
ANGLES = ("0deg", "30deg", "60deg")
COLORS = ["Red", "Green", "Blue"]
EXCLUDE_TOKENS = ["作废", "invalid", "discard", "弃用"]
TERMS = ["b0", "b1", "b2", "b3", "b11", "b22", "b33", "b12", "b13", "b23"]


# ---------------------------------------------------------------- 行数据结构
def make_row(run_order, color, point_id, rtype, coded, real, gv=("", "", ""), note=""):
    def _num(x):
        return None if x is None or str(x).strip() == "" else float(x)
    return {
        "run_order": run_order,
        "color": color,
        "point_id": point_id,
        "type": rtype,
        "coded": tuple(_num(c) for c in coded),   # 禁用轴 = None
        "real": tuple(float(v) for v in real),
        "gv": tuple(str(g).strip() for g in gv),
        "note": str(note or "").strip(),
    }


def median_of(row):
    vals = sorted(float(g) for g in row["gv"] if g != "")
    if not vals:
        return None
    n = len(vals)
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def is_excluded(row):
    low = row["note"].lower()
    return any(tok in low or tok in row["note"] for tok in EXCLUDE_TOKENS)


# ---------------------------------------------------------------- 读取输入
CSV_HEADER = ["run_order", "color", "point_id", "type", "x1_c", "x2_c", "x3_c",
              "L_0deg", "L_30deg", "L_60deg", "GV_1", "GV_2", "GV_3", "GV_median", "note"]


def load_csv(path):
    """支持两种格式：带 `# key=value` 头部（向导导出）与裸表头（旧格式）"""
    rows, meta = [], {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        lines = f.read().splitlines()
    start = 0
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("#"):
            if "=" in s:
                k, v = s.lstrip("#").strip().split("=", 1)
                meta[k.strip()] = v.strip()
            start = i + 1
        elif s:
            break
    reader = csv.DictReader(lines[start:])
    header = [h.strip() for h in reader.fieldnames or []]
    missing = [h for h in ["color", "type", "x1_c", "x2_c", "x3_c",
                           "L_0deg", "L_30deg", "L_60deg", "GV_1", "GV_2", "GV_3"] if h not in header]
    if missing:
        raise SystemExit(f"[错误] CSV 缺少列: {missing}\n  实际表头: {header}")
    for i, r in enumerate(reader, start=start + 2):
        try:
            rows.append(make_row(
                r.get("run_order", ""), r.get("color", "").strip(), r.get("point_id", ""),
                r.get("type", "").strip(),
                (r["x1_c"], r["x2_c"], r["x3_c"]),
                (r["L_0deg"], r["L_30deg"], r["L_60deg"]),
                (r.get("GV_1", ""), r.get("GV_2", ""), r.get("GV_3", "")),
                r.get("note", "")))
        except (ValueError, TypeError):
            print(f"[警告] CSV 第 {i} 行解析失败, 已跳过: {dict(list(r.items())[:5])}")
    return rows, meta


def load_xlsx(path):
    if openpyxl is None:
        raise SystemExit("[错误] 读取 xlsx 需要 openpyxl: pip install openpyxl")
    wb = openpyxl.load_workbook(path, data_only=True)
    rows = []
    for sheet in ("design", "verify"):
        if sheet not in wb.sheetnames:
            print(f"[警告] Excel 中没有 '{sheet}' sheet, 跳过")
            continue
        ws = wb[sheet]
        for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if row is None or not str(row[1] or "").strip():
                continue
            try:
                rows.append(make_row(row[0], str(row[1]).strip(), row[2], str(row[3]).strip(),
                                     (row[4], row[5], row[6]),
                                     (row[7], row[8], row[9]),
                                     (row[10] or "", row[11] or "", row[12] or ""),
                                     row[14] or ""))
            except (ValueError, TypeError):
                print(f"[警告] Excel '{sheet}' 第 {i} 行解析失败, 已跳过")
    meta = {}
    if "meta" in wb.sheetnames:
        for key, val, *_ in wb["meta"].iter_rows(min_row=2, values_only=True):
            if key:
                meta[str(key).strip()] = str(val or "").strip()
    return rows, meta


# ---------------------------------------------------------------- 线性代数
def solve_lstsq(X, y):
    """返回 (beta, method)。优先 numpy lstsq，缺 numpy 时用消元解正规方程。"""
    if _np is not None:
        beta, _, rank, sv = _np.linalg.lstsq(_np.array(X), _np.array(y), rcond=None)
        cond = float(sv[0] / sv[-1]) if len(sv) and sv[-1] > 0 else float("inf")
        return [float(b) for b in beta], "numpy-lstsq", cond
    n, k = len(X), len(X[0])
    xtx = [[sum(X[r][a] * X[r][b] for r in range(n)) for b in range(k)] for a in range(k)]
    xty = [sum(X[r][a] * y[r] for r in range(n)) for a in range(k)]
    m = [xtx[i][:] + [xty[i]] for i in range(k)]
    for col in range(k):
        piv = max(range(col, k), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-10:
            raise ValueError("设计矩阵奇异（点数不足或线性相关）")
        m[col], m[piv] = m[piv], m[col]
        for r in range(k):
            if r != col and m[r][col] != 0.0:
                f = m[r][col] / m[col][col]
                for c in range(col, k + 1):
                    m[r][c] -= f * m[col][c]
    return [m[i][k] / m[i][i] for i in range(k)], "pure-python", float("nan")


# ---------------------------------------------------------------- F 检验（纯 stdlib）
def _betacf(a, b, x, itmax=300, eps=3e-12):
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    if abs(d) < 1e-300:
        d = 1e-300
    d, h = 1.0 / d, 1.0
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-300:
            d = 1e-300
        c = 1.0 + aa / c
        if abs(c) < 1e-300:
            c = 1e-300
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-300:
            d = 1e-300
        c = 1.0 + aa / c
        if abs(c) < 1e-300:
            c = 1e-300
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betainc(a, b, x):
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    ln_bt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x)
    bt = math.exp(ln_bt)
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def f_sf(f, d1, d2):
    """P(F(d1,d2) > f)"""
    if f <= 0 or d1 <= 0 or d2 <= 0:
        return float("nan")
    return _betainc(d2 / 2.0, d1 / 2.0, d2 / (d2 + d1 * f))


# ---------------------------------------------------------------- 动态定项工具
def term_keys_for(active):
    """活跃轴（0-based 轴序号列表）→ 系数键名，顺序固定: 常数, 线性, 平方, 交叉"""
    keys = ["b0"]
    keys += [f"b{i+1}" for i in active]
    keys += [f"b{i+1}{i+1}" for i in active]
    for m in range(len(active)):
        for n in range(m + 1, len(active)):
            keys.append(f"b{active[m]+1}{active[n]+1}")
    return keys


def featvec(real, active, center, half):
    """特征向量（顺序与 term_keys_for 一致），编码 u = (v - c)/h"""
    us = {i: (real[i] - center[i]) / half[i] for i in active}
    fs = [1.0]
    fs += [us[i] for i in active]
    fs += [us[i] * us[i] for i in active]
    for m in range(len(active)):
        for n in range(m + 1, len(active)):
            fs.append(us[active[m]] * us[active[n]])
    return fs


def expand_generic(coeffs, active, center, half):
    """活跃轴编码系数 → 实际值空间系数（禁用轴不在模型中，其固定值假设随模型走）"""
    a = coeffs["b0"]
    lin = {i: 0.0 for i in active}
    quad = {i: 0.0 for i in active}
    cross = {}
    for i in active:
        c, h = center[i], half[i]
        b = coeffs[f"b{i+1}"]
        q = coeffs[f"b{i+1}{i+1}"]
        a -= b * c / h
        a += q * c * c / (h * h)
        lin[i] += b / h - 2 * q * c / (h * h)
        quad[i] += q / (h * h)
    for m in range(len(active)):
        for n in range(m + 1, len(active)):
            i, j = active[m], active[n]
            c_i, h_i, c_j, h_j = center[i], half[i], center[j], half[j]
            b = coeffs[f"b{i+1}{j+1}"]
            a += b * c_i * c_j / (h_i * h_j)
            lin[i] -= b * c_j / (h_i * h_j)
            lin[j] -= b * c_i / (h_i * h_j)
            cross[f"{i+1}{j+1}"] = b / (h_i * h_j)
    out = {"a": a}
    for i in active:
        out[f"a{i+1}"] = lin[i]
        out[f"a{i+1}{i+1}"] = quad[i]
    for kk, vv in cross.items():
        out[f"a{kk}"] = vv
    return out


def expansion_selfcheck(coeffs, active, center, half, n=50, tol=1e-9):
    rng = random.Random(7)
    keys = term_keys_for(active)
    beta = [coeffs[k] for k in keys]

    def ev(real):
        return sum(b * f for b, f in zip(beta, featvec(real, active, center, half)))

    worst = 0.0
    for _ in range(n):
        us = {i: rng.uniform(-1, 1) for i in active}
        real = {i: us[i] * half[i] + center[i] for i in active}
        # 编码式
        y_coded = coeffs["b0"]
        for i in active:
            y_coded += coeffs[f"b{i+1}"] * us[i] + coeffs[f"b{i+1}{i+1}"] * us[i] * us[i]
        for m in range(len(active)):
            for n2 in range(m + 1, len(active)):
                y_coded += coeffs[f"b{active[m]+1}{active[n2]+1}"] * us[active[m]] * us[active[n2]]
        worst = max(worst, abs(y_coded - ev([real.get(i, 0.0) for i in range(3)])))
    return worst, worst < tol


# ---------------------------------------------------------------- 轴分类（活跃/禁用）
def parse_declared_levels(meta):
    """levels_{color}_{angle} → 三档 [lo,mid,hi] 或 {"disabled": True, "fixed": N}"""
    declared = {}
    for key, val in (meta or {}).items():
        if not key.startswith("levels_"):
            continue
        try:
            color, angle = key[len("levels_"):].split("_", 1)
            sval = str(val).strip().lower()
            if sval.startswith("disabled"):
                fixed = 0.0
                if "fixed=" in sval:
                    fixed = float(sval.split("fixed=")[1].split(",")[0])
                declared.setdefault(color, {})[angle] = {"disabled": True, "fixed": fixed}
            else:
                lo, mid, hi = (float(x) for x in sval.replace("，", ",").split(","))
                declared.setdefault(color, {})[angle] = [lo, mid, hi]
        except (ValueError, KeyError):
            print(f"[警告] 无法解析档位声明 {key}={val}, 忽略")
    return declared


def classify_axes(kept, color, declared_levels):
    """返回 (active 轴号列表, fixed_map {轴号: 固定值}, levels, center, half, info)；失败时 payload=None"""
    info = []
    active, fixed_map, levels = [], {}, {}
    center, half = {}, {}
    for i, angle in enumerate(ANGLES):
        vals = set(r["real"][i] for r, _ in kept)
        declared = (declared_levels or {}).get(color, {}).get(angle)
        is_disabled_declared = isinstance(declared, dict) and declared.get("disabled")
        if is_disabled_declared:
            fixed_at = float(declared.get("fixed", 0))
            if any(abs(r["real"][i] - fixed_at) > 0.5 for r, _ in kept):
                return None, None, None, f"{color}_{angle}: 声明禁用(固定{fixed_at:g})但数据出现其他值——数据与档位脱节"
            fixed_map[i] = fixed_at
            continue
        if len(vals) <= 1:
            v0 = next(iter(vals))
            if declared is None:
                info.append(f"{color}_{angle}: 数据恒定 ({v0:g}) → 按禁用轴处理（固定 {v0:g}）")
                fixed_map[i] = v0
                continue
            return None, None, None, f"{color}_{angle}: 声明活跃档位但设计数据恒定——回阶段一核查运行单执行"
        active.append(i)
        low, high = min(vals), max(vals)
        mid_f = (low + high) / 2.0
        half_f = (high - low) / 2.0
        if abs(mid_f - round(mid_f)) > 1e-6 or abs(half_f - round(half_f)) > 1e-6:
            return None, None, None, (f"{color}_{angle}: 反推档位 [{low}, {high}] 不满足整数等距 "
                                      f"(mid={mid_f})——违反 Plan/01 §2.4 等距约束")
        lv = [low, int(round(mid_f)), high]
        for r, _ in kept:
            u = (r["real"][i] - mid_f) / half_f
            if min(abs(u - (-1)), abs(u), abs(u - 1)) > 1e-6:
                return None, None, None, (f"{color}_{angle}: run_order={r['run_order']} 强度 {r['real'][i]} "
                                          f"不在档位 {{{low}, {lv[1]}, {high}}} 上（数据与档位脱节，Plan/02 §8）")
        if declared is not None and not is_disabled_declared:
            if tuple(declared) != tuple(lv):
                return None, None, None, (f"{color}_{angle}: 声明档位 {declared} 与数据反推 {lv} 不一致，"
                                          f"请核对运行单是否按声明档位执行")
        levels[angle] = lv
        center[i], half[i] = mid_f, half_f
    return active, fixed_map, (levels, center, half, info), None


# ---------------------------------------------------------------- 单色拟合
def fit_color(rows, color, declared_levels=None, gv_max=255.0, sat_threshold=250.0):
    warn, info = [], []
    design = [r for r in rows if r["color"] == color and r["type"] != "verify"]
    verify = [r for r in rows if r["color"] == color and r["type"] == "verify"]

    excluded = [r for r in design if is_excluded(r)]
    for r in excluded:
        info.append(f"剔除 run_order={r['run_order']} (note 含排除标记)")
    used = [r for r in design if not is_excluded(r)]

    kept, missing = [], []
    for r in used:
        med = median_of(r)
        if med is None:
            missing.append(r)
        else:
            kept.append((r, med))
    for r in missing:
        warn.append(f"run_order={r['run_order']} ({color}) 无 GV 读数, 未参与拟合")
        info.append(f"缺失: run_order={r['run_order']} point_id={r['point_id']} L={r['real']}")

    n = len(kept)
    active, fixed_map, payload, err = classify_axes(kept, color, declared_levels)
    if payload is None:
        return None, warn + [err], info
    levels, center, half, info_axes = payload
    info.extend(info_axes)
    info.append(f"{color} 轴状态: 活跃 {[ANGLES[i] for i in active]}"
                + (f", 禁用 {{{', '.join(ANGLES[i] + '=' + format(v, 'g') for i, v in fixed_map.items())}}}"
                   if fixed_map else ""))
    info.append(f"{color} 档位(活跃轴): " + "; ".join(f"{a}={levels[a]}" for a in ANGLES if a in levels))

    tkeys = term_keys_for(active)
    n_terms = len(tkeys)
    if n < n_terms + 2:
        return None, warn + [f"{color}: 有效点仅 {n}, 少于项数 {n_terms}+2, 无法拟合"], info

    # 饱和门禁：整色全饱和 = 零信息，必须拒绝（Plan/02 §8）
    n_sat = sum(1 for _, med in kept if med >= sat_threshold)
    if n_sat == n:
        return None, warn + [f"{color}: 全部 {n} 个设计点 GV ≥ {sat_threshold:.0f}（饱和平台，零信息），"
                             f"拒绝拟合——回阶段一重新标定档位（Plan/01 §2）"], info
    if n_sat > n * 0.3:
        warn.append(f"{color}: {n_sat}/{n} 个设计点 GV ≥ {sat_threshold:.0f}（饱和占比 >30%），"
                    f"建议回阶段一重新标定")
    for r, med in kept:
        if med >= sat_threshold:
            info.append(f"饱和: run_order={r['run_order']} median={med} L={r['real']}")

    X = [featvec(r["real"], active, center, half) for r, _ in kept]
    y = [med for _, med in kept]
    try:
        beta, method, cond = solve_lstsq(X, y)
    except ValueError as e:
        return None, warn + [f"{color}: 求解失败: {e}"], info
    coeffs = dict(zip(tkeys, beta))

    def predict(real):
        return sum(b * f for b, f in zip(beta, featvec(real, active, center, half)))

    yhat = [predict(r["real"]) for r, _ in kept]
    resid = [y[i] - yhat[i] for i in range(n)]
    ss_res = sum(r * r for r in resid)
    ybar = sum(y) / n
    ss_tot = sum((v - ybar) ** 2 for v in y)
    dof = n - n_terms
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    r2_adj = 1 - (1 - r2) * (n - 1) / dof if dof > 0 else float("nan")
    rmse = math.sqrt(ss_res / dof) if dof > 0 else float("nan")
    max_res = max(abs(r) for r in resid)

    # 中心点: 纯误差 + 漂移（活跃轴全在中档、禁用轴在固定值的行）
    centers = [(r, med) for r, med in kept
               if all(abs(r["real"][i] - center[i]) < 1e-6 for i in active)
               and all(abs(r["real"][i] - v) < 0.5 for i, v in fixed_map.items())]
    center_meds = [m for _, m in centers]
    ss_pe, df_pe = 0.0, 0
    drift = None
    if len(center_meds) >= 2:
        cm = sum(center_meds) / len(center_meds)
        ss_pe = sum((m - cm) ** 2 for m in center_meds)
        df_pe = len(center_meds) - 1
        drift = (max(center_meds) - min(center_meds)) / max(abs(cm), 1e-9) * 100
        if drift > 3.0:
            warn.append(f"{color}: 中心点漂移 {drift:.1f}% (>3%), 光源可能不稳")
    lof = {}
    df_lof = dof - df_pe
    if df_pe > 0 and df_lof > 0:
        ss_lof = ss_res - ss_pe
        F = (ss_lof / df_lof) / (ss_pe / df_pe) if ss_pe > 0 else float("inf")
        lof = {"F": F, "dof1": df_lof, "dof2": df_pe,
               "p": f_sf(F, df_lof, df_pe), "significant": f_sf(F, df_lof, df_pe) < 0.05}

    sat_pts = [f"run_order={r['run_order']} gv={g}" for r, _ in kept for g in r["gv"]
               if g != "" and (float(g) <= 0.5 or float(g) >= gv_max - 0.5)]
    if sat_pts:
        warn.append(f"{color}: 疑似饱和读数 {len(sat_pts)} 个: {', '.join(sat_pts[:4])}"
                    f"{'...' if len(sat_pts) > 4 else ''}")

    # 验证点：u 从实数列反推；与 CSV 编码列交叉核对（禁用轴编码列为空，跳过）
    verify_rows = []
    verify_max_rel = None
    for r in verify:
        med = median_of(r)
        if med is None:
            warn.append(f"验证点 {r['point_id']} ({color}) 无读数")
            continue
        for i in active:
            u_i = (r["real"][i] - center[i]) / half[i]
            if r["coded"][i] is not None and abs(u_i - r["coded"][i]) > 0.02:
                warn.append(f"验证点 {r['point_id']} ({color}) {ANGLES[i]}: 编码列 {r['coded'][i]} "
                            f"与实数列反推 {round(u_i, 3)} 不一致")
        pred = predict(r["real"])
        rel = abs(med - pred) / abs(med) * 100 if abs(med) > 1 else abs(med - pred)
        verify_max_rel = max(verify_max_rel or 0.0, rel)
        verify_rows.append({"point": r["point_id"], "L": [round(x) for x in r["real"]],
                            "actual": med, "pred": pred, "err": med - pred, "rel_pct": rel})

    expanded = expand_generic(coeffs, active, center, half)
    worst, okc = expansion_selfcheck(coeffs, active, center, half)
    if not okc:
        warn.append(f"{color}: 系数展开回代误差 {worst:.2e} > 1e-9, expanded 字段不可信")

    r2_pass = r2 >= 0.98
    verify_pass = (verify_max_rel is not None and verify_max_rel <= 5.0) if verify_rows else None
    gates = {"r2": r2_pass, "verify": verify_pass,
             "pass": (r2_pass and verify_pass) if verify_pass is not None else (r2_pass if not verify_rows else None)}

    model = {
        "schemaVersion": 1,
        "id": "",  # 由 main 填
        "machineId": "", "modelName": "", "channel": color,
        "lightLabel": {"x1": "0deg", "x2": "30deg", "x3": "60deg"},
        "inputRange": {"min": 0, "max": 1024},
        "activeAxes": [f"x{i+1}" for i in active],   # 参与模型的轴；不在其中 = 禁用轴
        "fixedAxes": {f"x{i+1}": v for i, v in fixed_map.items()},  # 禁用轴固定值（预测的运行假设）
        "levels": {f"x{i+1}": (levels[ANGLES[i]] if ANGLES[i] in levels else None) for i in range(3)},
        "coding": {f"x{i+1}": {"center": center[i], "half": half[i]} for i in active},
        "responseUnit": "GV",
        "coefficients": {kk: round(coeffs[kk], 9) for kk in tkeys},   # 只含活跃轴项
        "expanded": {kk: round(vv, 12) for kk, vv in expanded.items()},
        "quality": {
            "r2": round(r2, 6), "r2Adj": round(r2_adj, 6), "rmse": round(rmse, 4),
            "maxResidual": round(max_res, 4), "verifyMaxRelErr": round(verify_max_rel, 3) if verify_max_rel is not None else None,
            "nPoints": n, "nCenter": len(centers), "doF": dof,
            "lackOfFit": {kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in lof.items()} or None,
            "centerDriftPct": round(drift, 2) if drift is not None else None,
            "nSaturated": n_sat,
            "expansionCheck": round(worst, 12),
            "gates": gates,
        },
        "fittedAt": "",  # 由 main 填
        "dataSource": "",
    }
    detail = {"method": method, "cond": cond, "verify": verify_rows,
              "center_meds": center_meds, "levels": levels,
              "active": active, "fixed": fixed_map, "tkeys": tkeys}
    return model, warn, info + [detail]


# ---------------------------------------------------------------- Demo 数据
TRUE_BETA = {
    "Red":   [118.0, 32.0, 14.0, 6.0, -12.0, -4.0, -1.5, 5.0, 2.5, 1.0],
    "Green": [130.0, 25.0, 28.0, 9.0, -8.0, -14.0, -2.0, 3.0, 1.5, 2.0],
    "Blue":  [95.0, 18.0, 10.0, 30.0, -6.0, -3.0, -11.0, 2.0, 4.0, 1.5],
}
# 演示量程标定结果：Red 60° 窄量程；Blue 30° 禁用（固定 0）→ 2 因子设计
DEMO_LEVELS = {
    "Red":   {"0deg": [0, 1024], "30deg": [0, 1024], "60deg": [0, 15]},
    "Green": {"0deg": [0, 1024], "30deg": [0, 600], "60deg": [0, 1024]},
    "Blue":  {"0deg": [0, 1024], "30deg": None, "60deg": [0, 1024]},
}


def demo_lu(levels_cfg, color):
    """[[low, mid, high]] × 3 轴；禁用轴 = [fixed, fixed, fixed]"""
    out = []
    for a in ANGLES:
        v = levels_cfg[color][a]
        if v is None:
            out.append([0, 0, 0])
        elif len(v) == 2:
            half = (v[1] - v[0]) // 2
            out.append([v[0], v[0] + half, v[0] + 2 * half])
        else:
            out.append(list(v))
    return out


def demo_truth(beta10, u_active_idx, pat):
    """按全 10 系数真值在给定编码点求值；u 按 轴号 取（禁用轴 u 无贡献 → 0）"""
    u = [0.0, 0.0, 0.0]
    for j, ai in enumerate(u_active_idx):
        u[ai] = pat[j]
    b = beta10
    return (b[0] + b[1] * u[0] + b[2] * u[1] + b[3] * u[2]
            + b[4] * u[0] * u[0] + b[5] * u[1] * u[1] + b[6] * u[2] * u[2]
            + b[7] * u[0] * u[1] + b[8] * u[0] * u[2] + b[9] * u[1] * u[2])


def write_demo_csv(path, seed=42, sigma=1.2):
    """带 # 档位头部的 CSV（模拟向导导出），含窄量程 + 禁用轴两种场景。"""
    rng = random.Random(seed)
    lines = ["# machine=DEMO", "# model=SYNTHETIC", "# saturation_threshold=250"]
    for color in COLORS:
        for ai, angle in enumerate(ANGLES):
            v = DEMO_LEVELS[color][angle]
            if v is None:
                lines.append(f"# levels_{color}_{angle}=disabled,fixed=0")
            elif len(v) == 2:
                half = (v[1] - v[0]) // 2
                lines.append(f"# levels_{color}_{angle}={v[0]}, {v[0]+half}, {v[0]+2*half}")
            else:
                lines.append(f"# levels_{color}_{angle}={v[0]}, {v[1]}, {v[2]}")
    lines.append(",".join(CSV_HEADER))
    run = 1
    for color in COLORS:
        act = [i for i in range(3) if DEMO_LEVELS[color][ANGLES[i]] is not None]
        lu = demo_lu(DEMO_LEVELS, color)
        pats = list(BBD_CODED) if len(act) == 3 else (
            [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1)] + [(0, 0)] * 3 if len(act) == 2
            else [(-1,), (-1,), (0,), (0,), (1,), (1,)])
        for i, pat in enumerate(pats, 1):
            truth = demo_truth(TRUE_BETA[color], act, pat)
            gvs = [f"{truth + rng.gauss(0, sigma):.1f}" for _ in range(3)]
            v = []
            for ai in range(3):
                if ai in act:
                    j = act.index(ai)
                    v.append(round(lu[ai][1] + pat[j] * (lu[ai][2] - lu[ai][1])))
                else:
                    v.append(lu[ai][0])
            u = ["" if ai not in act else round((v[ai] - lu[ai][1]) / (lu[ai][2] - lu[ai][1]), 3) for ai in range(3)]
            is_center = all(p == 0 for p in pat)
            note = "作废(演示剔除)" if (color == "Green" and i == 13) else ""
            lines.append(",".join([str(run), color, str(i), "center" if is_center else "edge",
                                   *[("" if x == "" else str(x)) for x in u],
                                   *[str(x) for x in v], *gvs, "", note]))
            run += 1
        for vf, frac in enumerate(VERIFY_FRACTIONS, 1):
            truth = demo_truth(TRUE_BETA[color], act, [2 * frac[ai] - 1 for ai in act])
            gvs = [f"{truth + rng.gauss(0, sigma):.1f}" for _ in range(3)]
            v = []
            for ai in range(3):
                if ai in act:
                    lv = lu[ai]
                    v.append(int(math.floor(lv[0] + frac[ai] * (lv[2] - lv[0]) + 0.5)))
                else:
                    v.append(lu[ai][0])
            u = ["" if ai not in act else round((v[ai] - lu[ai][1]) / (lu[ai][2] - lu[ai][1]), 3) for ai in range(3)]
            lines.append(",".join([f"V{run}", color, f"V{vf}", "verify",
                                   *[("" if x == "" else str(x)) for x in u],
                                   *[str(x) for x in v], *gvs, "", ""]))
            run += 1
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        f.write("\n".join(lines))
    return path


# ---------------------------------------------------------------- 报告
def fmt(x, sig=6):
    return f"{'-' if x is None else format(x, f'.{sig}g')}"


def write_report(path, args, models, all_warn, all_info, method, cond_by_color):
    L = []
    L.append("# LightAnalyse 拟合报告\n")
    L.append(f"- 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    L.append(f"- 数据源: `{args.input or '(demo 合成数据)'}`")
    L.append(f"- 设备/型号: **{args.machine} / {args.model}**  (machineId/modelName)")
    L.append(f"- 求解后端: {method}" + (f", 条件数: " + ", ".join(f"{c}={fmt(v, 4)}" for c, v in cond_by_color.items()) if _np else " (pure-python, 无条件数)"))
    L.append(f"- 编码: u_i = (L_i − mid_i) / half_i（逐轴，档位见各节）\n")

    L.append("## 总览\n")
    L.append("| 颜色 | 活跃轴 | 禁用轴 | 有效点 | R² | adj R² | RMSE | 验证最大相对误差 | lack-of-fit p | 门禁 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for m in models:
        q = m["quality"]
        g = q["gates"]
        gate_txt = {True: "PASS", False: "**FAIL**", None: "未验证"}[g["pass"]]
        act = ", ".join(m["activeAxes"])
        fx = ", ".join(f"{k}={v:g}" for k, v in m["fixedAxes"].items()) or "-"
        L.append(f"| {m['channel']} | {act} | {fx} | {q['nPoints']} | {fmt(q['r2'],4)} | {fmt(q['r2Adj'],4)} | "
                 f"{fmt(q['rmse'],3)} | {fmt(q['verifyMaxRelErr'],3)}% | "
                 f"{fmt(q['lackOfFit']['p'],3) if q['lackOfFit'] else '-'} | {gate_txt} |")
    L.append("")

    for m in models:
        c = m["channel"]
        act = m["activeAxes"]
        fixed = m["fixedAxes"]
        e = m["expanded"]
        q = m["quality"]
        lv = m["levels"]
        L.append(f"## {c}\n")
        L.append("### 档位 / 轴状态\n")
        L.append("| 轴 | 状态 | low | mid | high |")
        L.append("|---|---|---|---|---|")
        for xi, angle in zip(("x1", "x2", "x3"), ANGLES):
            if lv[xi] is None:
                L.append(f"| {angle} | **禁用（固定 {fmt(fixed.get(xi, 0))}，不参与调光）** | - | - | - |")
            else:
                lo, mid, hi = lv[xi]
                L.append(f"| {angle} | 活跃 | {lo:g} | {mid:g} | {hi:g} |")
        L.append("")
        L.append("### 公式（编码空间；u_i = (L_i − mid_i)/half_i，仅活跃轴）\n")
        expr = f"GV = {fmt(m['coefficients']['b0'])}"
        for xi in act:
            v = m["coefficients"][f"b{xi[1]}"]
            expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·u{xi[1]}"
        for xi in act:
            v = m["coefficients"][f"b{xi[1]}{xi[1]}"]
            expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·u{xi[1]}²"
        for kk, key in ((("x1", "x2"), "b12"), (("x1", "x3"), "b13"), (("x2", "x3"), "b23")):
            if key in m["coefficients"]:
                v = m["coefficients"][key]
                expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·u{kk[0][1]}·u{kk[1][1]}"
        L.append(f"```\n{expr}\n```")
        L.append("### 公式（实际光强，可直接手算/Excel 复算；仅在禁用轴保持固定值时有效）\n")
        expr = f"GV = {fmt(e['a'])}"
        for xi in act:
            v = e[f"a{xi[1]}"]
            expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·L{xi[1]}"
        for xi in act:
            v = e[f"a{xi[1]}{xi[1]}"]
            expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·L{xi[1]}²"
        for kk, key in ((("x1", "x2"), "a12"), (("x1", "x3"), "a13"), (("x2", "x3"), "a23")):
            if key in e:
                v = e[key]
                expr += f" {'+' if v >= 0 else '-'} {abs(v):.6g}·L{kk[0][1]}·L{kk[1][1]}"
        L.append(f"```\n{expr}\n  (L1=0°, L2=30°, L3=60°)\n```")
        L.append("### 系数\n")
        L.append("| 项 | 编码空间 | 展开值 |")
        L.append("|---|---|---|")
        for t in m["coefficients"]:
            ek = {"b0": "a", "b1": "a1", "b2": "a2", "b3": "a3", "b11": "a11",
                  "b22": "a22", "b33": "a33", "b12": "a12", "b13": "a13", "b23": "a23"}[t]
            L.append(f"| {t} | {fmt(m['coefficients'][t])} | {fmt(e.get(ek))} |")
        if m.get("_verify"):
            L.append("### 验证点\n")
            L.append("| 点 | L(0°,30°,60°) | 实际 GV | 预测 GV | 误差 | 相对 |")
            L.append("|---|---|---|---|---|---|")
            for v in m["_verify"]:
                L.append(f"| {v['point']} | ({v['L'][0]}, {v['L'][1]}, {v['L'][2]}) | "
                         f"{fmt(v['actual'],5)} | {fmt(v['pred'],5)} | {fmt(v['err'],4)} | {fmt(v['rel_pct'],3)}% |")
            L.append("")
        q_l = q["lackOfFit"]
        L.append("### 诊断\n")
        cms = m.get("_center_meds", [])
        if cms:
            L.append(f"- 中心点中位数: {', '.join(fmt(x, 5) for x in cms)}"
                     f" (极差 {fmt(max(cms) - min(cms), 3)}"
                     + (f", 漂移 {q['centerDriftPct']}%" if q["centerDriftPct"] is not None else "") + ")")
        if q_l:
            sig = "显著(模型可能缺项)" if q_l["significant"] else "不显著(模型够用)"
            L.append(f"- Lack-of-fit: F={fmt(q_l['F'],4)}, p={fmt(q_l['p'],3)} → {sig}")
        L.append(f"- 展开回代检查: max diff = {q['expansionCheck']:.2e}")
        for w in [w for w in all_warn if w.startswith(c + ":")]:
            L.append(f"- ⚠ {w[2 + len(c):].strip()}")
        L.append("")

    if all_info:
        L.append("## 处理记录\n")
        for line in all_info:
            L.append(f"- {line}")
        L.append("")
    if all_warn:
        L.append("## 警告汇总\n")
        for w in all_warn:
            L.append(f"- {w}")
        L.append("")
    L.append("## 下一步\n")
    L.append("- `light-models.json` 已按 Plan/02 §4 schema 生成; UI 侧放 `tauri-app/src/assets/light-models.json`")
    L.append("- 门禁: R² ≥ 0.98 且 验证集最大相对误差 ≤ 5%")
    L.append("- 禁用轴的模型仅在禁用轴保持其固定值时有效；如需重新启用请走 Plan/01 §2.5")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


# ---------------------------------------------------------------- main
def main():
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = argparse.ArgumentParser(description="LightAnalyse 响应面自动拟合", formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", help="CSV(向导导出) 或 XLSX(doe_design.py 生成并回填)")
    p.add_argument("--demo", action="store_true", help="用合成数据自检全流程")
    p.add_argument("--out", default=os.path.join(OUT_DIR, "light-models.json"))
    p.add_argument("--report", default=os.path.join(OUT_DIR, "fit_report.md"))
    p.add_argument("--machine", default=None)
    p.add_argument("--model", default=None)
    p.add_argument("--gv-max", type=float, default=255.0, help="GV 饱和判定上限(默认 255)")
    p.add_argument("--assets", default=None, help="额外复制 light-models.json 到该目录(如 tauri-app/src/assets)")
    p.add_argument("--channel", choices=COLORS, default=None, help="只拟合单一颜色(默认全部)")
    args = p.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    meta = {}
    if args.demo:
        args.input = os.path.join(OUT_DIR, "demo_data.csv")
        write_demo_csv(args.input)
        print(f"[demo] 已生成合成数据: {args.input} (真实系数见 TRUE_BETA, 噪声 sigma=1.2)")
        print(f"[demo] 场景: Red 60° 窄量程 [0,15] / Blue 30° 禁用(固定 0) / 其余全量程")
        args.machine, args.model = args.machine or "DEMO", args.model or "SYNTHETIC"
    elif not args.input:
        p.error("需要 --input 或 --demo")

    if args.input.lower().endswith((".xlsx", ".xlsm")):
        rows, meta = load_xlsx(args.input)
    else:
        rows, csv_meta = load_csv(args.input)
        meta = {**csv_meta, **meta}

    machine = args.machine or meta.get("machine") or meta.get("machine_id") or "UNKNOWN"
    model_name = args.model or meta.get("model") or meta.get("model_name") or "UNKNOWN"
    declared_levels = parse_declared_levels(meta)
    sat_threshold = float(meta.get("saturation_threshold", 250.0))

    colors = [args.channel] if args.channel else COLORS
    models, all_warn, all_info, cond_by = [], [], [], {}
    for color in colors:
        got = [r for r in rows if r["color"].lower() == color.lower()]
        if not got:
            print(f"[警告] 输入中没有 {color} 的数据, 跳过")
            continue
        model, warn, info = fit_color(rows, color, declared_levels, args.gv_max, sat_threshold)
        cond_by[color] = None
        if model is None:
            all_warn.extend(warn)
            all_info.extend(info)
            print(f"[失败] {color}: {warn[-1] if warn else '未知原因'}")
            continue
        model["machineId"], model["modelName"] = machine, model_name
        model["id"] = f"{machine}/{model_name}/{color}"
        model["fittedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        model["dataSource"] = os.path.basename(args.input)
        detail = info[-1]
        model["_verify"] = detail["verify"]
        model["_center_meds"] = detail["center_meds"]
        model["_levels"] = detail["levels"]
        model["_tkeys"] = detail["tkeys"]
        cond_by[color] = detail["cond"]
        models.append(model)
        all_warn.extend(warn)
        all_info.extend(info[:-1])
        q = model["quality"]
        g = q["gates"]
        print(f"[完成] {color}: 轴={'+'.join(model['activeAxes'])}, n={q['nPoints']}, R2={q['r2']}, "
              f"adjR2={q['r2Adj']}, RMSE={q['rmse']}, verifyErr={q['verifyMaxRelErr']}%, gate={g['pass']}")

    if not models:
        print("\n没有任何颜色拟合成功, 退出。")
        sys.exit(1)

    write_report(args.report, args, models, all_warn, all_info,
                 "numpy-lstsq" if _np else "pure-python", cond_by)
    print(f"[输出] {args.report}")

    for m in models:
        for k in ("_verify", "_center_meds", "_levels", "_tkeys"):
            m.pop(k, None)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(models, f, ensure_ascii=False, indent=2)
    print(f"\n[输出] {args.out} ({len(models)} 个模型)")

    if args.assets:
        os.makedirs(args.assets, exist_ok=True)
        dst = os.path.join(args.assets, "light-models.json")
        shutil.copyfile(args.out, dst)
        print(f"[输出] {dst}")

    if args.demo:
        print("\n[demo] 真实系数 vs 拟合结果 (Red 60° 窄量程 / Blue 30° 禁用):")
        for c in COLORS:
            m = next((x for x in models if x["channel"] == c), None)
            if not m:
                continue
            fitted = {t: m["coefficients"][t] for t in m["coefficients"]}
            parts = []
            for i, t in enumerate(TERMS):
                truth_s = f"{TRUE_BETA[c][i]:+.2f}"
                fit_s = f"{fitted[t]:+.2f}" if t in fitted else "(禁用)"
                parts.append(f"{t}={fit_s}/{truth_s}")
            print(f"  {c:5s} " + "  ".join(parts))
        # 自检 2: 整色全饱和必须被拒绝
        rows_sat, meta_sat = load_csv(args.input)
        for r in rows_sat:
            if r["color"] == "Red":
                r["gv"] = ("255", "255", "255")
        m, w, _ = fit_color(rows_sat, "Red", parse_declared_levels(meta_sat), 255.0, 250.0)
        rejected = m is None and any("拒绝拟合" in x for x in w)
        print(f"[demo] 自检-整色饱和拒绝: {'OK' if rejected else 'FAIL'}")
        if not rejected:
            sys.exit(1)


if __name__ == "__main__":
    main()
