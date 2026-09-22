# PxInventory Spec Files - Structure, Roles and Key-Value Dictionaries

Reference for the `PxInventory` inspection-specification XML set used by the colour-inspection
equipment, and for the companion tool `SpecParamTool.html` (single-file, offline parser + Excel export).

| | |
|---|---|
| **Scope** | `\{BM,FM1,FM2}\PxInventory` trees: `SpecParameter.xml`, `SpecTreeNode(List).xml`, `LIGHT_SPEC/`, `INSPECT_SPEC/` |
| **Analyzed data set** | 70 `InspectionSpec*.xml` files + 12 `LightSpec*.xml` files + the 3 dictionary files found in the tree |
| **Dictionary size** | 82 `ParamKey` entries (EN + KR), 2 GPNODE, 6 PNODE, 34 CNODE names |
| **Documented on** | 2026-09-22 |
| **Companion tool** | `SpecParamTool.html` (v1.1.0) - built-in dictionaries, export to multi-sheet `xlsx` / `csv` |

> All dictionaries in this document were extracted verbatim from `SpecParameter.xml` and
> `SpecTreeNode.xml`. Everything marked *(observed)* was cross-checked against the real spec files
> during development; blank cells mean "not verifiable from the analyzed set", not "invalid".

---

## 1. File inventory and roles

| File | Location pattern | Role | Defines | Used by |
|---|---|---|---|---|
| `SpecParameter.xml` | `PxInventory/SpecParameter.xml` | Localisation dictionary: numeric parameter key to display name | `ParamKey` -> text, per `stringpack` language (`English`, `Korea`) | `InspectionSpec.xml` (`ParamKey` attributes), operator UI |
| `SpecTreeNode.xml` | `PxInventory/SpecTreeNode.xml` | Node-name dictionary for the three node levels | GPNODE / PNODE / CNODE ID -> name (+ display colour) | `InspectionSpec.xml` (node `ID` attributes), `SpecTreeNodeList.xml` |
| `SpecTreeNodeList.xml` | `PxInventory/SpecTreeNodeList.xml` | Enabling matrix: which node combinations are valid per unit type | GPNODE -> allowed PNODE -> allowed CNODE | editor / tree view; **not** needed for value export |
| `LightSpec.xml` | `LIGHT_SPEC/<MODEL>/LightSpec.xml` | Illumination recipe: light set, pages and per-channel brightness | light hardware settings (no `ParamKey` space) | inspection station lighting, spec comparison |
| `InspectionSpec.xml` | `INSPECT_SPEC/<MODEL>-<seq>/{TOP,BOTTOM}/LIGHT<n>/InspectionSpec.xml` | The actual inspection thresholds per node and per parameter | one value set per MASTER / SUBMASTER / INSPECTION element | inspection engine; the unit under change control |
| `Application.xml`, `SystemList.xml`, `UserList.csv` | `PxInventory/` | Machine / user configuration for the application shell | - | out of scope for this reference |
| `3DSpec.xml`, `AISpec.xml`, `AlignSpec.xml`, `DefectMask.xml`, `LaserMarking.xml`, `SRShift.xml`, `UserMask.xml` | `INSPECT_SPEC/<MODEL>-<seq>/{TOP,BOTTOM}/` | Per-feature side specs that live beside `InspectionSpec.xml` | - | out of scope; the tool ignores them |

**Naming convention**

- `6ST2001Q01` = model id; `6ST2001Q01-00` = model + revision used by `INSPECT_SPEC`.
- `TOP` / `BOTTOM` = board side; `LIGHT0` / `LIGHT1` / `LIGHT2` = illumination channel index (matches `LightSet/@Index` in `LightSpec.xml`).
- Only files whose name contains `LightSpec` or `InspectionSpec` (and the two dictionaries) are read by the tool.

---

## 2. How the files relate (join map)

