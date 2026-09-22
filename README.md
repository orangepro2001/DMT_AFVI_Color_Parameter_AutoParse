# AFVI Color Parameter Auto-Parse

Offline tool that reads the inspection-spec XML files of the colour-inspection equipment
(`LightSpec.xml`, `InspectionSpec.xml`, optionally `SpecParameter.xml` / `SpecTreeNode.xml`) and turns
them into the **inspection-technology parameter sheet** — the layout of
`Parameter_Template.xlsx` — plus analysis listings and an Excel export.

Everything runs in the browser: no install, no server, no network, no dependency.
Spec files never leave the machine.

---

## Quick start

1. Download **`SpecParamTool.html`** (or clone the repo and open `index.html`).
2. Open it in Chrome/Edge (double-click the file works — `file://` is fine).
3. Drop the files:
   * `LightSpec.xml` into slot ① — **one file per model, it already contains all three lights**
     (`LIGHT0`/`LIGHT1`/`LIGHT2` = `Page 0/1/2`, 20 channels each),
   * **one** `InspectionSpec.xml` into slot ② (these *are* per light) — only the **first** file in the
     list is parsed; dropping the whole `INSPECT_SPEC` folder still works and fills the `Side`/`Light`
     inputs from the folder path,
   * optionally `Parameter_Template.xlsx` into slot ③ and/or `SpecParameter.xml` + `SpecTreeNode.xml`
     to override the built-in dictionaries.
