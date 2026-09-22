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
  const opts = { nameMode: 'both', digits: '', keepZero: true, diffOnly: false, blankEmpty: true, gv: {} };
  const built = T.buildViews(parsed, dict, opts);

  check(parsed.warnings.length === 0, 'no parse warnings', parsed.warnings.join(' | ').slice(0, 200));
  check(built.paramSheets.length > 0, 'parameter sheets built', built.paramSheets.map(s => s.name).join(', '));
  check(built.views.some(v => v.kind === 'table' && v.name === 'Summary'), 'Summary view present');

  const sheet = built.paramSheets[0];
  const stats = T.Render.paramsStats(sheet.blocks[0]);
  check(sheet.blocks.length === T.TEMPLATE_AREAS.length, 'all template areas present in sheet 1',
    sheet.blocks.length + '/' + T.TEMPLATE_AREAS.length);
  check(stats.ok > 0, 'first block resolved from XML', JSON.stringify(stats));
  check(!!sheet.axis.R || !!sheet.axis.G || !!sheet.axis.B, 'illumination axis derived', sheet.axis.note);
  const html = T.Render.parameterSheet(sheet, { search: '', gv: {} }).html;
  for (const marker of ['채널', '조명 축', 'GV 밝기', '영역', '검출 불량', '파라미터', 'class="gv"'])
    check(html.includes(marker), 'preview contains ' + marker);

  // light views: channels grouped by LED colour, original Channel/@Index kept
  check(built.lightViews.length > 0, 'light views built', built.lightViews.map(v => v.name).join(', '));
  const lv = built.lightViews[0];
  const page = lv.sheet.sets.flatMap(s => s.pages).find(p => p.groups.length);
  check(!!page, 'light page has colour groups',
    page ? page.groups.map(g => g.name + '=' + g.items.map(i => 'CH' + i.ch).join(',')).join(' | ') : '');
  check(page.groups.every(g => g.items.every(i => i.ch !== undefined && i.value !== undefined)),
    'every grouped channel keeps its index and value');
  check(page.groups.every(g => new Set(g.items.map(i => i.color)).size === 1),
    'each group holds a single LED colour');
  const lvHtml = T.Render.body({ kind: 'light', sheet: lv.sheet }, { search: '', digits: '' });
  for (const marker of ['class="grp"', 'class="chip', 'CH', '°'])
    check(lvHtml.includes(marker), 'light view renders ' + marker);
  // numbering: XML @Index is 0-based, the UI shows the equipment's 1-based number
  check(T.CHANNEL_BASE === 1, 'channel display base', T.CHANNEL_BASE);
  const firstRaw = page.groups[0].items[0].ch;
  check(/<b>CH1<\/b>/.test(lvHtml), 'zero-based XML index 0 is displayed as CH1', 'raw=' + firstRaw);
  check(/XML @Index 0\b/.test(lvHtml) || firstRaw !== '0', 'raw XML index kept in the tooltip');
  const axTxt = sheet.axis.R || sheet.axis.G || sheet.axis.B;
  check(new RegExp('<b>').test(html) && /CH\d+\s*<b>/.test(html), 'axis chips show 1-based numbers', axTxt);
  const lightTable = built.analysis.tables.find(t => t.name === 'LightSpec');
  check(lightTable.header.includes('Channel') && lightTable.header.includes('XML Index'),
    'LightSpec listing keeps both numbers', lightTable.header.slice(10, 12).join(' / '));
  const grouped = built.analysis.tables.find(t => t.name === 'LightSpec Grouped');
  check(grouped.header.some(h => /XML Index/.test(h)), 'grouped listing carries the raw index',
    grouped.header[grouped.header.length - 1]);
  const gRow = grouped.rows[0];
  check(Number(gRow[7]) === Number(gRow[12]) + 1, 'grouped display number = raw index + 1',
    'display=' + gRow[7] + ' raw=' + gRow[12]);
  check(built.analysis.tables.some(t => t.name === 'LightSpec Grouped'), 'grouped light table present in the export');
  const axGroups = sheet.axis.cols && (sheet.axis.cols.R || sheet.axis.cols.G || sheet.axis.cols.B);
  check(!!(axGroups && axGroups.length), 'axis row keeps the colour groups for the chips',
    sheet.axis.cols ? Object.keys(sheet.axis.cols).map(k => k + ':' + sheet.axis.cols[k].length).join(' ') : '');
  check(/CH\d+\s*<b>/.test(html) || sheet.axis.cols.R.length === 0,
    'axis chips show the original channel numbers', sheet.axis.R);

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