```
SpecParameter.xml                 SpecTreeNode.xml                 SpecTreeNodeList.xml
  ParamKey -> Text(EN/KR)           gpnode/pnode/cnode ID -> Name     valid gp/pn/cn combinations
        |                                   |                                |
        |  ParamKey annotation              |  node ID annotation            |  validates
        v                                   v                                v
  +-------------------------------------------------------------------------------+
  |                        InspectionSpec.xml  (per side / per light)             |
  |  GPNODE@ID -> PNODE@ID -> CNODE@ID -> { MASTER | SUBMASTER | INSPECTION }     |
  |                                         @ParamKey @ControlType @SpecGroup    |
  |                                         @Val/@MinVal/@MaxVal  (R/G/B)        |
  +-------------------------------------------------------------------------------+
                                        ^
                                        |  same index space (LIGHT<n> = LightSet/@Index)
                                        |
                                  LightSpec.xml
```

| Join | Key | Provided by | Consumed by |
|---|---|---|---|
| Parameter name for a value row | `ParamKey` | `SpecParameter.xml` (`string/@ParamKey` -> `Text`) | tool table `Param Dict`, `Name (EN)` / `Name (KR)` columns |
| Node name for a value row | GPNODE ID, PNODE ID, CNODE ID | `SpecTreeNode.xml` (`node/@ID` -> `Name`) | tool `Node Path` column, `Node Dict` sheet |
| Group label | `SpecGroup` (0-5) | enumeration documented in the `InspectionSpec.xml` comment, stored on every element | tool `Spec Group` column |
| Edit widget hint | `ControlType` | stored on every element | tool `ControlType` column |
| Enabled / checked flag | `NodeCheck` (PNODE, CNODE) | stored on the node element | tool `NodeCheck P/C` column |
| Light recipe row | `LightSet/@Index` vs the `LIGHT<n>` folder name | `LightSpec.xml` + path | tool `Light` column (derived from the dropped file path) |

---

## 3. Enumerations (fixed key-value pairs)

### 3.1 SpecGroup (in `InspectionSpec.xml`, documented in the file comment)

| Value | Name | Meaning |
|---|---|---|
| `0` | Common | shared / always applied |
| `1` | Mask(Bright) | bright defect mask inspection |
| `2` | Mask(Dark) | dark defect mask inspection |
| `3` | Chain Align | chain alignment |
| `4` | Chain Insp | chain inspection |
| `5` | Line | line inspection |

### 3.2 ControlType

| Value | Meaning |
|---|---|
| `0` | numeric edit box |
| `1` | switch / on-off |

### 3.3 NodeCheck (PNODE, CNODE) and Enable (LightSet, Page, Channel)

| Value | Meaning |
|---|---|
| `0` | node excluded from inspection / channel off |
| `1` | node included in inspection / channel on |

### 3.4 CameraType (`LightSpec.xml`, `LightSet/@CameraType`)

| Value | Meaning |
|---|---|
| `0` | LineScan (all analyzed files) |
| `1` | AreaScan |

### 3.5 Channel Color (`LightSpec.xml`, `Channel/@Color`)

| Value | Meaning |
|---|---|
| `W` | White |
| `B` | Blue |
| `G` | Green |
| `R` | Red |

---

## 4. `SpecParameter.xml` - parameter dictionary

Structure: `<pixel Version="1.0">` -> one `<stringpack LangCode LangName>` per language ->
`<string ParamKey Text>` entries. The tool reads every `stringpack` whose `LangName` contains
`English` or `Korea`, so adding a language pack needs no code change.

