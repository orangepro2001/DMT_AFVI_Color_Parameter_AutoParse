# `Parameter_Template.xlsx` (검사기술파라미터) — Understanding & Required Parameter Set

Notes on the inspection-technology parameter template found in `D:\검사기술파라미터\`, its layout,
and **which parameters we actually need** for the spec pipeline. Companion documents:
`SPEC_REFERENCE.md` (XML/dictionary reference) and `SpecParamTool.html` (parser + Excel export).

Sheet names, area labels and parameter labels are reproduced **verbatim** (EN + KR as written in the
template); everything else is commentary. Items marked *(to confirm)* are open questions.

---

## 0. TL;DR — what this means for us

1. The template is the **human-facing, per light-set view** of exactly the data that lives in
   `InspectionSpec.xml`, plus two things that no config file contains:
   **① the GV brightness targets** (`GV 밝기`, measured by the user) and
   **② the illumination-axis composition** (`조명 축`, how the light channels are driven).
2. Every area block `영역` is a `GPNODE - PNODE - CNODE` path (e.g. `UNIT - OSP - C-Pad`
   = `GPNODE 1 / PNODE 3 / CNODE 20`) — see §5 for the full mapping.
3. The value cells under each parameter are the **R / G / B values** of the corresponding element in
   `InspectionSpec.xml` (`ValR` / `ValG` / `ValB` of `INSPECTION`; single `Val` for `MASTER`/`SUBMASTER`).
4. The **parameter lists are the deliverable**: the template only asks for a curated subset of the
   dictionary (≈27 `ParamKey`s), split into three families — see §6.
5. **GV rows must stay blank in any generated file**; the user measures and fills them. So a generated
   workbook should reproduce the template skeleton (rows, areas, parameter names, parsed values) and
   leave `GV 밝기` empty for manual entry.

---

## 1. What the template is

`Parameter_Template.xlsx` is the **standard (blank) form** used to record inspection-technology
parameters per product. Sibling files in the same folder are the *filled* instances for concrete
products (`검사기술파라미터-KCC-SAWING.xlsx`, `검사기술파라미터-DDE-CSP-박판-유광.xlsx`,
`검사기술파라미터-DDE-FCBOC-무광.xlsx`).

One workbook = one product; one content sheet = one **side + light set** combination
(`Top/Bottom` × `조명 1/2/3번`). Two reference sheets carry the process rules.

---

## 2. Workbook layout

| # | Sheet | Holds | Content state |
|---|---|---|---|
| 1 | `조명지침` | 4-point checklist of lighting set-up rules | text only |
| 2 | `영역 Convention` | naming convention for area letters (AU / OSP × C-Pad / B-Pad / L-Pad) | text only |
| 3 | `DMG 조명 1번` | DMG, light #1 — **RED only**, columns for `Top - RED` and `Bottom - RED` | header + GV only |
| 4 | `Top 조명 2번` | TOP, light #2 — RED / GREEN / BLUE | header + 7 area blocks |
| 5 | `Top 조명 3번` | TOP, light #3 — RED / GREEN / BLUE | header + 7 area blocks |
| 6 | `Bottom 조명 2번` | BOTTOM, light #2 — RED / GREEN / BLUE | header + 5 area blocks |
| 7 | `Bottom 조명 3번` | BOTTOM, light #3 — RED / GREEN / BLUE | header + 6 area blocks |

Sheet dimension says e.g. `A1:Z348`, but only the rows listed below carry content (the rest is empty
formatting) — a parser must not assume content up to `max_row`.

---

## 3. Anatomy of a content sheet (row roles)

Every light sheet repeats the same block structure:

```
row  채널      : RED        | GREEN      | BLUE        ← colour channel header (one triplet each)
row  조명 축    : <how the light channels are composed for this colour>
row  GV 밝기    : <target class> : <target value>    ← user-measured brightness target, 1–2 rows
   ┌─ repeated per area ────────────────────────────────────────────────────────────┐
   │ row  영역       : UNIT - OSP - C-Pad        ← GPNODE - PNODE - CNODE          │
   │ row  검출 불량   : defect types to detect, one cell per colour channel          │
   │ rows 파라미터    : ordered parameter list, one name per row, per colour channel  │
   │                  (value cells filled only for the product being set up)         │
   └───────────────────────────────────────────────────────────────────────────────┘
