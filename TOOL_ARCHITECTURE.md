# Tool Architecture — `SpecParamTool`

How this tool is put together, and in particular **how the parsed parameters reach the user's eyes**.
Companion docs: `SPEC_REFERENCE.md` (file roles + key-value dictionaries),
`PARAMETER_TEMPLATE_NOTES.md` (template layout + required parameter set).

---

## 1. Layout: development vs distribution

| Path | Role |
|---|---|
| `index.html` | Development entry point. Loads 8 classic scripts + one stylesheet (works from `file://`, no server, no ES modules). |
| `src/01-dictionaries.js` | Built-in key-value dictionaries + fixed enumerations. |
| `src/02-parse.js` | XML text → parsed model. |
| `src/03-tables.js` | Parsed model → analysis tables (view models). |
| `src/04-param-sheet.js` | Parsed model → parameter sheets (template layout). |
| `src/05-xlsx.js` | xlsx writer, ZIP reader, real-template filling, appending sheets to an existing workbook. |
| `src/06-render.js` | **View layer** — view models → HTML strings. |
| `src/07-api.js` | View assembly + `globalThis.SpecTool` (used by the Node test harness). |
| `src/08-app.js` | App layer: state, file intake, events, exports. |
| `src/styles.css` | All styling (shell + both view styles). |
| `build.py` | `python build.py` → inlines everything into **`SpecParamTool.html`** (the distributable single file). |
| `SpecParamTool.html` | Generated. Copy this one file anywhere; it needs nothing else. |

Rule of thumb: **edit `src/`, never `SpecParamTool.html`** (it is overwritten by `build.py`).

---

## 2. The pipeline

```
  user drops files
        │
        ▼
  ┌─────────────────┐   src/08-app.js   intake / classification
  │ 1. intake       │   LightSpec.xml, one InspectionSpec.xml (only the first is parsed),
  └─────────────────┘   SpecParameter.xml, SpecTreeNode(List).xml, Parameter_Template.xlsx
        │  text / ArrayBuffer
        ▼
  ┌─────────────────┐   src/02-parse.js
  │ 2. parse        │   XML text → parsed model (only raw attribute values,
  └─────────────────┘   no presentation, no DOM)
        │  parsed model { inspects:[{label, rows:[…]}], lights:[…], … }
        ▼
  ┌─────────────────┐   src/03-tables.js  +  src/04-param-sheet.js
  │ 3. model        │   parsed model → view models
  └─────────────────┘   (this is the ONLY thing the user ever sees)
        │  views: [ {kind:"table",…}, {kind:"parameter-sheet",…}, {kind:"light",…} ]
        ├───────────────────────────────┐
        ▼                               ▼
  ┌─────────────────┐            ┌─────────────────┐
  │ 4. view         │            │ 5. export       │
  │ src/06-render.js│            │ src/05-xlsx.js  │
  │ view → HTML     │            │ view → xlsx/csv │
  └─────────────────┘            └─────────────────┘
        │                               │
        ▼                               ▼
  browser DOM (tabs, tables,       .xlsx / .csv
  parameter sheet, light view,     + export report
  report)
```

Why split it this way: preview and export consume **the same view models**, so what you see on screen
is exactly what lands in the workbook. Adding a column means touching the model builder once.

**Intake rules (`classify()` in `src/02-parse.js`, `addFiles()` in `src/08-app.js`).** Only the exact
equipment file names are read — `LightSpec.xml`, `InspectionSpec.xml`, `SpecParameter.xml`,
`SpecTreeNode.xml`, `SpecTreeNodeList.xml` (plus `*.xlsx` as the template); a dropped folder may contain
anything else (`AISpec.xml`, `Application.xml`, `SystemList.xml`, `UserList.csv`, a vendor copy named
`InspectionSpec - 복사본.xml`) and it is ignored. `InspectionSpec` records are listed as
`<SIDE>/<LIGHT<n>>` (the folder names, e.g. `TOP/LIGHT1`; the full path stays the record's label and
sits in the tooltip) and `sortRecords()` orders them `TOP` → `BOTTOM`, then `LIGHT0` → `LIGHT1` →
`LIGHT2`, so **the first entry is the one that gets parsed**.