| ParamKey | Name (EN) | Name (KR) | SpecGroup *(observed)* | Present in analyzed set |
|---|---|---|---|---|
| `100` | Common | 공통 | 0 Common | yes |
| `101` | Mask Inspection(Bright) | 마스크 검사(밝은불량) | 1 Mask(Bright) | yes |
| `102` | Mask Inspection(Dark) | 마스크 검사(어두운불량) | 2 Mask(Dark) | yes |
| `103` | Chain Align | 체인 정렬 | 3 Chain Align | yes |
| `104` | Chain Inspection | 체인 검사 | 4 Chain Insp | yes |
| `105` | Max Width Size | 최대 선폭 크기 |  | yes |
| `106` | Max Pad Size | 최대 패드 크기 | 0 Common | yes |
| `107` | Circularity | 원형도 | 0 Common | yes |
| `108` | Line Inspection | 라인 검사 |  | no |
| `500` | Adjust Mask | 마스크 영역 조정 | 0 Common | yes |
| `501` | Adjust Margin Mask | 마진 영역 조정 | 0 Common | yes |
| `502` | Remove Metal Edge | 메탈 경계 제거 | 0 Common | yes |
| `503` | Remove SR Edge | SR 경계 제거 | 0 Common | yes |
| `504` | Remove Hole Edge | Hole 경계 제거 | 0 Common | yes |
| `505` | Remove VIA Edge | VIA 경계 제거 |  | no |
| `506` | Cell Block Size | Cell 블럭 개수 |  | no |
| `507` | Remove Open Edge | Open 경계 제거 |  | no |
| `508` | Edge Thickness | Edge 두께 |  | no |
| `509` | Remove Etch Edge | Etch 경계 제거 |  | no |
| `600` | Adjust Inner Chain(Align) | 내부 체인 영역 조정 (Align) | 3 Chain Align | yes |
| `601` | Adjust Outer Chain(Align) | 외부 체인 영역 조정 (Align) | 3 Chain Align | yes |
| `602` | Inner Chain Weight(Align) | 내부 체인 가중치 (Align) | 3 Chain Align | yes |
| `603` | Outer Chain Weight(Align) | 외부 체인 가중치 (Align) | 3 Chain Align | yes |
| `604` | Chain Search Range(Align) | 체인 검색 범위 (Align) | 3 Chain Align | yes |
| `605` | Chain Step(Align) | 체인 스텝 (Align) | 3 Chain Align | yes |
| `606` | Chain Search TH(Align) | 체인 검색 GV (Align) | 3 Chain Align | yes |
| `607` | Adjust Inner Chain(Insp) | 내부 체인 영역 조정 (Insp) | 3 Chain Align | yes |
| `608` | Adjust Outer Chain(Insp) | 외부 체인 영역 조정 (Insp) | 3 Chain Align | yes |
| `609` | Chain Skip(Align) | 체인 스킵(Align) |  | no |
| `610` | Chain Align Algo(1/2) | 체인 정렬 방법(1/2) |  | no |
| `701` | Min Skeleton Length | 최소 라인 길이 |  | no |
| `702` | Min Skeleton Width |  |  | no |
| `703` | Min Skeleton Area |  |  | no |
| `900` | Channel Align | 채널 정렬 |  | no |
| `901` | Align Offset X(Pixel) | 얼라인 오프셋 X(Pixel) |  | no |
| `902` | Align Offset Y(Pixel) | 얼라인 오프셋 Y(Pixel) |  | no |
| `1000` | Bright Defect(TH) | 밝은불량(절대값) | 1 Mask(Bright) | yes |
| `1001` | Bright Defect Margine(TH) | 마진 밝은불량(절대값) | 1 Mask(Bright) | yes |
| `1002` | Bright Defect Size(Pixel) | 밝은불량 크기(TH) | 1 Mask(Bright) | yes |
| `1003` | Bright Defect Offest1(%) | 밝은불량 Offest1(TH) | 1 Mask(Bright) | yes |
| `1004` | Bright Defect Offset1 Size(Pixel) | 밝은불량 Offset1 크기(Pixel) | 1 Mask(Bright) | yes |
| `1005` | Bright Defect Offest2(TH) | 밝은불량 Offest2(TH) | 1 Mask(Bright) | yes |
| `1006` | Bright Defect Offset2 Size(Pixel) | 밝은불량 Offset2 크기(Pixel) | 1 Mask(Bright) | yes |
| `1007` | Bright Defect Pad Offest(TH) | 밝은불량 Pad Offest(TH) | 1 Mask(Bright) | yes |
| `1008` | Bright Defect Pad Offset Size(Pixel) | 밝은불량 Pad Offset 크기(Pixel) | 1 Mask(Bright) | yes |
| `1009` | Dark Defect(TH) | 어두운불량(절대값) | 2 Mask(Dark) | yes |
| `1010` | Dark Defect Margine(TH) | 마진 어두운불량 (절대값) | 2 Mask(Dark) | yes |
| `1011` | Dark Defect Size(Pixel) | 어두운불량 크기(Pixel) | 2 Mask(Dark) | yes |
| `1012` | Dark Defect Offset1(%) | 어둔운불량 Offset1(TH) | 2 Mask(Dark) | yes |
| `1013` | Dark Defect Offset1 Size(Pixel) | 어두운불량 Offset1 크기(Pixel) | 2 Mask(Dark) | yes |
| `1014` | Dark Defect Offset2(TH) | 어둔운불량 Offset2(TH) | 2 Mask(Dark) | yes |
| `1015` | Dark Defect Offset2 Size(Pixel) | 어두운불량 Offset2 크기(Pixel) | 2 Mask(Dark) | yes |
| `1016` | Dark Defect Pad Offset(TH) | 어둔운불량 Pad Offset(TH) | 2 Mask(Dark) | yes |
| `1017` | Dark Defect Pad Offset Size(Pixel) | 어두운불량 Pad Offset 크기(Pixel) | 2 Mask(Dark) | yes |
| `1018` | Bright Defect Size(%) | 밝은불량 크기(%) |  | yes |
| `1019` | Dark Defect Size(%) | 어두운불량 크기(%) |  | yes |
| `1020` | Block Bright Defect Offset(TH) | 블럭 밝은불량 Offset(TH) |  | no |
| `1021` | Block Bright Size(Pixel) | 블럭 밝은불량 크기(Pixel) |  | no |
| `1022` | Block Dark Offset(TH) | 블럭 어두운불량 Offset(TH) |  | no |
| `1023` | Block Dark Size(Pixel) | 블럭 어두운불량 크기(Pixel) |  | no |
| `1024` | Min Defect Size(Pixel) | 최소 불량 크기(Pixel) | 0 Common | yes |
| `1030` | Nick Defect GV | 결손 불량 GV | 4 Chain Insp | yes |
| `1031` | Nick Defect Size (Pixel) | 결손 불량 크기(Pixel) | 4 Chain Insp | yes |
| `1032` | Protrusion Defect GV | 돌기 불량 GV | 4 Chain Insp | yes |
| `1033` | Protrusion Defect Size(Pixel) | 돌기 불량 크기 (Pixel) | 4 Chain Insp | yes |
| `1034` | In-Range Defect Min(TH) | In-Range 불량 최소값(TH) | 0 Common | yes |
| `1035` | In-Range Defect Max(TH) | In-Range 불량 최대값(TH) | 0 Common | yes |
| `1036` | In-Range Defect Size(Pixel) | In-Range 불량 크기(Pixel) | 0 Common | yes |
| `1070` | Skeleton Threshold (short) | Skeleton Threshold (short) |  | no |
| `1071` | Skeleton Width(%) (short) | Skeleton Width(%) (short) |  | no |
| `1072` | Skeleton Defect Length (short) | Skeleton Defect Length (short) |  | no |
| `1073` | Skeleton Threshold (Open) | Skeleton Threshold (Open) |  | no |
| `1074` | Skeleton Width(%) (Open) | Skeleton Width(%) (Open) |  | no |
| `1075` | Skeleton Defect Length (Open) | Skeleton Defect Length (Open) |  | no |
| `1090` | Cross Point TH GV | Cross Point 이진화 GV | 0 Common | yes |
| `1091` | SR Shift Edge GV | SR Shift 에지 GV | 0 Common | yes |
| `1092` | SR Shift Size (um) | SR Shift 크기(um) | 0 Common | yes |
| `1100` | Cell ID | 셀 아이디 | 0 Common | yes |
| `1101` | Barcode Area Left | 바코드 영역 좌측 | 0 Common | yes |
| `1102` | Barcode Area Top | 바코드 영역 상단 | 0 Common | yes |
| `1103` | Barcode Area Right | 바코드 영역 우측 | 0 Common | yes |
| `1104` | Barcode Area Bottom | 바코드 영역 하단 | 0 Common | yes |