4. Fill the export config: **Model Name**, **Side** (`TOP` / `BTM`) and **Light** (`1`/`2`/`3`, i.e.
   the code's `LIGHT0`/`LIGHT1`/`LIGHT2` = the `<Page>` used for the `조명 축`). They name the exported
   files and drive the parameter sheet. Optionally pick a **base path** (the export folder — Chrome then
   writes the files straight into it instead of opening a save dialog).
5. Press **Parse Specs**.
6. Review the tabs (below), type the measured **GV** values if you have them.
7. Press **Export LightSpec + GV Excel** and **Export InspectionSpec Excel** (see *Exports*). The report
   under the preview lists everything that still needs manual work.

---

## What you get

| Tab | Content |
|---|---|
| `Summary` | parse statistics, per-file row counts, dictionary misses, warnings |
| `Param: <SIDE> - <LIGHT>` | **the deliverable**: the parameter sheet in the template layout — `채널` / `조명 축` / `GV 밝기` / `영역` / `검출 불량` / `파라미터` × RED, GREEN, BLUE |
| `Light: <model> · LIGHT<n>` | one tab **per light** (each light is a `<Page>` of the single LightSpec file); channels grouped by LED colour with value, angle and on/off |
| `InspectionSpec` | **the transcription table**: `Unit`/`Dummy` → area → sub-area sections, each holding `No. \| Name \| Value` (single-value parameters) and/or `No. \| Name \| Red \| Green \| Blue` (defect parameters), in the machine's own order — min/max and every other XML attribute are dropped |
| `LightSpec` | one row per channel (raw listing, keeps both channel numbers) |
| `LightSpec Grouped` | the same channels re-ordered by LED colour |
| `Comparison` | one row per `node path × ParamKey × channel`, one column per input file, `Same` / `Diff` |
| `Param Dict`, `Node Dict` | the built-in key-value dictionaries |

### Parameter sheet rows

| Row | Filled from | Editable |
|---|---|---|
| `채널` | fixed (RED / GREEN / BLUE) | – |
| `조명 축` | derived from the light's own `<Page>` in `LightSpec.xml` (`LIGHT<n>` = `Page n`), channels grouped by LED colour | – |
| `GV 밝기` | **measured by the user** — never present in any config file | ✔ type it, it is written on export |
| `영역` | `GPNODE - PNODE - CNODE` names from `SpecTreeNode.xml` | – |
| `검출 불량` | only exists in the template (engineering knowledge) | left empty |
| `파라미터` | template family order, values from `InspectionSpec.xml` + state badge | – |

State badges tell you where a value came from: `XML` = `INSPECTION` R/G/B, `M` = single
`MASTER`/`SUBMASTER` value, `–` = not present at that node, `?` = template family C
(Dummy `Threshold`/`Offset2`) whose `ParamKey` is still unconfirmed.

### Exports

Two workbooks (plus an optional reference one), named from the three config inputs
`<Model>_<SIDE>_LIGHT<n>_...xlsx`:

* **Export LightSpec + GV Excel** → `<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx` — the **Light values and
  the GV** in one file: the parameter sheet(s) in the template layout (`조명 축` + `GV 밝기` rows) plus
  the `LightSpec` / `LightSpec Grouped` listings. With `Parameter_Template.xlsx` loaded it is filled
  **cell by cell** (only the value cells are replaced; formatting, merged cells, GV labels and every
  other sheet stay untouched) and the LightSpec listings are appended; without it a same-layout
  workbook is generated.
* **Export InspectionSpec Excel** → `<Model>_<SIDE>_LIGHT<n>_InspectSpec.xlsx` — the `InspectionSpec`
  listing and the `Comparison`.
* **Export reference (dict)** → `<Model>_<SIDE>_LIGHT<n>_Reference.xlsx` — `Summary` + the two
  dictionaries on their own (optional, not part of the pair).
* **Export Sheet CSV** — whatever tab is active.

The exports print a report: sheets that were skipped and why, rows that could not be matched, values
that had to be blanked, GV cells to measure, and XML nodes the template does not cover yet.

---

## Features

* built-in dictionaries from `SpecParameter.xml` (82 `ParamKey` → EN/KR) and `SpecTreeNode.xml`
  (GPNODE / PNODE / CNODE) — only the two spec files are needed; the dictionaries can be overridden
  by dropping the XML files in.
* needs-only-the-necessary-parameters view: the curated parameter families of the template
  (pad/defect 22, structure 15, Laser Marking 4, Dummy 8) in template order.
* light channels grouped by LED colour with value + angle (`CH1 CH5 CH9` are all White, only the angle differs).
* GV row left blank for manual measurement; typed values go into the export.
* two named workbooks (`<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx` / `..._InspectSpec.xlsx`) built from the
  Model / Side / Light inputs, optionally written straight into a chosen base-path folder.
* light theme by default, dark available (`Theme:` button, remembered locally).
* multi-file comparison with `Same`/`Diff` per `node path × ParamKey × channel`.
* single-file distribution: `SpecParamTool.html` works with no other file next to it.

### Channel numbering

`LightSpec` stores `Channel/@Index` **0-based** (`0…19`), while the equipment UI and
`Parameter_Template.xlsx` count **1-based** (`CH 1 … CH 20`). The tool shows the 1-based number
everywhere (`CH1` = `@Index 0`) and keeps the raw index in tooltips and in a
`XML Index (0-based)` column. Change `CHANNEL_BASE` in `src/03-tables.js` to switch.

---

## Repository layout

```
index.html                 development entry point (loads src/*, works from file:// as well)
src/01-dictionaries.js     built-in key-value dictionaries + enumerations
src/02-parse.js            XML text -> parsed model
src/03-tables.js           parsed model -> analysis tables, one light per <Page>, LED grouping, numbering
src/04-param-sheet.js      parsed model -> parameter sheets (template layout)
src/05-xlsx.js             xlsx writer, zip reader, real-template filling
src/06-render.js           view layer (pure: view model -> HTML)
src/07-api.js              view assembly + globalThis.SpecTool (used by the Node tests)
src/08-app.js              app layer: state, intake, events, exports
src/styles.css             both themes, all view styles
build.py                   inlines src/* into the single-file SpecParamTool.html
SpecParamTool.html         generated distributable (do not edit by hand)
tests/                     model tests (Node), workbook validation (openpyxl), UI tests (headless Chrome)
```

Documentation

| File | Content |
|---|---|
| `TOOL_ARCHITECTURE.md` | module map, pipeline, how the parsed parameters are displayed |
| `SPEC_REFERENCE.md` | what each spec file is for, the full key-value dictionaries, XML schemas |
| `PARAMETER_TEMPLATE_NOTES.md` | `Parameter_Template.xlsx` layout, the required parameter set, open points |
| `tests/README.md` | how to run the regression harness |

---

## Build and test

```bash
python build.py                 # rebuild SpecParamTool.html after changing src/

cd tests && npm install         # once: @xmldom/xmldom + puppeteer-core
node run-model-tests.js         # parse -> views -> xlsx -> fill the real template
python validate_export.py       # re-open both workbooks with openpyxl (independent reader)
node run-browser-tests.js       # full UI on index.html and SpecParamTool.html (headless Chrome)
```

`SPEC_ROOT`, `TEMPLATE`, `OUT_DIR` and `CHROME` override the paths used by the tests.

---

## Known limitations

* **Only the first `InspectionSpec.xml` in the list is parsed** — the others stay in the list marked
  `ignored`; remove the first to switch to another one.
* **Files picked individually lose the folder.** The `Side` / `Light` inputs (auto-filled from the
  folder when it is present) then decide the parameter sheet and the export name; without them the
  sheet collapses into `SIDE? - LIGHT?`.
* The **base path** is only usable as a real export folder in Chrome/Edge
  (`showDirectoryPicker`); typing a path in another browser is recorded in the report but the file is
  saved through the normal save dialog.
* Template sheets are matched `조명 n번 ↔ LIGHT<n-1>` (default: `LIGHT0` is `조명 1번` = Page 0). If a
  machine numbers the lights differently, switch the **Template light numbering** option.
* `DMG 조명 1번` covers both sides and cannot be matched to a source folder automatically — the report
  says so; fill it by hand.
* The Dummy family C rows (`Bright/Dark Threshold`, `Bright/Dark Offset2`) have no confirmed
  `ParamKey` yet, so those cells are left blank (see `PARAMETER_TEMPLATE_NOTES.md` §6.4 / §12).
* `조명 축` is the composition of the matching light page grouped by LED colour; `SelectPage` in the
  file is only the machine's current selection and is not used as the source.