---

## 3. The two view models

### 3.1 Table view (`src/03-tables.js`)

```js
{ kind:"table", name:"InspectionSpec", header:[…]|null, rows:[[…]],
  cols:[…], merges?:["A1:E1",…], noFilter?:true, sparse?:true, diffCount?:number }
```

Round-trip listings: `Summary`, `InspectionSpec`, `LightSpec` (one row per channel), `Comparison` (one
row per node path × ParamKey × channel, one column per input file, `Consistent` = `Same`/`Diff`),
`Param Dict`, `Node Dict`.

`InspectionSpec` is the exception: instead of a flat header it is **sectioned like the machine screen**
(`header:null`, section rows merged through `merges`, `sparse` so empty cells render blank in the
preview). `buildInspectionInputTable` walks `Unit`/`Dummy` → area (PNODE) → sub-area (CNODE) and emits,
per sub-area, a `No. | Name | Red | Green | Blue` block for the INSPECTION elements, in **ParamKey
order** (the machine's order). Only the `INSPECTION` (R/G/B) parameters are listed: the
`MASTER`/`SUBMASTER` node settings (Common, Mask Inspection, Chain Align, Adjust Mask, …) are not part
of what has to be typed in, and a sub-area without any INSPECTION parameter disappears together with
its headers. Min/max, node ids, descriptions and control types are dropped; duplicated elements of one
node collapse onto one row. `nodeValue()` (`src/04-param-sheet.js`) applies the same rule to the
parameter sheet, so a node without an INSPECTION element leaves its cell blank instead of borrowing
the single MASTER value.

**Light → parameter-area rule (`LIGHT_AREA_RULES`, `lightAreaRule()`, `filterInspectsByLight()`).**
Which areas carry data depends on the light, not on the XML — every `InspectionSpec.xml` lists the same
27 nodes with values everywhere — so the rule is stated explicitly (device knowledge):

| `lightIndex` | Light | PNODE kept |
|---|---|---|
| `0` | Light 1 / `LIGHT0` | none (AI-model inspection, not RuleBase) |
| `1` | Light 2 / `LIGHT1` | `2` (AU) + `3` (OSP) — metal |
| `2` | Light 3 / `LIGHT2` | `5` (NonMetal) — SR |

`buildViews` runs `filterInspectsByLight(parsed, opts)` once, so the parameter sheet, the
`InspectionSpec` sheet, the comparison and the `Summary` are all filtered by construction; when
`opts.lightIndex` is unknown nothing is filtered. `buildParamSheet` additionally skips template areas
outside the rule so they are not reported as "missing data", and both sheets carry the rule as a note.
The `LightSpec` listings are about the light hardware and stay complete.

### 3.2 Parameter sheet view (`src/04-param-sheet.js`)

```js
{ kind:"parameter-sheet", name:"TOP - LIGHT2", sheet:{
    key, side, light, model, variant, dir, files:[],
    axis:{ R, G, B, note, lightSet, file },        // 조명 축, derived from LightSpec
    gvClasses:["AU","OSP","SR","SPACE"],           // GV rows to measure by hand
    blocks:[{ area, g, p, c, family, familyInfo,
              params:[{ label, key, r, g, b, state, kind }],
              present:[…other ParamKeys at this node…] }],
    extras:[{ path, count, keys }],                // XML nodes the template does not cover
    templateMissing:[…],                           // template areas with no data in the files
    notes:[…] } }
```

`state` is what the user needs to judge a row:

| state | badge | meaning |
|---|---|---|
| `ok` | `XML` | read from `INSPECTION@ValR/ValG/ValB` of this file |
| `master` | `M` | the node stores it as `MASTER`/`SUBMASTER` (single value, shown in the RED column) |
| `missing` | `–` | this `ParamKey` is not present at this node in the loaded file |
| `unmapped` | `?` | template family C (Dummy `Threshold`/`Offset2`) — `ParamKey` not confirmed yet |

The sheet is built **per folder** (`INSPECT_SPEC/<model>/<SIDE>/<LIGHT>`), never across models, and the
name is de-duplicated (`TOP - LIGHT2 · TOP - 복사본`, `… · 6ST2001Q01-00`) when needed.

### 3.3 Light view (`src/03-tables.js`)

A LightSpec file holds **every light of the model**: one `Light_Setting`, one `LightSet` (the hardware
setup) and one `<Page>` per light with 20 channels each. `lightsOfSpec(spec)` turns that into one entry
per light (`LIGHT<n>` = `Page n`), and each entry becomes its own view:

```js
{ kind:"light", name:"Light: 6ST2001Q01 · LIGHT2", sheet:{
    file, model, light:"LIGHT2", lightIndex:2, page:"2", pageCount, selPage, camera, enable,
    count:20, on:10, off:10, colors:4, rows:[…channel rows of that page…],
    groups:[{ color:"W", name:"White", items:[{ ch, value, angle, color, chEnable }] }],
    note:"one <Page> per light in LightSpec.xml — LIGHT2 = Page 2 of 3 (20 channels) …" } }
```

`SelectPage` is only the page selected on the machine and is deliberately **not** used as the source;
the `INSPECT_SPEC/.../LIGHT<n>/` folder is what selects `Page n`.

`groupChannels(rows)` is the single grouping helper (order `W, B, G, R`, unknown colours last, sorted by
the raw `Channel/@Index` inside a group) and `lightsOfSpec()` the single light splitter. They are used by:

* the light view (chips per colour group),
* the `조명 축` row of every parameter sheet — taken from the **matching page** (`LIGHT<n>` -> `Page n`),
  `axis.groups` for the on-screen chips and `axis.text` as the flattened text the xlsx export writes.
  LightSpec does not split a light by camera colour, so that row is one full-width list; a white-only
  light (`LIGHT0`) would otherwise show nothing,
* the `LightSpec Grouped` analysis sheet and the light-tab CSV.

So “CH1, CH5, CH9 are all White, only the angle differs” is visible in the display while every chip
keeps its channel number.

**Channel numbering.** `LightSpec` stores `Channel/@Index` **0-based** (`0…19`), while the equipment UI
and `Parameter_Template.xlsx` count **1-based** (`CH 1 … CH 20`). The view model keeps the raw index;
only the presentation shifts, via `CHANNEL_BASE` / `channelNo()` / `channelName()` in
`src/03-tables.js`:

* chips, the `조명 축` row, the `LightSpec` and `LightSpec Grouped` sheets and the CSVs all show the
  1-based number (`CH1` for `@Index 0`);
* the raw 0-based index stays available — in the chip tooltip (`XML @Index 0`) and as its own
  `XML Index (0-based)` column;
* set `CHANNEL_BASE = 0` if the raw file value should be shown instead.

---

## 4. How the parameters are shown to the user

### 4.1 Tabs

`Render.tabs()` builds one tab per view, in pipeline order:

```
Summary | Param: TOP - LIGHT0 | … | Light: 6ST2001Q01 · LIGHT0 | … | InspectionSpec | LightSpec |
LightSpec Grouped | Comparison | Param Dict | Node Dict
```

Class names colour the tab: `k-ps` = parameter sheet (the deliverable), `k-lv` = light view,
`k-tb` = analysis table (the evidence behind both).

### 4.2 Parameter-sheet body — the template layout, on screen

`Render.parameterSheet(sheet, ctx)` reproduces the `Parameter_Template.xlsx` layout row for row:

| Row | On screen | Source |
|---|---|---|
| `채널` | RED / GREEN / BLUE (colour-coded) | fixed |
| `조명 축` | one full-width list, grouped by LED colour, keeping the channel number: `W CH1 360(0°) CH5 120(30°) \| B CH2 30(0°) …` | derived from the light's own `<Page>` in `LightSpec` (the note shows file / `LIGHT<n>` = Page n / channels on) |
| `GV 밝기` | `AU`, `OSP`, `SR`, `SPACE` with **editable inputs** | **measured by the user** — never in the XML |
| `영역` | `UNIT - OSP - C-Pad` + family badge + `G1 ▸ P3 ▸ C20` node path | `SpecTreeNode.xml` names |
| `검출 불량` | intentionally empty | only exists in the template, not in the XML |
| `파라미터` | label × 3 colours + value + state badge | `InspectionSpec.xml` values, template family order |

Below the table the view adds what a flat sheet cannot show:

* **pills** — `16/16 areas shown`, `257 parameter rows`, `233 from XML`, `24 unconfirmed key`
  (from `Render.paramsStats`) so completeness is visible at a glance;
* **notes** — e.g. “Dummy areas use the unconfirmed family C (values left blank)”,
  “no LightSet 0 in the file; LightSet 1 used as the reference”, copy/backup folder warnings;
* **collapsed details** — template areas without data, and XML nodes the template does not cover
  (candidate template additions), each with its `ParamKey` list.

Editing: GV inputs carry `data-gvkey="TOP|LIGHT2|AU" data-ch="R"`. The app layer listens once on the
table container (`input` event, delegated), stores values in `state.gv` and re-renders nothing — so
typing never loses focus or rebuilds the table. `showSaveFilePicker`/download then writes them.

Filtering: the shared search box filters the parameter sheet by area, family, label, `ParamKey` or
value (`ctx.search`), and by row for table views. Rendering never mutates the view model.

### 4.3 The light view — channels grouped by LED colour

`Render.lightView(sheet, ctx)` renders one light - the tab title, a header with the light/page, then
one row per LED colour:

```
Light: 6ST2001Q01 · LIGHT2      LIGHT_SPEC/6ST2001Q01/LightSpec.xml · LIGHT2 = Page 2

LIGHT2   LineScan   10 / 20 channels on   4 colour group(s)   page enabled   machine selection: page 1
    ● White  5   [CH1 0 0°] [CH5 0 30°] [CH9 0 30°] [CH13 0 60°] [CH17 0 60°]
    ● Blue   5   [CH2 180 0°] [CH6 0 30°] …
    ● Green  5   …
    ● Red    5   …
```

* every chip shows the 1-based equipment channel number (`CH1`, `CH5`, …), the value and the angle,
  with the raw `@Index` in the tooltip;
* disabled channels are dimmed (`.chip.off`) and still listed, so the 20-channel layout stays readable;
* the header shows `on / total`, the colour-group count, page enable state and the machine selection;
* a legend explains the grouping, and the search box filters by colour, channel, value or angle.

### 4.4 Export and the report

The **Model Name**, **Side** (`TOP`/`BTM`) and **Light** (`1`/`2`/`3` → the code's `LIGHT0`/`LIGHT1`/
`LIGHT2`) inputs name every export (`<Model>_<SIDE>_LIGHT<n>_<kind>.xlsx`) and drive the parameter
sheet (`applyUiOverrides` in `src/04-param-sheet.js` sets the group's `model`/`side`/`light` before the
sheet and its `조명 축` are built). The **base path** is the export folder: a `showDirectoryPicker`
handle writes straight into it, otherwise the typed path is only recorded and the normal save dialog is
used.

| Button | What it does |
|---|---|
| `Export LightSpec + GV Excel` | **File 1 — Light values + GV.** **With** `Parameter_Template.xlsx` loaded: opens it, patches only the value cells of the matching `Top/Bottom 조명 n번` sheets (formatting, merged cells, GV labels and every untouched cell survive), then `appendTablesToXlsx` adds the `LightSpec` / `LightSpec Grouped` listings. **Without** it: generates a workbook in the same layout (merges, widths, GV rows included) plus the two listings. |
| `Export InspectionSpec Excel` | **File 2 — the inspect parameters:** the `InspectionSpec` listing + the `Comparison`. |
| `Export reference (dict)` | Optional: `Summary` + `Param Dict` + `Node Dict` on their own. |
| `Export Sheet CSV` | The active view as CSV (parameter sheets use the template layout; light views use the grouped channel list). |

The grouping lives in `exportGroups(analysis, paramSheets, opts)` (`src/07-api.js`) so the Node harness
asserts it without a DOM. Every export prints the report described in §4.2 (skipped sheets, unmatched
rows, blanked values, GV cells to measure).

## 4.5 Theme

The tool is **light by default**; the header button toggles `html[data-theme="dark"]` and the choice is
remembered in `localStorage` when the browser allows it (silently ignored on `file://` if blocked).
All colours live in the CSS variables at the top of `src/styles.css` — no component contains a hard-coded
colour, so a new theme only needs a new variable block.

Both exports feed `Render.report()`, which is rendered under the preview and answers “what do I still
have to do by hand?”:

* per sheet: areas filled, cells written, cells blanked, unresolved rows;
* **skipped sheets** with the reason (`조명지침`, `영역 Convention`, and `DMG 조명 1번` — the DMG sheet
  covers both sides and has no matching folder);
* **manual work list**: rows not matched, areas with data but no template block, template areas without
  data, XML nodes outside the template, GV cells left blank, ambiguous folder matches.

---

## 5. Extension points

| I want to… | Touch |
|---|---|
| show one more column in a listing | the builder in `src/03-tables.js` (add header + value cell) |
| add a parameter to a family | `TEMPLATE_FAMILIES` in `src/04-param-sheet.js` (+ the alias table if the template spells it differently) |
| support a new area (`영역`) | `TEMPLATE_AREAS` in `src/04-param-sheet.js` |
| change how a value is displayed | `Render.val` / `numCell` / `badge` / `chip` in `src/06-render.js` |
| group light channels differently | `COLOR_ORDER` + `groupChannels` in `src/03-tables.js` (used by the light view, the axis row and the export) |
| change how lights are split out of a LightSpec file | `lightsOfSpec()` in `src/03-tables.js` (one entry per `<Page>`) |
| change the channel numbering (0- or 1-based) | `CHANNEL_BASE` in `src/03-tables.js` |
| add a whole new view (e.g. a defect summary) | new builder → `Object.assign({kind:"…"}, …)` + a branch in `Render.body()` + tab/legend in `Render.tabs/legend` |
| change GV handling | `ctx.gv` plumbing in `src/08-app.js`, inputs in `Render.gvInput` |
| add a theme | a new `html[data-theme="…"]` variable block in `src/styles.css` |

---

## 6. Verification

```bash
python build.py                 # rebuild SpecParamTool.html after every src/ change

cd tests && npm install         # once
node run-model-tests.js         # parse -> views -> xlsx -> fill the real template (no browser)
python validate_export.py       # re-open both workbooks with openpyxl (independent reader)
node run-browser-tests.js       # full UI on index.html AND SpecParamTool.html (headless Chrome)
```

`tests/README.md` lists the env vars (`SPEC_ROOT`, `TEMPLATE`, `OUT_DIR`, `CHROME`).

The browser test injects a real folder drop (`DataTransfer` with `webkitRelativePath`), so the
`Side`/`Light` derivation, the config inputs (`Model Name` / `Side` / `Light` auto-fill), the parameter
sheets, the GV inputs, the base-path directory and both export paths are covered, and it asserts that no
JS error was logged. Note: automated Chrome cancels real downloads, so the test stubs
`showSaveFilePicker` **and** `showDirectoryPicker` and checks the bytes handed to each writer.

Current state on the FM1 tree: 18 parameter sheets, first sheet `TOP - LIGHT0` → 16/16 template areas,
257 parameter rows, 233 values resolved from the XML, 24 rows in the unconfirmed family C; the real
template is filled in `Top 조명 2번` / `Bottom 조명 2번` (708 cells) and the report lists what still
needs manual work.

### Known limitations

* Only the **first** `InspectionSpec.xml` in the list is parsed; the others stay marked `ignored`
  (remove the first to switch).
* Picking files **individually** loses the folder, so `Side`/`Light` cannot be auto-filled — set the
  `Model Name` / `Side` / `Light` inputs by hand (they decide the parameter sheet and the export name).
* The **base path** is a real export folder only where `showDirectoryPicker` exists (Chrome/Edge);
  elsewhere a typed path is recorded but the save dialog is still used.