### 4.1 Notes

- **58 of 82 keys** in the dictionary were found in the analyzed `INSPECT_SPEC` set.
- Keys defined but **not present** in the analyzed set (24): `108`, `505`, `506`, `507`, `508`, `509`, `609`, `610`, `701`, `702`, `703`, `900`, `901`, `902`, `1020`, `1021`, `1022`, `1023`, `1070`, `1071`, `1072`, `1073`, `1074`, `1075`.
- Keys observed in the analyzed set but **missing** from the dictionary: none.
- Language packs are not perfectly symmetric: the `Korea` pack does **not** define `702` / `703`
  (their `Name (KR)` cell stays empty), and it repeats the English text for the six Skeleton keys
  `1070`-`1075`. All other keys have distinct EN and KR names.
- `ParamKey` is a flat integer space, not a tree: the same key can appear under different nodes with
  different values (e.g. `1000` is defined per CNODE and per light), and one key can appear both as
  `MASTER` and as `INSPECTION` (e.g. `600` and `100`).
- Key numbering groups are semantic: `1xx` inspection switches, `5xx` mask / edge removal, `6xx` chain
  alignment, `7xx` skeleton / line, `9xx` channel alignment, `10xx` defect thresholds, `11xx` cell / barcode.

---

## 5. `SpecTreeNode.xml` - node dictionary

