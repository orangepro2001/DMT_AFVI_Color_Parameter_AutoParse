# DMT AFVI Color Parameter AutoParse

[English](README.md) | [简体中文](README_CN.md) | [한국어](README_KR.md)

Offline toolchain for the AFVI colour-inspection machines: collect the inspection-spec
XMLs from the machine's three host PCs (**FM1 / FM2 / BM**), browse and edit them in a UI
that mirrors the AFVI Inspect software, export the inspection-technology parameter sheet
(`검사기술파라미터`) as Excel, and copy models between Vision PCs — inside one site or
across sites.

Everything runs locally on Windows. Spec files never leave the machine network unless you
explicitly opt into a cloud database backend.

## Repository map

| Path | What it is |
|---|---|
| `tauri-app/` | **AFVI_Parse** — the desktop app (Tauri 2 + Svelte 5 + Rust). The active product. |
| `dmt-agent/` | Per-site LAN agent daemon that accelerates model scan/copy (single exe, runs as a boot-time scheduled task). |
| `dmt-copy-core/` | Shared Rust crate holding the model-copy domain logic (plan / scan / credentials / protocol / relay) — one implementation used by both the app and the agent. |
| `index.html`, `src/`, `SpecParamTool.html` | Legacy single-file web tool — the origin of the project, still working. |
| `reference/` | Sample `PxInventory` trees (FM1 / FM2 / BM) and `Parameter_Template.xlsx`. |
| `Plan/`, `tools/` | Design notes; a standalone Python light-analysis helper. |

---

# Desktop app: AFVI_Parse

`tauri-app/` — a Tauri 2 desktop app that talks to the real machine shares. It reads the
spec files under each Vision PC's `PxInventory` directory
(`LightSpec.xml`, `InspectionSpec.xml`, `SpecParameter.xml`, `SpecTreeNode.xml`), parses
them into a local model snapshot, and reproduces the layout of the AFVI Inspect software
so operators can switch between the two without relearning.

Tech base: **Svelte 5 runes** (no router library, tabs are always-mounted panels) +
**TypeScript** + **Vite** on the front end; **Rust** (tokio, mongodb, reqwest, image) on
the back end; XML parsing with `fast-xml-parser` in the webview and shared copy logic in
Rust. Toolchain is pinned (Node 24, Rust 1.91 — enforced by `build_app.bat`).

## Main window

Top navigation: `HOME` / `TEACH` / `REVIEW` / `CALIBRATE` / `COPIER` / `SETTINGS`.
`HOME` and `REVIEW` are placeholders; the other four are live. The center of the window
is the **stage**: model info, the live MEDIAN strip images, a status bar and a log panel.
The right panel hosts the active tab; tabs stay mounted when switched (a running copy
queue and the TEACH selection survive tab changes).

### Center stage — MEDIAN strip images

* Selecting a machine + model loads the live MEDIAN strip images straight from the
  shares — no collect needed: **TOP = FM1** (version folder `2.0`) and **BTM = BM**
  (version `3.5`); FM2 is skipped.
* Version-folder fallback: if the planned version folder is missing, any sibling version
  containing the same relative path is used. Missing model/file is shown as *missing*
  (with the searched paths), an unreachable share root is an error.
* Gigapixel TIFFs are decoded in a worker pool (serialized so both sides never hold two
  giant bitmaps at once), downscaled to 4096 px on the long edge and returned as JPEG.
* Zoom 1×–10×: wheel zoom (anchor-aware), Ctrl+click zoom in/out, drag to pan when
  zoomed, double-click to reset; TOP/BTM switch and per-side LRU cache (6 entries).

### TEACH — parameter tree (mirrors the real software)

* Host select (FM1/TOP-1, FM2/TOP-2, BM/BOTTOM) + device/model display; toolbar
  **Load XML / Save Local / Reload**.
* `Unit` / `Dummy` group tabs + `Light-1 / 2 / 3` tabs, Global Align / SR Align info
  blocks, Overlay checkboxes (MK / A_C / I_C / SK).
* **Coloured node tree**: node names and colours from `SpecTreeNode.xml`, check states
  from `NodeCheck`; Align / ROI subtrees have no checkboxes (like the machine); the
  selected node turns orange-red.
* Three parameter tables: **Master** (`ControlType=1` renders as a textless blue
  toggle), **Submaster** (visible only when the gating Master keys — Chain Align /
  Chain Inspection — are on), and the **inspection table** with Red/Green/Blue tabs
  (`ValR/ValG/ValB`) and a Min column. Parameter names are resolved through the
  `SpecParameter.xml` dictionary (multi-language packs merged, English preferred).
  Numeric input is validated (invalid values highlighted, restored on blur).