```

- `검출 불량` (detected defects) is **descriptive text**, not a key — it documents what the parameters
  are tuned to catch (e.g. `눌림(Dent), 니켈(Ni) 보임, 회로밀림, 회로오픈` for RED on pads).
- Parameter **rows are identical across the three colour columns**; only the values differ.

---

## 4. Column convention

| Column | Colour | Parameter name | Value |
|---|---|---|---|
| `B` / `C` | RED | name | value |
| `D` / `E` | GREEN | name | value |
| `F` / `G` | BLUE | name | value |

So `B=n`/`C=v`, `D=n`/`E=v`, `F=n`/`G=v`. This is the **same R/G/B split** as
`INSPECTION@ValR / @ValG / @ValB` in `InspectionSpec.xml` — the template's three columns are literally
the three channels of one `INSPECTION` element.

`GV 밝기` re-uses the same columns but holds **GV targets**, not parameter values (§7).

---

## 5. `영역` (area) naming ↔ node tree

`영역` is a 3-level path `GPNODE - PNODE - CNODE`, using the names from `SpecTreeNode.xml`:

| Template area | GPNODE | PNODE | CNODE | Param family |
|---|---|---|---|---|
| `UNIT - AU - C-Pad` | 1 Unit | 2 AU | 20 C-Pad | A |
| `UNIT - AU - B-Pad` | 1 Unit | 2 AU | 21 B-Pad | A |
| `UNIT - AU - L-Pad` | 1 Unit | 2 AU | 22 L-Pad | A |
| `UNIT - OSP - C-Pad` | 1 Unit | 3 OSP | 20 C-Pad | A |
| `UNIT - OSP - B-Pad` | 1 Unit | 3 OSP | 21 B-Pad | A |
| `UNIT - OSP - L-Pad` | 1 Unit | 3 OSP | 22 L-Pad | A |
| `UNIT - NonMetal - Pattern1` | 1 Unit | 5 NonMetal | 51 Pattern1 | B |
| `UNIT - NonMetal - PatternThick` | 1 Unit | 5 NonMetal | 54 PatternThick | B |
| `UNIT - NonMetal - Space1` | 1 Unit | 5 NonMetal | 55 Space1 | B |
| `UNIT - NonMetal - SpaceThick` | 1 Unit | 5 NonMetal | 61 SpaceThick | B |
| `UNIT - NonMetal - Open1` | 1 Unit | 5 NonMetal | 62 Open1 | B |
| `UNIT - NonMetal - Laser Marking` | 1 Unit | 5 NonMetal | 80 Laser Marking | Laser (4) |
| `Dummy - AU - L-Pad` | 2 Dummy | 2 AU | 22 L-Pad | C *(inconsistent, see §6.4)* |
| `Dummy - NonMetal - Pattern1` | 2 Dummy | 5 NonMetal | 51 Pattern1 | C |
| `Dummy - NonMetal - Space1` | 2 Dummy | 5 NonMetal | 55 Space1 | C |
| `Dummy - NonMetal - Open1` | 2 Dummy | 5 NonMetal | 62 Open1 | C |

Cross-check: **every area used by the template is a valid combination in `SpecTreeNodeList.xml`**
(G1-P2 → C20/21/22, G1-P3 → C20/21/22, G1-P5 → C50/51/54/55/61/62/65/80, G2-P2 → C20/22,
G2-P5 → C50/51/55/62/63). Areas that are valid but never appear in the template:
`Align / ROI`, `Drill`, `ETC` (including `User Mask`), `SR All`, `Space2…Space6`, `EtchBack`,
plus `C-Pad` for `Dummy - AU`.

Parsing note: the `SpaceThick` cell is not a bare name — it reads
`UNIT - NonMetal - SpaceThick(목단선 GV와 평균 GV가 다를경우 유저마스크를 통해 추가 및 삭제)`.
Strip the trailing parenthetical remark before matching an area name (the remark is quoted in §9).

---

## 6. The parameter sets we need

Three repeating families were found, plus one special block. `ParamKey` is the key in
`SpecParameter.xml`; “delta” notes where the template label differs from the dictionary text.

### 6.1 Family A — “pad / defect” (22 rows)

Used by `UNIT/Dummy - AU/OSP - C-Pad / B-Pad / L-Pad` (product data: `SpecGroup 1` = Mask(Bright),
`2` = Mask(Dark), `4` = Chain Insp for the Nick/Protrusion rows).

| # | Template label | ParamKey | Name (EN) in dictionary | Delta |
|---|---|---|---|---|
| 1 | `Bright Defect(TH)` | 1000 | Bright Defect(TH) | |
| 2 | `Bright Defect Margine(TH)` | 1001 | Bright Defect Margine(TH) | |
| 3 | `Bright Defect Size(Pixel)` | 1002 | Bright Defect Size(Pixel) | |
| 4 | `Bright Defect Offest(%)` | 1003 | Bright Defect Offest**1**(%) | template drops the “1” |
| 5 | `Bright Defect Offset1 Size(Pixel)` | 1004 | Bright Defect Offset1 Size(Pixel) | |
| 6 | `Bright Defect Offest2(TH)` | 1005 | Bright Defect Offest2(TH) | |
| 7 | `Bright Defect Offset2 Size(Pixel)` | 1006 | Bright Defect Offset2 Size(Pixel) | |
| 8 | `Bright Defect Pad Offest(TH)` | 1007 | Bright Defect Pad Offest(TH) | |
| 9 | `Bright Defect Pad Offset Size(Pixel)` | 1008 | Bright Defect Pad Offset Size(Pixel) | |
| 10 | `Dark Defect(TH)` | 1009 | Dark Defect(TH) | |
| 11 | `Dark Defect Margine(TH)` | 1010 | Dark Defect Margine(TH) | |
| 12 | `Dark Defect Size(Pixel)` | 1011 | Dark Defect Size(Pixel) | |
| 13 | `Dark Defect Offest(%)` | 1012 | Dark Defect **Offset1**(%) | template drops the “1” |
| 14 | `Dark Defect Offset1 Size(Pixel)` | 1013 | Dark Defect Offset1 Size(Pixel) | |
| 15 | `Dark Defect Offest2(TH)` | 1014 | Dark Defect **Offset2**(TH) | template writes “Offest2” |
| 16 | `Dark Defect Offset2 Size(Pixel)` | 1015 | Dark Defect Offset2 Size(Pixel) | |
| 17 | `Dark Defect Pad Offest(TH)` | 1016 | Dark Defect Pad **Offset**(TH) | template writes “Offest” |
| 18 | `Dark Defect Pad Offset Size(Pixel)` | 1017 | Dark Defect Pad Offset Size(Pixel) | |
| 19 | `Nick Defect GV` | 1030 | Nick Defect GV | |
| 20 | `Nick Defect Size(Pixel)` | 1031 | Nick Defect Size (Pixel) | trailing space in dictionary |
| 21 | `Protrusion Defect GV` | 1032 | Protrusion Defect GV | |
| 22 | `Protrusion Defect Size(Pixel)` | 1033 | Protrusion Defect Size(Pixel) | |

### 6.2 Family B — “structure” (15 rows)

Used by `NonMetal - Pattern1 / PatternThick / Space1 / SpaceThick / Open1`
(`SpecGroup 1` Bright, `2` Dark, `0` for the In-Range rows).

| # | Template label | ParamKey | Name (EN) in dictionary | Delta |
|---|---|---|---|---|
| 1 | `Bright Defect(TH)` | 1000 | Bright Defect(TH) | |
| 2 | `Bright Defect Size(Pixel)` | 1002 | Bright Defect Size(Pixel) | |
| 3 | `Bright Defect Offest(%)` | 1003 | Bright Defect Offest1(%) | template drops the “1” |
| 4 | `Bright Defect Offset1 Size(Pixel)` | 1004 | Bright Defect Offset1 Size(Pixel) | |
| 5 | `Bright Defect Offest2(TH)` | 1005 | Bright Defect Offest2(TH) | |
| 6 | `Bright Defect Offset2 Size(Pixel)` | 1006 | Bright Defect Offset2 Size(Pixel) | |
| 7 | `Dark Defect(TH)` | 1009 | Dark Defect(TH) | |
| 8 | `Dark Defect Size(Pixel)` | 1011 | Dark Defect Size(Pixel) | |
| 9 | `Dark Defect Offest(%)` | 1012 | Dark Defect Offset1(%) | template drops the “1” |
| 10 | `Dark Defect Offset1 Size(Pixel)` | 1013 | Dark Defect Offset1 Size(Pixel) | |
| 11 | `Dark Defect Offest2(TH)` | 1014 | Dark Defect **Offset2**(TH) | template writes “Offest2” |
| 12 | `Dark Defect Offset2 Size(Pixel)` | 1015 | Dark Defect Offset2 Size(Pixel) | |
| 13 | `In-Range Defect Min(TH)` | 1034 | In-Range Defect Min(TH) | |
| 14 | `In-Range Defect Max(TH)` | 1035 | In-Range Defect Max(TH) | |
| 15 | `In-Range Defect Size(Size)` | 1036 | In-Range Defect Size(**Pixel**) | template writes “(Size)” |

### 6.3 `Laser Marking` block (4 rows, Korean labels)

| # | Template label | ParamKey | Name (KR) in dictionary | Delta |
|---|---|---|---|---|
| 1 | `밝은불량(절대값)` | 1000 | 밝은불량(절대값) | exact match |
| 2 | `밝은불량 크기(%)` | 1018 | 밝은불량 크기(%) | exact match |
| 3 | `어두운불량(절대값)` | 1009 | 어두운불량(절대값) | exact match |
| 4 | `어두운불량 크기(%)` | 1019 | 어두운불량 크기(%) | exact match |

Note the value cells here are **percent** thresholds (`Val` = percentage), unlike the pixel/TH rows.

### 6.4 Family C — “Dummy” (8 rows) — **not in `SpecParameter.xml`** *(to confirm)*

| # | Template label | ParamKey |
|---|---|---|
| 1 | `Bright Threshold` | ? |
| 2 | `Bright Threshold(Pixel)` | ? |
| 3 | `Bright Offset2(TH)` | ? |
| 4 | `Bright Offset2(Pixel)` | ? |
| 5 | `Dark Threshold` | ? |
| 6 | `Dark Threshold(Pixel)` | ? |
| 7 | `Dark Offset2(TH)` | ? |
| 8 | `Dark Offset2(Pixel)` | ? |

None of these strings occur in `SpecParameter.xml`, and no `InspectionSpec.xml` in the analysed set
contains an element with a matching name, so **the `ParamKey`s behind this family are unknown**.
The closest dictionary family is `1020–1023` (`Block Bright/Dark …`), which is *not* used by any file
in the analysed set either — likely a legacy/2-tier naming for Dummy-area thresholds.
*Action: confirm with the spec engineer which keys these eight rows map to.*

Consistency warning: `Dummy - AU - L-Pad` uses family C in `Top 조명 2번`
but family A (22 rows) in `Bottom 조명 2번` — the template itself is not consistent here, so a
generator should not assume family per area, but read the template row list.

### 6.5 Union — the parameter set we need (27 known keys)

```
1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008,   ← Bright defect (A)
1009, 1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017,   ← Dark defect (A)
1018, 1019,                                              ← Bright/Dark size % (Laser Marking)
1030, 1031, 1032, 1033,                                  ← Nick / Protrusion (A)
1034, 1035, 1036,                                        ← In-Range (B)
+ 8 unknown keys                                         ← Dummy "Threshold/Offset2" family (C)
```

Everything except family C is already present in the `SpecParameter.xml` dictionary used by the tool.

---

## 7. `GV 밝기` — the manually measured rows

`GV` = grey value on the camera image. **It is measured by the user on the product and never stored in
any config file**, so it cannot be parsed — it must be produced as an empty labelled row.

| Sheet | Target class | RED | GREEN | BLUE | Notation |
|---|---|---|---|---|---|
| `DMG 조명 1번` | `AU` / `OSP` | 180 / 140 | 180 / 140 | – | single number (Top and Bottom share the row layout) |
| `Top 조명 2번` | `AU` / `OSP` | `X` / 255 | `X` / 190~200 | `X` / 170~180 | `X` = not used |
| `Bottom 조명 2번` | `AU` / `OSP` | `X` / 210~220 | `X` / 60~70 | `X` / 155~165 | range `a~b` |
| `Top 조명 3번` | `SR` / `SPACE` | 70~80 / 60~70 | 50~60 / 55~65 | 105~115 / 115~125 | |
| `Bottom 조명 3번` | `SR` / `SPACE` | 75~80 / 65 | `60 : 50~70` / `40 : 30~50` | `SR(가변)` 100 / `SPACE(가변)` 80 | `a : b~c`, `(가변)` = variable |

Pattern: **light 1–2 target `AU`/`OSP`** (pad areas), **light 3 targets `SR`/`SPACE`** (structure areas).
The `조명지침` rules explain which class wins when both AU and OSP exist (§8, rule 4).

---

## 8. `조명지침` (lighting guideline) — verbatim rules

| # | Rule (original) | Meaning |
|---|---|---|
| 1 | `만약 제품이 지저분해서 티칭이 불가한 경우 : 블루조명 동축 추가 동축 : 60도 \| 1 : 10으로 설정` | If the product is too dirty to teach: add blue coaxial light, coaxial 60°, ratio 1 : 10 |
| 2 | `만약 SR의 Space와 SR영역의 구분이 어려울때, 레드조명 30도추가 동축 : 30도 \| 2 : 1 비율 설정` | If SR space and SR area are hard to separate: add red 30°, coaxial 30°, ratio 2 : 1 |
| 3 | `제품에 AU만 있을 경우는 RED : OSP, GREEN : AU, BLUE : OSP 를 기준으로 맞추기.` | If the product has AU only: set RED against OSP, GREEN against AU, BLUE against OSP |
| 4 | `제품에 OSP와 AU가 함께있는 경우는 조명GV를 OSP기준으로 맞추기.` | If OSP and AU both exist: set the light GV **against OSP** |

`DMG 조명 1번` repeats rule 4 in short form (`제품에 AU와 OSP가 둘 다 있다면 AU를 기준으로 잡기`) —
this sheet is the DMG-only variant where AU is the reference instead of OSP.

---

## 9. `영역 Convention` (area convention) — verbatim

| Area letter | Sub area | Meaning (original) | Meaning |
|---|---|---|---|
| `AU` | `C-Pad` | `피듀셜 마크` | fiducial mark |
| `AU` | `B-Pad` | `버스라인` | bus line |
| `AU` | `L-Pad` | `큰 패드(패턴이 단순한 것, 쉬운영역)` | large pad, simple pattern, “easy” area |
| `OSP` | `C-Pad` | `본딩패드` | bonding pad |
| `OSP` | `B-Pad` | *(empty)* | – |
| `OSP` | `L-Pad` | `실제 OSP 영역` | the actual OSP region |

Note: `Space1…SpaceThick` in `Top 조명 3번` carries the remark
`목단선 GV와 평균 GV가 다를경우 유저마스크를 통해 추가 및 삭제` — when the target-line GV differs from
the average GV, add/remove regions through the user mask (CNODE 93 User Mask).

---

## 10. Worked example of a filled block

`Top 조명 2번` → `UNIT - OSP - C-Pad` (= `GPNODE 1 / PNODE 3 / CNODE 20`) is filled for the reference
product:

| Parameter | RED | GREEN | BLUE |
|---|---|---|---|
| `Bright Defect(TH)` | 235 | 90 | 200 |
| `Bright Defect Margine(TH)` | 0 | 0 | 0 |
| `Bright Defect Size(Pixel)` | 30 | 20 | 40 |
| `Bright Defect Offest(%)` | 0 | 0 | 0 |
| `Bright Defect Offset1 Size(Pixel)` | 0 | 0 | 0 |
| `Bright Defect Offest2(TH)` | 0 | 0 | 0 |
| `Bright Defect Offset2 Size(Pixel)` | 0 | 0 | 0 |
| `Bright Defect Pad Offest(TH)` | 0 | 0 | 0 |
| `Bright Defect Pad Offset Size(Pixel)` | 0 | 0 | 0 |
| `Dark Defect(TH)` | 110 | 20 | 80 |
| `Dark Defect Margine(TH)` | 100 | 0 | 0 |
| `Dark Defect Size(Pixel)` | 10 | 20 | 40 |
| `Dark Defect Offest(%)` | 0 | 30 | 0 |
| `Dark Defect Offset1 Size(Pixel)` | 0 | 70 | 0 |
| `Dark Defect Offest2(TH)` | 105 | 50 | 0 |
| `Dark Defect Offset2 Size(Pixel)` | 15 | 10 | 0 |
| `Dark Defect Pad Offest(TH)` | 0 | 0 | 0 |
| `Dark Defect Pad Offset Size(Pixel)` | 0 | 0 | 0 |
| `Nick Defect GV` | 0 | 0 | 0 |
| `Nick Defect Size(Pixel)` | 0 | 0 | 0 |
| `Protrusion Defect GV` | 0 | 0 | 0 |
| `Protrusion Defect Size(Pixel)` | 0 | 0 | 0 |

Value ranges confirm the column model: TH/margins are in 0–255, sizes in pixels (0–~500), unused
entries are written as `0`.

---

## 11. What can be generated automatically, what cannot

| Template content | Source | Auto-fillable |
|---|---|---|
| Sheet list (side + light set) | `LightSpec.xml` `LightSet/@Index` + `INSPECT_SPEC/{TOP,BOTTOM}/LIGHT<n>` folders | yes |
| `채널` row | fixed (RED/GREEN/BLUE; DMG sheet: Top/Bottom RED) | yes |
| `영역` rows | `GPNODE/PNODE/CNODE` names via `SpecTreeNode.xml` | yes |
| `파라미터` rows | template family list mapped to `ParamKey` (§6) | yes |
| Parameter values | `InspectionSpec.xml` `ValR/ValG/ValB` (R/G/B columns) | yes |
| `검출 불량` text | not stored in any config file (engineering knowledge) | no — carry over from the template |
| `조명 축` | not stored verbatim; closest source is `LightSpec.xml` `Channel/@Index`,`@Value` per colour | partially *(to confirm)* |
| `GV 밝기` | **measured by the user** | no — leave blank |
| Family C mapping (Dummy 8 rows) | unknown `ParamKey` | no — needs mapping |

`조명 축` observations that support a LightSpec link: `Top 조명 2번` RED
`CH 1:5:9:13:17 = 330:110:110:110:110` and `Bottom 조명 2번` RED `CH 16:20 = 10:10`,
GREEN `CH 1:5:9=50:25:25`, BLUE `CH 14:18=150:150` — the `CH n` numbers are the
`Channel/@Index` space of `LightSpec.xml` (the template counts them **1-based**, the XML stores them
0-based), so the row states **which channels are driven for each colour and at what ratio**. The absolute numbers are engineering targets and do not have to equal the
`Channel/@Value` currently stored in the XML, so this row should be treated as reference data, not as a
strict copy of `LightSpec.xml`.

**Status in the tool (2026-09-22).** `SpecParamTool` now implements §11:
* preview: one tab per `SIDE - LIGHT` folder showing exactly the layout below, values resolved from
  `InspectionSpec.xml` and the GV row editable (`src/04-param-sheet.js`, `src/06-render.js`);
* one `Light:` tab per light (= one `<Page>` of the single LightSpec file), channels grouped by LED
  colour, plus the matching `조명 축` row in every parameter sheet (a white-only light such as `LIGHT0`
  shows its White group, since LightSpec does not split a light by camera colour);
* export `Export Parameter Sheet`: drops the real `Parameter_Template.xlsx` onto the tool and it is
  filled cell by cell (value cells only), otherwise a workbook with the same layout is generated;
* every row it could not fill is listed in the export report (unmatched rows, areas missing from the
  template, template areas without data, XML nodes the template does not cover, blanked GV cells).
See `TOOL_ARCHITECTURE.md` for the module map and how the views are rendered.

---

## 12. Open points to confirm

1. **Family C (Dummy “Threshold/Offset2”, 8 rows)** — which `ParamKey`s? (Not in `SpecParameter.xml`.)
2. **`GV 밝기`** — confirmed as manual. The tool leaves the GV cells blank on export (or writes the
   values typed into the preview) and reports them as “fill after measuring”.
3. **`조명 축`** — the tool derives the row from `LightSpec.xml` (enabled channels of the selected page),
   groups the channels by LED colour while keeping `Channel/@Index` (`CH1 5 9` all White, only the angle
   differs) and shows the source file / LightSet / page underneath; still to confirm whether the numbers
   must match `Channel/@Value` and how the template's three colour columns map to the LED colours.
4. **Value cells** — the filled blocks store single numbers per channel, i.e. the `ValR/ValG/ValB`
   of `INSPECTION`. Confirm whether `MASTER`/`SUBMASTER` values (single `Val`) should also be listed
   (family A/B rows map to `INSPECTION` only; e.g. `100`/`600` never appear in the template).
5. **`Dummy - AU - L-Pad`** — family C (8 rows) in `Top 조명 2번` vs family A (22 rows) in
   `Bottom 조명 2번`; which is correct for new products?
6. **Sheet 3 (`DMG 조명 1번`)** — only the RED column pair is used, and no area block is filled in;
   confirm whether DMG areas (`PNODE 1 Align/ROI`, `CNODE 12 DMG`) get parameter blocks in real
   products.
7. **`조명 n번` vs `LIGHT<n>` folder** — **resolved**: one `LightSpec.xml` holds all three lights as
   `Page 0/1/2` (20 channels each), the `INSPECT_SPEC/.../LIGHT<n>/` folder is that page, and the
   template's `조명 n번` sheet is `LIGHT<n-1>`. The tool therefore fills `Top 조명 2번` from
   `LIGHT1` and `Top 조명 3번` from `LIGHT2` by default (the *Template light numbering* option can
   switch to `LIGHT n ↔ 조명 n번` if a machine is numbered differently). `SelectPage` is only the page
   selected on the machine and is never used as the source.
