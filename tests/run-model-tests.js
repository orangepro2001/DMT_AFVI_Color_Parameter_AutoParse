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
  // strict intake: only the exact equipment file names are read, look-alikes are ignored
  check(T.classify('LightSpec.xml') === 'light'
    && T.classify('INSPECT_SPEC/m/TOP/LIGHT1/InspectionSpec.xml') === 'inspection',
    'classify: exact names accepted', T.classify('InspectionSpec.xml'));
  check(['InspectionSpec - 복사본.xml', 'InspectionSpec - 복사본 (2).xml', 'Application.xml',
    'SystemList.xml', 'UserList.csv', 'AISpec.xml', '3DSpec.xml'].every(n => T.classify(n) === 'other'),
    'classify: look-alike / unrelated names are ignored',
    ['InspectionSpec - 복사본.xml', 'Application.xml', 'UserList.csv'].map(n => n + '=' + T.classify(n)).join(' '));
  check(T.classify('SpecParameter.xml') === 'param' && T.classify('SpecTreeNode.xml') === 'tree'
    && T.classify('SpecTreeNodeList.xml') === 'treelist' && T.classify('Parameter_Template.xlsx') === 'template',
    'classify: dictionaries and the template are still recognised',
    ['SpecParameter.xml', 'SpecTreeNode.xml', 'SpecTreeNodeList.xml', 'Parameter_Template.xlsx'].map(n => T.classify(n)).join(' '));
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

  // export grouping: Light+GV / InspectionSpec / reference dictionaries
  const gv0 = {}; gv0[sheet.key + '|AU'] = { R: 111, G: 222, B: 333 };
  const groups = T.exportGroups(built.analysis, built.paramSheets, Object.assign({}, opts, { gv: gv0 }));
  check(groups.param.length === built.paramSheets.length, 'export group: one parameter sheet per side/light',
    groups.param.length + '/' + built.paramSheets.length);
  check(groups.light.map(t => t.name).join(',') === 'LightSpec,LightSpec Grouped',
    'export group: LightSpec listings', groups.light.map(t => t.name).join(','));
  check(groups.inspect.map(t => t.name).join(',') === 'InspectionSpec,Comparison',
    'export group: InspectionSpec listing + comparison', groups.inspect.map(t => t.name).join(','));
  check(groups.reference.map(t => t.name).join(',') === 'Summary,Param Dict,Node Dict',
    'export group: reference dictionaries', groups.reference.map(t => t.name).join(','));

  // file 2: the InspectionSpec sheet mirrors the machine UI (sections + Name/Value, no min/max)
  const inspTable = built.analysis.tables.find(t => t.name === 'InspectionSpec');
  check(!!inspTable && inspTable.header === null, 'InspectionSpec sheet is sectioned (no flat header)');
  const flat = inspTable.rows.map(r => r.join(' ')).join('\n');
  check(!/MinR|MinValR|ValR|MaxVal|ControlType|NodeCheck|Description/.test(flat),
    'InspectionSpec sheet keeps only name + value (min/max and metadata dropped)');
  check(inspTable.rows.some(r => /^Unit\b/.test(r[0])) && inspTable.rows.some(r => /^Dummy\b/.test(r[0])),
    'GPNODE sections present',
    inspTable.rows.filter(r => /^(Unit|Dummy)\b/.test(r[0])).map(r => r[0]).slice(0, 2).join(' | '));
  check(/\(TOP · LIGHT0\)/.test(inspTable.rows.map(r => r[0]).join('\n')),
    'GPNODE section carries the side/light', inspTable.rows[1][0]);
  check(inspTable.rows.some(r => r[1] === '▸ AU'), 'PNODE section present',
    inspTable.rows.filter(r => String(r[1]).startsWith('▸')).map(r => r[1]).slice(0, 3).join(' '));
  check(inspTable.rows.some(r => r[2] === '· C-Pad'), 'CNODE section present',
    inspTable.rows.filter(r => String(r[2]).startsWith('·')).map(r => r[2]).slice(0, 3).join(' '));
  check(!inspTable.rows.some(r => r[0] === 'No.' && r[2] === 'Value'),
    'no single-value block is written (MASTER/SUBMASTER dropped)');
  check(inspTable.rows.filter(r => r[0] === 'No.').length > 0
    && inspTable.rows.filter(r => r[0] === 'No.').every(r => r[2] === 'Red' && r[3] === 'Green' && r[4] === 'Blue'),
    'every block header is "No. | Name | Red | Green | Blue"',
    [...new Set(inspTable.rows.filter(r => r[0] === 'No.').map(r => r.slice(0, 5).join('|')))].join(' ; '));
  check(!/Common \/ 공통|Mask Inspection|Chain Align|Chain Inspection|Adjust Mask|Adjust Margin Mask|Remove SR Edge/.test(flat),
    'MASTER/SUBMASTER node settings are gone from the sheet');
  check(inspTable.merges.length > 10, 'section rows carry merges', inspTable.merges.length);
  check(inspTable.name === 'InspectionSpec' && inspTable.sparse === true,
    'InspectionSpec sheet stays sparse (no dash placeholders in the preview)');
  // parameters follow ParamKey order inside a block, exactly like the machine list
  const bStart = inspTable.rows.findIndex((r, i) => r[0] === 'No.' && r[2] === 'Red'
    && inspTable.rows[i + 1] && /^Bright Defect\(TH\)/.test(inspTable.rows[i + 1][1]));
  const seq = inspTable.rows.slice(bStart + 1, bStart + 23).map(r => r[1]);
  check(seq.length === 22 && seq[0].indexOf('Bright Defect(TH)') === 0
    && seq[21].indexOf('Protrusion Defect Size(Pixel)') === 0,
    'block lists the INSPECTION parameters in ParamKey order (Bright -> Protrusion)',
    seq.length + ' params: ' + seq[0] + ' … ' + seq.slice(-1)[0]);

  // light -> parameter-area rule (device knowledge, not derivable from the XML)
  check(T.lightAreaRule(0).pn.length === 0 && T.lightAreaRule(1).pn.join(',') === '2,3'
    && T.lightAreaRule(2).pn.join(',') === '5' && T.lightAreaRule('') === null,
    'light -> area rule defined (LIGHT0 none / LIGHT1 AU+OSP / LIGHT2 NonMetal)',
    JSON.stringify(T.LIGHT_AREA_RULES));
  // side / light select: every loaded file stays in the model, the inputs pick the used ones
  const sel = T.buildViews(parsed, dict, Object.assign({}, opts, { lightIndex: 2, side: 'TOP' }));
  check(sel.selection && sel.selection.kept > 0 && sel.selection.kept < sel.selection.of,
    'Side / Light selects a subset of the loaded InspectionSpec files',
    sel.selection.kept + ' of ' + sel.selection.of + ' for ' + sel.selection.side + ' ' + sel.selection.light);
  check(sel.paramSheets.every(s => s.side === 'TOP' && s.light === 'LIGHT2'),
    'only the matching side/light sheets are built', sel.paramSheets.map(s => s.side + ' ' + s.light).join(', '));
  check(sel.paramSheets.length === sel.selection.kept, 'one parameter sheet per selected file',
    sel.paramSheets.length + '/' + sel.selection.kept);
  check((sel.selection.copies || []).length > 0
    && sel.selection.copies.every(l => /복사본/.test(l)) && sel.selection.files.every(l => !/복사본/.test(l)),
    'a backup folder is skipped when a real folder covers the same side/light',
    'copies: ' + (sel.selection.copies || []).join(', '));

  const perLight = [0, 1, 2].map(li => {
    const b = T.buildViews(parsed, dict, Object.assign({}, opts, { lightIndex: li, side: 'TOP' }));
    const ins = b.analysis.tables.find(t => t.name === 'InspectionSpec');
    const ps = b.paramSheets[0];
    return {
      li: li, areas: ps.blocks.length, ps: ps, rule: T.LIGHT_AREA_RULES[String(li)],
      pns: ins ? [...new Set(ins.rows.filter(r => String(r[1]).startsWith('▸')).map(r => r[1]))] : [],
      gv: ps.gvClasses,
      cmp: !!b.analysis.tables.find(t => t.name === 'Comparison'),
      note: (ps.notes || []).find(n => /^Light filter:/.test(n)),
    };
  });
  check(perLight[0].areas === 0 && perLight[0].gv.length === 0 && perLight[0].pns.length === 0,
    'LIGHT0 (AI model) keeps no parameter area at all',
    perLight[0].areas + ' areas / gv ' + JSON.stringify(perLight[0].gv));
  check(perLight[0].cmp === false, 'LIGHT0 has no comparison rows left');
  check(perLight[1].areas > 0 && perLight[1].pns.join(',') === '▸ AU,▸ OSP' && perLight[1].gv.join(',') === 'AU,OSP'
    && perLight[1].ps.blocks.every(b => perLight[1].rule.pn.indexOf(b.p) >= 0),
    'LIGHT1 keeps the metal areas only (AU + OSP)',
    perLight[1].areas + ' areas / ' + perLight[1].pns.join(' ') + ' / gv ' + perLight[1].gv.join(','));
  check(perLight[2].areas > 0 && perLight[2].pns.join(',') === '▸ NonMetal' && perLight[2].gv.join(',') === 'SR,SPACE'
    && perLight[2].ps.blocks.every(b => perLight[2].rule.pn.indexOf(b.p) >= 0),
    'LIGHT2 keeps the SR / non-metal area only',
    perLight[2].areas + ' areas / ' + perLight[2].pns.join(' ') + ' / gv ' + perLight[2].gv.join(','));
  check(perLight.every(x => !!x.note), 'every light carries its filter note in the sheet',
    perLight.map(x => x.li + ':' + (x.note ? 'ok' : '-')).join(' | '));
  const unfiltered = T.buildViews(parsed, dict, opts);
  check(unfiltered.lightRule === null && unfiltered.selection === null
    && unfiltered.paramSheets[0].blocks.length === T.TEMPLATE_AREAS.length,
    'no side/light selected -> every file and area kept',
    unfiltered.paramSheets[0].blocks.length + '/' + T.TEMPLATE_AREAS.length);
  check(unfiltered.paramSheets.length === parsed.inspects.length,
    'no side/light selected -> one sheet per loaded file',
    unfiltered.paramSheets.length + '/' + parsed.inspects.length);

  // file 2 as it is written for one light (LIGHT2 = NonMetal only)
  const b2 = T.buildViews(parsed, dict, Object.assign({}, opts, { lightIndex: 2, side: 'TOP' }));
  const insp2Path = path.join(OUT, 'gen_inspect_light2.xlsx');
  fs.writeFileSync(insp2Path, Buffer.from(await T.buildXlsx(T.exportGroups(
    b2.analysis, b2.paramSheets, Object.assign({}, opts, { gv: {} })).inspect)));
  check(fs.statSync(insp2Path).size > 500, 'light-filtered InspectionSpec workbook written', insp2Path);

  // the select drives the side, the light and the axis (BTM / LIGHT2 -> Page 2)
  const bottom = T.buildViews(parsed, dict, Object.assign({}, opts, { side: 'BTM', lightIndex: 2 }));
  check(bottom.paramSheets.length > 0
    && bottom.paramSheets.every(s => s.side === 'BOTTOM' && s.light === 'LIGHT2')
    && bottom.paramSheets.every(s => String(s.axis.page) === '2'),
    'the select drives the side, the light and the axis page',
    bottom.paramSheets.map(s => s.name + ' -> ' + s.side + ' ' + s.light + ' page ' + s.axis.page).join(' | '));

  // 1) generated workbook in the template layout
  const gv = {}; gv[sheet.key + '|AU'] = { R: 111, G: 222, B: 333 };
  const tables = T.paramTables(built.paramSheets, Object.assign({}, opts, { gv }));
  const genPath = path.join(OUT, 'gen_param_sheet.xlsx');
  fs.writeFileSync(genPath, Buffer.from(await T.buildXlsx(tables.concat(
    built.analysis.tables.filter(t => t.name === 'Summary')))));
  check(fs.statSync(genPath).size > 5000, 'generated workbook written', genPath);

  // 1b) the two exported workbooks: Light+GV and InspectionSpec
  const lightTables = groups.param.concat(groups.light);
  const lightPath = path.join(OUT, 'gen_light.xlsx');
  fs.writeFileSync(lightPath, Buffer.from(await T.buildXlsx(lightTables)));
  check(fs.statSync(lightPath).size > 5000, 'LightSpec + GV workbook written', lightPath);
  check(lightTables.map(t => t.name).join(',') === built.paramSheets.map(s => s.name).join(',') + ',LightSpec,LightSpec Grouped',
    'LightSpec workbook = parameter sheet(s) + LightSpec listings', lightTables.map(t => t.name).join(','));
  const inspPath = path.join(OUT, 'gen_inspect.xlsx');
  fs.writeFileSync(inspPath, Buffer.from(await T.buildXlsx(groups.inspect)));
  check(fs.statSync(inspPath).size > 2000, 'InspectionSpec workbook written', inspPath);

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

    // 2b) file 1 = filled template + appended LightSpec listings
    const appended = await T.appendTablesToXlsx(filled.bytes, groups.light);
    const appPath = path.join(OUT, 'filled_template_with_light.xlsx');
    fs.writeFileSync(appPath, Buffer.from(appended));
    check(fs.statSync(appPath).size > fs.statSync(filledPath).size,
      'LightSpec listings appended to the filled template', fs.statSync(appPath).size + ' > ' + fs.statSync(filledPath).size);
  } else {
    console.log('  (skipped template fill: ' + TEMPLATE + ' not found)');
  }

  console.log(failures ? '\nMODEL TESTS FAILED (' + failures + ')' : '\nMODEL TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