* `Load XML` can pull a single `InspectionSpec.xml` into the current Host/Light page or
  a `LightSpec.xml` to refresh the whole host. **Editing only touches the local
  snapshot** (Save Local persists, Reload re-reads with a dirty-state confirm) — the
  production XML on the machine is never written.
* Snapshots in the old flat format (schemaVersion 1) are detected and flagged for
  re-collection.

### CALIBRATE — light calibration

* 20-channel light table (Value / Angle / Color / ON-OFF) from the selected
  `LightSpec.xml` page, pages 1/2/3 plus a global ON/OFF.
* **GV 밝기 entry**: the GV brightness targets are measured by hand and exist in no XML.
  Pages 1/2 show the `AU` and `OSP` rows, page 3 shows `SR` and `Space`; each row has
  RED / GREEN / BLUE cells. Values are free text (`180`, `60 : 50~70`, `X`…), keyed by
  host + page, auto-saved with a 500 ms debounce (failures surface as red text).

### COPIER — model copy between Vision PCs

* Single pair copy (Source/Target each pick Machine + Vision PC) and **one-click full
  machine copy** (FM1→FM1, FM2→FM2, BM→BM in one job; requires two different machines).
* **FM↔BM isolation**: FM1/FM2 and BM never exchange models; on conflict the other side
  is flipped automatically with a notice.