Structure: three child groups under `<pixel>` - `<gpnode>`, `<pnode>`, `<cnode>` - each holding
`<node ID Name Color>` entries. The `Color` attribute is a `R,G,B` display colour and is not used by
the export.

### 5.1 GPNODE (equipment / unit level)

| ID | Name | Color | Observed in INSPECT_SPEC |
|---|---|---|---|
| `1` | Unit | 90,110,250 | yes |
| `2` | Dummy | 90,110,250 | yes |

### 5.2 PNODE (process level, child of GPNODE)

| ID | Name | Observed in INSPECT_SPEC |
|---|---|---|
| `1` | Align / ROI | yes |
| `2` | AU | yes |
| `3` | OSP | yes |
| `4` | Drill | yes |
| `5` | NonMetal | yes |
| `6` | ETC | yes |

### 5.3 CNODE (structure / feature level, child of PNODE)

| ID | Name | Observed in INSPECT_SPEC |
|---|---|---|
| `10` | Metal | yes |
| `11` | SR | yes |
| `12` | DMG | yes |
| `20` | C-Pad | yes |
| `21` | B-Pad | yes |
| `22` | L-Pad | yes |
| `40` | Hole | yes |
| `41` | Vent | no |
| `50` | SR All | yes |
| `51` | Pattern1 | yes |
| `52` | Pattern2 | yes |
| `53` | Pattern3 | yes |
| `54` | PatternThick | yes |
| `55` | Space1 | yes |
| `56` | Space2 | yes |
| `57` | Space3 | yes |
| `58` | Space4 | yes |
| `59` | Space5 | no |
| `60` | Space6 | yes |
| `61` | SpaceThick | yes |
| `62` | Open1 | yes |
| `63` | Open2 | yes |
| `64` | Open3 | no |
| `65` | EtchBack | yes |
| `66` | F2F1 | no |
| `67` | F2F2 | no |
| `68` | VIA | yes |
| `69` | Under Cut | no |
| `70` | DAM | no |
| `80` | Laser Marking | yes |
| `90` | SR Shift | yes |
| `91` | Barcode | yes |
| `92` | OCR | no |
| `93` | User Mask | yes |

---

## 6. `SpecTreeNodeList.xml` - valid node combinations

