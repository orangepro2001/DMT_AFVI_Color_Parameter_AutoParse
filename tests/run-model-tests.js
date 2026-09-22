/* Model-layer regression test: parse -> views -> xlsx -> fill the real template.
 *
 *   npm install           (in tests/)
 *   node run-model-tests.js
 *
 * Env (all optional):
 *   SPEC_ROOT  folder with LIGHT_SPEC/ and INSPECT_SPEC/   default: FM1 tree
 *   TEMPLATE   Parameter_Template.xlsx                     default: D:\검사기술파라미터\...
 *   OUT_DIR    where the generated workbooks are written   default: %TEMP%/spec-param-tool
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SPEC_ROOT = process.env.SPEC_ROOT || 'D:/신규 Color 폴더 구조/FM1/PxInventory';
const TEMPLATE = process.env.TEMPLATE || 'D:/검사기술파라미터/Parameter_Template.xlsx';
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'spec-param-tool');
fs.mkdirSync(OUT, { recursive: true });

let domParser;
try { domParser = require('@xmldom/xmldom').DOMParser; }
catch (e) { console.error('run `npm install` inside tests/ first'); process.exit(2); }
global.DOMParser = domParser;

for (const f of ['01-dictionaries.js', '02-parse.js', '03-tables.js', '04-param-sheet.js',
                 '05-xlsx.js', '06-render.js', '07-api.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), { filename: f });
}
const T = globalThis.SpecTool;
const channelLabel = (i) => 'CH' + (Number(i.ch) + T.CHANNEL_BASE);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

let failures = 0;
function check(ok, label, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  console.log('dictionary:', Object.keys(T.PARAM_NAMES).length, 'ParamKeys | template areas:', T.TEMPLATE_AREAS.length);
  const files = walk(SPEC_ROOT).filter(p => /(LightSpec|InspectionSpec)\.xml$/i.test(p))
    .map(p => ({ name: path.basename(p), label: p.replace(SPEC_ROOT + '/', ''), text: fs.readFileSync(p, 'utf8') }));
  check(files.length > 0, 'source files found', files.length + ' file(s) in ' + SPEC_ROOT);
  if (!files.length) process.exit(1);

  const dict = T.makeDict();
  const parsed = T.parseAll(files, dict);
  const opts = { nameMode: 'both', digits: '', keepZero: true, diffOnly: false, blankEmpty: true,
    lightOffset: 1, gv: {} };   /* UI default: LIGHT0 = 조명 1번 (LightSpec Page 0) */
  const built = T.buildViews(parsed, dict, opts);

  check(parsed.warnings.length === 0, 'no parse warnings', parsed.warnings.join(' | ').slice(0, 200));
  check(built.paramSheets.length > 0, 'parameter sheets built', built.paramSheets.map(s => s.name).join(', '));
  check(built.views.some(v => v.kind === 'table' && v.name === 'Summary'), 'Summary view present');

  const sheet = built.paramSheets[0];
  const stats = T.Render.paramsStats(sheet.blocks[0]);
  check(sheet.blocks.length === T.TEMPLATE_AREAS.length, 'all template areas present in sheet 1',
    sheet.blocks.length + '/' + T.TEMPLATE_AREAS.length);
  check(stats.ok > 0, 'first block resolved from XML', JSON.stringify(stats));
  check(!!sheet.axis.file && sheet.axis.page !== undefined && sheet.axis.page !== '',
    'illumination axis bound to a light page', sheet.axis.note);
  const html = T.Render.parameterSheet(sheet, { search: '', gv: {} }).html;
  for (const marker of ['채널', '조명 축', 'GV 밝기', '영역', '검출 불량', '파라미터', 'class="gv"'])
    check(html.includes(marker), 'preview contains ' + marker);

  // light views: one tab per light (= one <Page>), channels grouped by LED colour
  check(built.lightViews.length > 0, 'light views built', built.lightViews.map(v => v.name).join(', '));
  const lv = built.lightViews.find(v => v.sheet.groups.some(g => g.items.length))
    || built.lightViews[0];
  const page = lv.sheet;
  check(!!page, 'light view has a page',
    page ? page.light + ' = Page ' + page.page + ' (' + page.on + '/' + page.count + ' on)' : '');
  check(built.lightViews.every(v => v.sheet.light === 'LIGHT' + v.sheet.page),
    'every light view is named after its Page', built.lightViews.map(v => v.sheet.light).join(','));
  check(page.groups.every(g => g.items.every(i => i.ch !== undefined && i.value !== undefined)),
    'every grouped channel keeps its index and value');
  check(page.groups.every(g => new Set(g.items.map(i => i.color)).size === 1),
    'each group holds a single LED colour',
    page.groups.map(g => g.name + '=' + g.items.map(i => channelLabel(i)).join(',')).join(' | '));
  const lvHtml = T.Render.body({ kind: 'light', sheet: lv.sheet }, { search: '', digits: '' });
  for (const marker of ['class="grp"', 'class="chip', 'CH', '°'])
    check(lvHtml.includes(marker), 'light view renders ' + marker);
  check(/Page \d+/.test(lvHtml), 'light view states the page it came from');

  // the axis of a parameter sheet must come from the matching Page (= the light folder)
  let axisOk = true, axisDetail = [];
  built.paramSheets.forEach(s => {
    const n = Number(String(s.light || '').replace(/\D/g, ''));
    const file = built.paramSheets && s.axis.file;
    const raw = files.find(f => f.label === file);
    if (!raw) { axisOk = false; axisDetail.push(s.name + ': no LightSpec match'); return; }
    const spec = T.parseLightSpec(raw.text, raw.label);
    const lt = T.lightsOfSpec(spec).find(x => x.pageIndex === n);
    if (!lt) { axisOk = false; axisDetail.push(s.name + ': no Page ' + n); return; }
    const fromAxis = (s.axis.groups || []).flatMap(g => g.items).map(i => i.ch).sort().join(',');
    const fromPage = lt.rows.filter(r => r.chEnable === '1' && Number(r.value) > 0)
      .map(r => r.ch).sort().join(',');
    if (fromAxis !== fromPage) { axisOk = false; axisDetail.push(s.name + ': axis=' + fromAxis + ' page=' + fromPage); }
    if (String(s.axis.page) !== String(n)) { axisOk = false; axisDetail.push(s.name + ': page ' + s.axis.page + ' != light ' + n); }
  });
  check(axisOk, 'axis of every parameter sheet equals the matching light page', axisDetail.join(' | ') || 'all sheets');

  // numbering: XML @Index is 0-based, the UI shows the equipment's 1-based number
  check(T.CHANNEL_BASE === 1, 'channel display base', T.CHANNEL_BASE);
  const whiteItem = (built.lightViews.find(v => v.sheet.groups.some(g => g.color === 'W'))
    || lv).sheet.groups.find(g => g.color === 'W').items[0];
  check(/<b>CH1<\/b>/.test(lvHtml) || whiteItem.ch !== '0',
    'zero-based XML index 0 is displayed as CH1', 'raw=' + whiteItem.ch + ' shown=' + channelLabel(whiteItem));
  const axisText = sheet.axis.R || sheet.axis.G || sheet.axis.B;
  check(/CH\d+\s*<b>/.test(html) || !axisText, 'axis chips show 1-based numbers', axisText);
  const lightTable = built.analysis.tables.find(t => t.name === 'LightSpec');
  check(lightTable.header.includes('Channel') && lightTable.header.includes('XML Index')
    && lightTable.header.includes('Light'), 'LightSpec listing: Light + both channel numbers',
    lightTable.header.slice(7, 13).join(' / '));
  const grouped = built.analysis.tables.find(t => t.name === 'LightSpec Grouped');
  check(grouped.header.some(h => /XML Index/.test(h)), 'grouped listing carries the raw index',
    grouped.header[grouped.header.length - 1]);
  const gRow = grouped.rows[0];
  check(Number(gRow[8]) === Number(gRow[13]) + 1, 'grouped display number = raw index + 1',
    'display=' + gRow[8] + ' raw=' + gRow[13]);
  check(built.analysis.tables.some(t => t.name === 'LightSpec Grouped'), 'grouped light table present in the export');
  check((sheet.axis.groups || []).length > 0, 'axis row keeps the colour groups for the chips',
    (sheet.axis.groups || []).map(g => g.name + ':' + g.items.length).join(' '));
  check(/CH\d+\s*<b>/.test(html), 'axis chips show the channel numbers', sheet.axis.text);

  // 1) generated workbook in the template layout
  const gv = {}; gv[sheet.key + '|AU'] = { R: 111, G: 222, B: 333 };
  const tables = T.paramTables(built.paramSheets, Object.assign({}, opts, { gv }));
  const genPath = path.join(OUT, 'gen_param_sheet.xlsx');
  fs.writeFileSync(genPath, Buffer.from(await T.buildXlsx(tables.concat(
    built.analysis.tables.filter(t => t.name === 'Summary')))));
  check(fs.statSync(genPath).size > 5000, 'generated workbook written', genPath);

  // 2) fill the real template
  if (fs.existsSync(TEMPLATE)) {
    const filled = await T.fillTemplateXlsx(new Uint8Array(fs.readFileSync(TEMPLATE)), built.paramSheets,
      Object.assign({}, opts, { gv, dictIndex: built.dictIndex }));
    const filledPath = path.join(OUT, 'filled_template.xlsx');
    fs.writeFileSync(filledPath, Buffer.from(filled.bytes));
    check(filled.report.sheets.every(s => /\d+$/.test(String(s.target)) &&
        Number(String(s.target).replace(/\D/g, '')) === Number(String(s.sheet).replace(/\D/g, '')) - 1),
      'template 조명 n번 sheet is filled from LIGHT(n-1)', filled.report.sheets.map(s => s.sheet + ' <- ' + s.target).join(', '));
    check(filled.report.sheets.length > 0, 'template sheets filled',
      filled.report.sheets.map(s => s.sheet + ':' + s.cells + ' cells').join(', '));
    check(filled.report.skipped.every(s => s.reason), 'skipped sheets carry a reason',
      filled.report.skipped.map(s => s.sheet).join(', '));
    check(filled.report.cells > 0, 'cells patched', filled.report.cells);
    console.log('  template report:', JSON.stringify(filled.report).slice(0, 400));
  } else {
    console.log('  (skipped template fill: ' + TEMPLATE + ' not found)');
  }

  console.log(failures ? '\nMODEL TESTS FAILED (' + failures + ')' : '\nMODEL TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