* Model scan of the selected source PC → searchable picker; optional **Rename to**
  (clone/rename — folder name is the model's only identity; requires agent protocol ≥ v2);
  cross-site **Force full transfer** toggle.
* **Preview Copy** builds the plan table (LIGHT_SPEC / INSPECT_SPEC / PxRepository
  entries, source → target paths, existing folders flagged "will be replaced"), then a
  danger dialog requires typing the model name before anything is deleted or copied.
* Sequential job queue (one job at a time, queue/remove/clear), per-job progress (files,
  bytes, current file, relay mode label), cross-site jobs auto-retry once incrementally,
  then fall back to direct SMB (slow path).

### SETTINGS — machines, collection, database, export

* **Machine Configuration**: registers a machine by its Main PC IP; the three Vision PC
  `PxInventory`/`PxRepository` UNC paths are derived automatically (flat-network rule:
  FM1 = IP+1, FM2 = +2, BM = +3; hand-edited fields are kept). Optional **network
  credentials** (username/password) — before scanning/collecting, the Rust side logs
  into each server with `net use …\IPC$` (empty-password accounts supported; error 1219
  is resolved by deleting the stale connection and retrying). Optional **Site LAN
  Agent** (address auto-suggested as `<main_ip>:3777` + token) with a **Test agent**
  button per machine. Stored in `machines.json`.
* **Data Collection**: pick machine + model (the model picker scans all three hosts,
  with filtering), then **Collect & Save**. Collection gathers per host:
  `LIGHT_SPEC/<model>/LightSpec.xml`, `INSPECT_SPEC/<model>/{TOP|BOTTOM}/LIGHT0..2/InspectionSpec.xml`,
  plus optional `SpecParameter.xml` / `SpecTreeNode.xml`; the three hosts run in
  parallel and all three must succeed. If a snapshot already exists it is loaded and
  applied to TEACH/CALIBRATE immediately, the button degrades to *Re-collect
  (optional)* and an *Open TEACH* shortcut appears. Selecting a model also publishes the
  stage target for the center images.
* **Database**: swap the backend between `local` (JSON files, default), `mongodb`
  (Atlas-compatible) and `firestore` (Firebase) — connection details editable in place,
  **Test Connection**, **Migrate Local Data → …** (idempotent upsert with a report) and
  **Save & Apply**. Config lives in `storage.json` (app-data). Reads fall back to the
  local JSON backup whenever the remote backend fails, so a network blip never blanks
  the UI. Firestore documents over the 1 MiB limit are sharded (700 KB chunks,
  transparent reassembly). All storage commands are async + `spawn_blocking` — the UI
  never freezes on a slow database.
* **Export Parameter Excel (검사기술파라미터)**: export path + template workbook path are
  configured once (stored in `ui/export-config.json`; export refuses with a clear
  message when unset).

## Data model & local files

A collected model becomes a **snapshot** (`StoredModelRecord`, schemaVersion 2) holding
`machine / modelName / collectedAt` and a `hosts {FM1, FM2, BM}` map, each host with its
root path, side, parsed `lightSpec`, alignment info, the `ParamKey → name` parameter
dictionary, the GP/P/C node-tree dictionary, and the full `GPNODE → PNODE → CNODE`
inspection tree with MASTER / SUBMASTER / INSPECTION leaves (`Val/ValR/ValG/ValB/Min`).

Local database layout (Tauri app-data directory; the local backend *is* this folder):

```
storage.json                       storage backend config
machines.json                      machine list (incl. optional credentials + agent)
models/<machineId>/<model>.json    model snapshot (schemaVersion 2)
ui/active-selection.json           currently selected machine/model
ui/teach-selection.json            TEACH page selection path
ui/gv/<machineId>/<model>.json     manually measured GV values
ui/export-config.json              Excel export path / template path
```

The two sides meet at a single storage seam each — `DocumentStoreClient` (TS,
`src/lib/document-store.ts`) and the `DocumentStore` trait (Rust, `storage.rs`) — so
adding a backend touches neither the features nor the UI.

## Excel export (검사기술파라미터)

`export_parameter_excel` rewrites **only the value cells** inside the template's
worksheet XML — styles, merged cells, print setup and all other sheets are preserved
byte-for-byte, because the file is parsed by an upload server. Output:
`<Machine>_<Model>.xlsx` (e.g. `AFVI14_6ST2001Q01.xlsx`).

Fill rules (device knowledge, same rule set as the legacy tool's `LIGHT_AREA_RULES`):

* Workbook naming (FM1/FM2 managed separately since 2026-09): `Top1-Light2/3` (FM1),
  `Top2-Light2/3` (FM2), `Bottom-Light2/3` (BM), `DMG 조명 1번`; the old Korean names
  (`Top 조명 2번`…) still match (FM1 first).
* **GV page alignment**: each 조명 sheet reads the GV of its own light page (light N →
  Calibrate page N), fixing the earlier bug where Light2 read page 1.
* `DMG 조명 1번` (LIGHT0): no INSPECTION parameters — GV only (Top-RED / Bottom-RED)
  plus the **white-light axis ratio** computed from the LightSpec channels (enabled
  channels grouped by angle, peak per angle, reduced by GCD — e.g. `White 0 : 30 = 3 : 1`).
* `Light2` (LIGHT1): only the AU (PNODE 2) and OSP (PNODE 3) area blocks; the Laser
  Marking block is blanked by rule. `Light3` (LIGHT2): only NonMetal (PNODE 5) blocks.
* The `조명 축` row is auto-filled with the axis ratio; B/D/F columns get the matching
  colour light (White fallback on B when a colour is absent); disabled channels skipped.
* **Node-tree completion**: area blocks present in the data but missing from the template
  are appended at the sheet end (style cloned from the sheet's first block, values
  matched by ParamKey); parameters beyond the family are appended as trailing rows.
* Label matching tolerates template spelling variants (Offest/Offset, (Size)/(Pixel)…)
  via an alias table + dictionary resolution in both directions.
* The export returns a report: filled / blanked / GV / axis cells, appended areas and
  unresolved labels; GV/path save failures are surfaced instead of swallowed (writes to
  Firestore that fail land in the local files and are pushed by the next migration).

## Site LAN agent (model copy & scan acceleration)

When the desktop is outside the site LAN and only reachable through Tailscale subnet
routing, SMB's high round-trip time makes model copy and scanning crawl. Deploy
**`dmt-agent`** once per site (site main PC): the desktop sends the control requests
over Tailscale, the agent executes the scan and the machine-to-machine copy inside the
real site LAN at gigabit speed — **the data never leaves the site** — and streams
per-file progress back to the Model Copier progress bars.

* Domain logic (copy plan, delete guards, scanning, `net use` credentials, wire
  protocol) lives in the shared crate `dmt-copy-core`; the agent and the desktop's
  direct-SMB fallback use the same implementation.
* Wire protocol: TCP + NDJSON on port **3777**, first frame must authenticate with the
  shared token (constant-time compare). Protocol **v3** — v2 added rename-on-copy,
  v3 added the cross-site relay; the desktop refuses to send newer features to older
  agents.
* Ops: `ping` (Test agent button), `scan_models`, `copy` (same-site), `copy_cross_site`
  (source-site agent pushes to the target-site agent), `tcp_relay_push` (TCP data
  plane when UDP is blocked).
* **Channel selection** (automatic): both machines configured with the *same* agent
  address → same-site agent; *different* addresses → cross-site QUIC relay (one
  incremental retry, then direct-SMB fallback); either side unconfigured → direct SMB,
  exactly as before.
* Cross-site transport: QUIC (quinn/rustls, UDP 3777, 6 streams, zstd per file,
  incremental skip by size+mtime, staging dirs cleaned after 2 h) → TCP data plane →
  desktop direct SMB. A same-address guard detects two sites with colliding LAN
  planning and tells you to use the Tailscale IPs.
* Install: `build_app.bat agent <token>` produces `dmt-agent.exe`, `agent.json`,
  `install_service.bat` / `uninstall_service.bat` (boot-time SYSTEM scheduled task via
  `schtasks`). A SYSTEM session has no user credentials — the machine configuration
  **must** carry network username/password so the agent can `net use` the shares. Logs
  to `agent.log` next to the exe (5 MB rotation). Details: `dmt-agent/README.md`.

## Build & test

```bash
cd tauri-app
npm install
npm run dev             # vite dev server (port 1420, matches tauri.conf.json devUrl)
npm run check           # svelte-check type check
npm run tauri dev       # desktop app in dev mode
cargo test              # in src-tauri/: storage / export / MEDIAN unit tests
```

From the repository root:

```bash
build_app.bat           # one-shot packaging (npm ci + tauri build → exe + MSI + NSIS)
build_app.bat agent <token>   # build dmt-agent + agent.json + install scripts
build_app.bat check     # frontend build + cargo check for all three crates
```

* `cargo test` runs fully offline: MEDIAN path resolution (8), storage backends incl.
  Firestore sharding (5), Excel export rules (3), plus the copy-core/agent suites
  (plan/rename/delete-guards, protocol, relay increment, credentials error codes,
  end-to-end agent tests). Real-template / real-Atlas / Firestore integration tests
  exist behind input or env gates (`export_real`, `MIGRATE_REAL=1`, `FIRESTORE_E2E=1`).
* The front end has no automated UI tests — `npm run check` is the gate; the legacy web
  tool keeps its own harness under the root `tests/`.

## Known limitations (desktop)

* `HOME` and `REVIEW` are placeholders.
* TEACH edits (`NodeCheck`, loaded XML) and GV values live only in the local snapshot —
  nothing is ever written back to the production XML (by design).
* Global Align / SR Align light and channel come from a fixed rule (all lights + last
  light, Red channel); whether `AlignSpec.xml` should be collected is still open.
* Network credentials are stored in plaintext in `machines.json` (machine-local file);
  the Atlas connection string only ever lives in the local `storage.json` — neither is
  committed to the repo. The Firestore project/API key are compile-time constants in
  `storage.rs`; access control is expected from the Firestore security rules.
* The front end has no automated component tests yet.

---

# Legacy web tool: SpecParamTool.html

The project started as a zero-dependency, single-file browser tool that reads
`LightSpec.xml` + an `INSPECT_SPEC` folder of `InspectionSpec.xml` files (optionally
`SpecParameter.xml` / `SpecTreeNode.xml` and `Parameter_Template.xlsx`) and turns them
into the **inspection-technology parameter sheet**, analysis listings and two Excel
workbooks — open `SpecParamTool.html`, drop the files, press *Parse Specs*. It still
works and is regenerated by `python build.py` from `src/01…08-*.js`.

* Tabs: Summary, the template-layout parameter sheet (`채널 / 조명 축 / GV 밝기 / 영역 /
  검출 불량 / 파라미터`), per-light channel listings (LED-colour grouping), the
  InspectionSpec transcription table, LightSpec raw + grouped listings, multi-file
  Comparison (`Same`/`Diff` per node × ParamKey × channel) and the built-in dictionaries
  (82 ParamKeys + node tree, overridable by dropping the XMLs).
* Exports: `<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx` (template filled cell-by-cell),
  `..._InspectSpec.xlsx` (listing + comparison), optional reference workbook, per-tab CSV.
* **Light → parameter-area rule** (device knowledge, carried over into the desktop
  exporter): Light 1 = `LIGHT0` = AI-model inspection → no parameters; Light 2 =
  `LIGHT1` → metal only (`PNODE 2` AU + `PNODE 3` OSP); Light 3 = `LIGHT2` → SR /
  non-metal only (`PNODE 5` NonMetal).
* Channel numbering: `LightSpec` stores `@Index` 0-based, the tool shows the 1-based
  number the equipment UI uses (`CH1` = `@Index 0`).
* Tests: `tests/run-model-tests.js` (parse → views → xlsx), `validate_export.py`
  (openpyxl re-read), `run-browser-tests.js` (headless Chrome).

Deep dives: [`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) ·
[`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) ·
[`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) ·
[`tests/README.md`](tests/README.md).

---

## Documentation index

| File | Content |
|---|---|
| [`tauri-app/README.md`](tauri-app/README.md) | Desktop app deep dive: UI, data model, storage backends, Excel rules (Chinese) |
| [`dmt-agent/README.md`](dmt-agent/README.md) | Agent deployment, protocol, cross-site relay, logs (Chinese) |
| [`Plan/`](Plan/) | Design notes (DOE sampling, RSM fitting, light-analyse UI, Svelte 5 migration) |
| [`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) | Web tool module map and pipeline |
| [`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) | Spec file purposes, full key-value dictionaries, XML schemas |
| [`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) | `Parameter_Template.xlsx` layout and open points |
| [`tests/README.md`](tests/README.md) | Web tool regression harness |