Structure: `<pixel><system>` -> `<gpnode ID>` -> `<pnode ID>` -> `<cnode ID/>` leaves.
It is a whitelist for the editor: a node that is not listed for a unit type is not offered
(and normally does not appear in that unit's `InspectionSpec.xml`). Values:

```
GPNODE 1 (Unit)
  PNODE 1 (Align / ROI) -> CNODE 10 Metal, 11 SR, 12 DMG
  PNODE 2 (AU)          -> CNODE 20 C-Pad, 21 B-Pad, 22 L-Pad
  PNODE 3 (OSP)         -> CNODE 20 C-Pad, 21 B-Pad, 22 L-Pad
  PNODE 4 (Drill)       -> CNODE 40 Hole, 41 Vent
  PNODE 5 (NonMetal)    -> CNODE 50 SR All, 51 Pattern1, 54 PatternThick, 55 Space1,
                           61 SpaceThick, 62 Open1, 65 EtchBack, 80 Laser Marking
  PNODE 6 (ETC)         -> CNODE 93 User Mask
GPNODE 2 (Dummy)
  PNODE 2 (AU)          -> CNODE 20 C-Pad, 22 L-Pad
  PNODE 4 (Drill)       -> CNODE 40 Hole, 41 Vent
  PNODE 5 (NonMetal)    -> CNODE 50 SR All, 51 Pattern1, 55 Space1, 62 Open1, 63 Open2
  PNODE 6 (ETC)         -> CNODE 90 SR Shift, 91 Barcode, 93 User Mask
```

---

## 7. `LightSpec.xml` - illumination recipe

### 7.1 Element tree

```
pixel[@Version]
└─ Light_Setting[@LightSetCount]
   └─ LightSet[@Index @CameraType @PageCount @SelectPage @Enable]
      └─ Page[@Index @ChannelCount @Enable]
         └─ Channel[@Index @Value @Angle @Color @Enable]
```

### 7.2 Attributes

| Element | Attribute | Meaning |
|---|---|---|
| `Light_Setting` | `LightSetCount` | number of light sets the machine knows (the analysed files declare 2 but store 1) |
| `LightSet` | `Index` | hardware light-set number; `1` in every analysed file (it is **not** the light number) |
| `LightSet` | `CameraType` | 0 = LineScan, 1 = AreaScan |
| `LightSet` | `PageCount` | number of pages = **number of lights of the model** (3 in every analysed file) |
| `LightSet` | `SelectPage` | page currently selected on the machine - informational only, **not** the light the INSPECT folder belongs to |
| `LightSet` | `Enable` | set active flag |
| `Page` | `Index` | **the light number**: `Page 0` = `LIGHT0`, `Page 1` = `LIGHT1`, `Page 2` = `LIGHT2` - this is what the `INSPECT_SPEC/.../LIGHT<n>/` folder refers to |
| `Page` | `ChannelCount` | number of channels in the page (20 in every analyzed file) |
| `Channel` | `Index` | channel number, **0-based in the XML**; the equipment UI and the template count 1-based, so the tool displays `@Index + 1` (see `TOOL_ARCHITECTURE.md` §3.3) |
| `Channel` | `Value` | brightness / intensity level (0-600 in the analyzed files) |
| `Channel` | `Angle` | illumination angle in degrees (0, 30, 60) |
| `Channel` | `Color` | W / B / G / R |
| `Channel` | `Enable` | 0 = channel off (`Value` then normally 0), 1 = on |

### 7.3 Notes

- **One file = every light of the model.** All analysed files contain a single `LightSet` with three
  `Page` elements (3 x 20 = 60 channels), i.e. `LIGHT0` / `LIGHT1` / `LIGHT2`. Only the `InspectionSpec`
  files are stored per light (`INSPECT_SPEC/<MODEL>-<seq>/<SIDE>/LIGHT<n>/`), so the pairing is
  `Page n` <-> `LIGHT<n>` folder. `Parameter_Template.xlsx` calls the same three lights
  `조명 1번 / 2번 / 3번`, i.e. the sheet `조명 n번` is filled from `LIGHT<n-1>`.
- The channel list is fixed at 20 entries per page; a channel with `Enable="0"` still occupies its row.
- One `Channel` row = one export row in the tool's `LightSpec` sheet (which carries both the 1-based
  `Channel` and the raw `XML Index`); `LightSpec Grouped` is the same data re-ordered by LED colour
  (White / Blue / Green / Red) keeping the channel number (`CH1 CH5 CH9 …`), and the light view in the
  UI shows exactly that grouping as chips.
- The analyzed files always used `CameraType="0"`, `PageCount="3"`, 20 channels per page.

### 7.4 Sample

```xml
<LightSet Index="1" CameraType="0" PageCount="3" SelectPage="2" Enable="1">
  <Page Index="1" ChannelCount="20" Enable="1">
    <Channel Index="1" Value="30"  Angle="0" Color="B" Enable="1"></Channel>
    <Channel Index="5" Value="10"  Angle="30" Color="B" Enable="1"></Channel>
    <Channel Index="6" Value="75"  Angle="30" Color="G" Enable="1"></Channel>
  </Page>
</LightSet>
```

---

## 8. `InspectionSpec.xml` - the value set (unit under change control)

### 8.1 Element tree

```
pixel[@Version]
└─ GPNODE[@ID]
   └─ PNODE[@ID @NodeCheck]
      └─ CNODE[@ID @NodeCheck]
         ├─ MASTER    [@ParamKey @ControlType @SpecGroup @Val @MinVal @MaxVal @Description]
         ├─ SUBMASTER [@ParamKey @ControlType @SpecGroup @Val @MinVal @MaxVal @Description]
         └─ INSPECTION[@ParamKey @ControlType @SpecGroup
                       @ValR @MinValR @MaxValR
                       @ValG @MinValG @MaxValG
                       @ValB @MinValB @MaxValB @Description]
```

