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
| `src/05-xlsx.js` | xlsx writer, ZIP reader, real-template filling. |
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
  │ 1. intake       │   LightSpec.xml, InspectionSpec.xml, SpecParameter.xml,
  └─────────────────┘   SpecTreeNode(List).xml, Parameter_Template.xlsx
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

---

## 3. The two view models

### 3.1 Table view (`src/03-tables.js`)

```js
{ kind:"table", name:"InspectionSpec", header:[…], rows:[[…]],
  cols:[…], diffCount?:number }
```

Round-trip listings: `Summary`, `InspectionSpec` (one row per XML element), `LightSpec` (one row per
channel), `Comparison` (one row per node path × ParamKey × channel, one column per input file,
`Consistent` = `Same`/`Diff`), `Param Dict`, `Node Dict`.

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

```js
{ kind:"light", name:"Light: 6ST2001Q01", sheet:{
    file, model, rows:[…raw channel rows…], totalChannels,
    sets:[{ setIdx, camera, pageCount, selPage, enable,
            pages:[{ page, enable, count, on, off, colors,
                     groups:[{ color:"W", name:"White",
                               items:[{ ch, value, angle, color, chEnable }] }] }] }],
    note:"channels grouped by LED colour; the original Channel/@Index is kept (CH1, CH5, CH9 …)" } }
```

`groupChannels(rows)` is the single grouping helper (order `W, B, G, R`, unknown colours last, sorted by
the raw `Channel/@Index` inside a group). It is used by:

* the light view (chips per colour group),
* the `조명 축` row of every parameter sheet (`axis.cols` for the on-screen chips, `axis.R/G/B` as the
  flattened text the xlsx export writes),
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
Summary | Param: TOP - LIGHT0 | … | Light: 6ST2001Q01 | … | InspectionSpec | LightSpec | LightSpec Grouped | Comparison | Param Dict | Node Dict
```

Class names colour the tab: `k-ps` = parameter sheet (the deliverable), `k-lv` = light view,
`k-tb` = analysis table (the evidence behind both).

### 4.2 Parameter-sheet body — the template layout, on screen

`Render.parameterSheet(sheet, ctx)` reproduces the `Parameter_Template.xlsx` layout row for row:

| Row | On screen | Source |
|---|---|---|
| `채널` | RED / GREEN / BLUE (colour-coded) | fixed |
| `조명 축` | per colour, chips grouped by LED colour keeping the channel index: `W CH1 360(0°) CH5 120(30°)` | derived from `LightSpec` (note shows file / LightSet / page) |
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

`Render.lightView(sheet, ctx)` renders one block per `LightSet`, one section per `Page`, and inside it
one row per LED colour:

```
LightSet 1   LineScan   pages 3   selected page 2   set enabled
  Page 0 — 3 / 20 channels on · 4 colour group(s)
    ● White  5   [CH1 360 0°] [CH5 120 30°] [CH9 120 30°] [CH13 59 60°] [CH17 60 60°]
    ● Blue   5   [CH2 0 0°] [CH6 0 30°] …
    ● Green  5   …
    ● Red    5   …
```

* every chip shows the 1-based equipment channel number (`CH1`, `CH5`, …), the value and the angle,
  with the raw `@Index` in the tooltip;
* disabled channels are dimmed (`.chip.off`) and still listed, so the 20-channel layout stays readable;
* the page header shows `on / total` and the number of colour groups;
* a legend explains the grouping, and the search box filters by colour, channel, value or angle.

### 4.4 Export and the report

| Button | What it does |
|---|---|
| `Export Parameter Sheet` | **With** `Parameter_Template.xlsx` loaded: opens it, patches only the value cells of the matching `Top/Bottom 조명 n번` sheets, writes the file back (formatting, merged cells, GV labels and every untouched cell survive). **Without** it: generates a workbook in the same layout (merges, widths, GV rows included). |
| `Export Excel (analysis)` | The analysis workbook (Summary + listings + comparison + dictionaries). |
| `Export Sheet CSV` | The active view as CSV (parameter sheets use the template layout; light views use the grouped channel list). |

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
`Side`/`Light` derivation, the parameter sheets, the GV inputs and both export paths are covered, and
it asserts that no JS error was logged. Note: automated Chrome cancels real downloads, so the test
stubs `showSaveFilePicker` and checks the bytes handed to the writer.

Current state on the FM1 tree: 18 parameter sheets, first sheet `TOP - LIGHT0` → 16/16 template areas,
257 parameter rows, 233 values resolved from the XML, 24 rows in the unconfirmed family C; the real
template is filled in `Top 조명 2번` / `Bottom 조명 2번` (708 cells) and the report lists what still
needs manual work.

### Known limitation

Picking files **individually** loses the folder, so `Side`/`Light` are unknown and the parameter sheets
collapse into one `SIDE? - LIGHT?` sheet. The file list marks such entries with `no path` and the status
line tells the user to drop the `INSPECT_SPEC` folder (or double-click the label and rename it to
`TOP/LIGHT2`). Dropping a folder preserves paths and everything works.