### 8.2 Element meaning

| Element | Level | Value model | Meaning |
|---|---|---|---|
| `GPNODE` | unit | - | equipment / unit node, ID resolved through `SpecTreeNode.xml` |
| `PNODE` | process | `NodeCheck` | process node (Align/ROI, AU, OSP, Drill, NonMetal, ETC) |
| `CNODE` | feature | `NodeCheck` | structure node (Metal, SR, C-Pad, Hole, ...) - the owner of the parameters |
| `MASTER` | parameter | single `Val` + `MinVal` / `MaxVal` | master (global) parameter of the CNODE |
| `SUBMASTER` | parameter | single `Val` + `MinVal` / `MaxVal` | per-condition master parameter (e.g. chain align vs chain insp) |
| `INSPECTION` | parameter | `ValR`/`ValG`/`ValB` + `MinVal*` / `MaxVal*` | inspection threshold, one value **per colour channel** |

### 8.3 Attribute reference

| Attribute | Applies to | Meaning |
|---|---|---|
| `ParamKey` | MASTER / SUBMASTER / INSPECTION | FK into `SpecParameter.xml` |
| `ControlType` | MASTER / SUBMASTER / INSPECTION | 0 = edit, 1 = switch |
| `SpecGroup` | MASTER / SUBMASTER / INSPECTION | 0-5, see 3.1; stored per element, not in the dictionary |
| `Val` | MASTER / SUBMASTER | current value |
| `MinVal` / `MaxVal` | MASTER / SUBMASTER | allowed range / clamp of the value |
| `ValR`, `ValG`, `ValB` | INSPECTION | value for the R / G / B channel |
| `MinValR/G/B`, `MaxValR/G/B` | INSPECTION | min / max per channel |
| `Description` | all | free text annotation written by the station (e.g. `ID`, `Left`, `Top`) |
| `NodeCheck` | PNODE / CNODE | 0 = node excluded, 1 = included |

### 8.4 Value model

- All values are decimal **strings** with 5-6 fractional digits (`"220.00000"`, `"25127.80078"`).
- `MASTER` / `SUBMASTER` carry exactly one value, so the tool maps them to the `R` channel and leaves
  `ValG` / `ValB` empty; `INSPECTION` carries three (R/G/B).
- A channel value may be absent (`MinValR="0.000000"` with `MaxValR="0.000000"` means "range unused"),
  so the comparison sheet compares only the channels that actually hold a value.
- The same `(node path, ParamKey)` pair therefore produces 1 row (`MASTER`, `SUBMASTER` -> channel `V`)
  or 3 rows (`INSPECTION` -> channels `R`, `G`, `B`).

### 8.5 Sample

```xml
<GPNODE ID="1">
  <PNODE ID="1" NodeCheck="1">
    <CNODE ID="12" NodeCheck="1">
      <INSPECTION ParamKey="1024" ControlType="0" SpecGroup="0"
                  ValR="100.00000" MinValR="0.000000" MaxValR="10000.000000"
                  ValG="35.00000"  MinValG="0.000000" MaxValG="10000.000000"
                  ValB="30.00000"  MinValB="0.000000" MaxValB="10000.000000" Description=""/>
    </CNODE>
  </PNODE>
  <PNODE ID="2" NodeCheck="0">
    <CNODE ID="20" NodeCheck="0">
      <MASTER    ParamKey="100" ControlType="0" SpecGroup="0" Val="0.00000" MinVal="0.000000" MaxVal="1.000000"/>
      <SUBMASTER ParamKey="600" ControlType="0" SpecGroup="3" Val="-3.00000" MinVal="-10.000000" MaxVal="10.000000"/>
    </CNODE>
  </PNODE>
</GPNODE>
```

---

## 9. Tool output mapping (`xlsx` / `csv`)

| Sheet | Rows | Key columns |
|---|---|---|
| `Summary` | parse statistics | file list with row counts, element and SpecGroup distribution, dictionary misses, warnings |
| `InspectionSpec` | **sectioned like the machine screen**: `Unit`/`Dummy` → area (`PNODE`) → sub-area (`CNODE`), then one row per parameter | per sub-area a `No. \| Name \| Value` block (MASTER/SUBMASTER elements) and/or a `No. \| Name \| Red \| Green \| Blue` block (INSPECTION elements), in `ParamKey` order; min/max, node ids, descriptions and control types are dropped |
| `LightSpec` | one row per `Channel` | `File`, `Camera`, `LightSet`, `Pages`, `Sel Page`, `Page`, `Ch Count`, `Channel`, `Color`, `Color Name`, `Angle`, `Value`, `Ch En` |
| `Comparison` | one row per `(node path, ParamKey, channel)` | first columns as above, then one column per input file with the value, `Consistent` = `Same`/`Diff`, `Distinct` = number of distinct values |
| `Param Dict` | `ParamKey`, `Name (EN)`, `Name (KR)` | the dictionary of sheet 4 |
| `Node Dict` | `Node Type`, `ID`, `Name` | the three node dictionaries of sheet 5 |

**Derived columns**

- `Side` = `TOP` / `BOTTOM` extracted from the dropped path; `Light` = `LIGHT<n>` extracted from the path.
- `Node Path` = `G<id> <GPNODE name> ▸ P<id> <PNODE name> ▸ C<id> <CNODE name>`; unknown IDs are shown as `?G12`.
- `Comparison` counts a row as `Diff` when the files being compared hold more than one distinct non-empty value.

**Second output: the parameter sheet** (`Export LightSpec + GV Excel`)

The tool builds the same data in the layout of `Parameter_Template.xlsx` (one sheet per
`SIDE/LIGHT`: `채널` / `조명 축` / `GV 밝기` / `영역` / `검출 불량` / `파라미터` × RED, GREEN, BLUE — see
`PARAMETER_TEMPLATE_NOTES.md`) and writes it as the **first** of the two exported workbooks
(`<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx`) together with the `LightSpec` / `LightSpec Grouped` listings.
If the real `Parameter_Template.xlsx` is dropped onto the tool, that file is filled cell by cell
(value cells only, everything else untouched) and the two listings are appended; otherwise a workbook
with the same layout is generated. GV rows are never parsed — they are typed by the user in the preview
and pumped into the export. The **second** workbook
(`<Model>_<SIDE>_LIGHT<n>_InspectSpec.xlsx`) holds the `InspectionSpec` listing and the `Comparison`;
an optional reference workbook holds `Summary` + the dictionaries. Only the first `InspectionSpec.xml`
in the list is parsed. How the views are built and rendered is described in `TOOL_ARCHITECTURE.md`.

---

## 10. Observations and caveats

1. Every `ParamKey` used in the analyzed set exists in `SpecParameter.xml`, and every node ID used exists
   in `SpecTreeNode.xml` - the two dictionaries are complete for the analyzed data set.
2. CNODE IDs that never appear in the analyzed set: `41`, `59`, `64`, `66`, `67`, `69`, `70`, `92`.
3. `SpecGroup` is **not** part of any dictionary file; it is stored on each element. Rows with the same
   `ParamKey` may legitimately carry different groups (e.g. `600` appears as group `0` and group `3`),
   so the tool always reports the group read from the file.
4. Values are stored with more precision than operators use (5-6 decimals); the tool can round them for
   export, but the `Raw` setting reproduces the file digits exactly.
5. Backup and localised-name copies (`*- 복사본.xml`, `*_bk`, `*.bak`) are present in the trees. They are
   excluded by name, except when they are the only `InspectionSpec*`/`LightSpec*` file in a folder.
6. `SpecTreeNodeList.xml` is an editor whitelist only; it does not carry values and is recorded, not
   exported, by the tool.

---

## 11. Regenerating and verifying

1. The dictionaries are embedded in the tool (`src/01-dictionaries.js`, inlined into
   `SpecParamTool.html` by `python build.py`).
2. To refresh them after a dictionary change, drop the new `SpecParameter.xml` / `SpecTreeNode.xml`
   onto the tool at runtime (they override the built-ins) - no code change required.
3. Verification used during development: `InspectionSpec` row counts per file matched an independent
   XML count (601 + 601 + 598 = 1800 rows for one model/side), 60 `LightSpec` channel rows matched, and
   the generated workbook was re-opened with an independent xlsx reader (6 sheets, numeric cells intact).
   The current harness lives in `tests/` - see `TOOL_ARCHITECTURE.md` §6.

