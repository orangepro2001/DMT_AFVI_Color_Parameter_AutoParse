/* End-to-end UI test in headless Chrome, on BOTH the dev shell (index.html) and the
 * built single file (SpecParamTool.html).
 *
 *   npm install           (in tests/)
 *   node run-browser-tests.js
 *
 * Env (all optional):
 *   SPEC_ROOT  folder with LIGHT_SPEC/ and INSPECT_SPEC/   default: FM1 tree
 *   TEMPLATE   Parameter_Template.xlsx                     default: D:\검사기술파라미터\...
 *   CHROME     chrome.exe path                             default: Google Chrome
 *
 * Downloads are cancelled by automated Chrome, so the test stubs showSaveFilePicker
 * and inspects the bytes handed to the writer instead.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const SPEC_ROOT = process.env.SPEC_ROOT || 'D:/신규 Color 폴더 구조/FM1/PxInventory';
const TEMPLATE = process.env.TEMPLATE || 'D:/검사기술파라미터/Parameter_Template.xlsx';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!fs.existsSync(CHROME)) { console.error('chrome not found: ' + CHROME); process.exit(2); }
if (!fs.existsSync(SPEC_ROOT)) { console.error('spec root not found: ' + SPEC_ROOT); process.exit(2); }

const url = p => 'file:///' + encodeURI(p.replace(/\\/g, '/'));
const INSPECTS = [
  'INSPECT_SPEC/6ST2001Q01-00/TOP/LIGHT0/InspectionSpec.xml',
  'INSPECT_SPEC/6ST2001Q01-00/TOP/LIGHT1/InspectionSpec.xml',
  'INSPECT_SPEC/6ST2001Q01-00/TOP/LIGHT2/InspectionSpec.xml',
  'INSPECT_SPEC/6ST2001Q01-00/BOTTOM/LIGHT2/InspectionSpec.xml',
].filter(p => fs.existsSync(path.join(SPEC_ROOT, p)));
const LIGHT_SPEC = ['INSPECT_SPEC/../LIGHT_SPEC'].length
  ? fs.readdirSync(path.join(SPEC_ROOT, 'LIGHT_SPEC')).map(m => 'LIGHT_SPEC/' + m + '/LightSpec.xml')
      .filter(p => fs.existsSync(path.join(SPEC_ROOT, p))).slice(0, 1)
  : [];

let failures = 0;
function check(ok, label, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + detail : ''));
  if (!ok) failures++;
}

async function drop(page, target, rels) {
  await page.evaluate(async (tgt, list) => {
    const dt = new DataTransfer();
    for (const [raw, rel] of list) {
      const buf = await (await fetch(raw)).arrayBuffer();
      const f = new File([buf], rel.split('/').pop(), { type: 'application/octet-stream' });
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      dt.items.add(f);
    }
    document.getElementById(tgt).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, target, rels);
}

async function run(page, label) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__saved = [];
    window.__dirSaved = [];
    window.showSaveFilePicker = async (opts) => ({
      createWritable: async () => ({
        write: async (b) => { window.__saved.push({ name: opts.suggestedName, size: (b && b.byteLength) || 0 }); },
        close: async () => {},
      }),
    });
    window.showDirectoryPicker = async () => ({
      name: 'EXPORT_DIR',
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (b) => { window.__dirSaved.push({ name: name, size: (b && b.byteLength) || 0 }); },
          close: async () => {},
        }),
      }),
    });
  });
  await page.goto(url(path.join(ROOT, label)), { waitUntil: 'load' });
  console.log('\n=== ' + label + ' ===');

  await drop(page, 'dropLight', LIGHT_SPEC.map(r => [url(path.join(SPEC_ROOT, r)), r]));
  const pickInsp = p => INSPECTS.find(x => x.includes(p));
  const dropInsp = [pickInsp('/TOP/LIGHT1/'), pickInsp('/BOTTOM/LIGHT2/')].filter(Boolean);
  await drop(page, 'dropInsp', dropInsp.map(r => [url(path.join(SPEC_ROOT, r)), r]));
  if (fs.existsSync(TEMPLATE)) await drop(page, 'dropTpl', [[url(TEMPLATE), path.basename(TEMPLATE)]]);
  await new Promise(r => setTimeout(r, 500));
  console.log('[files]', (await page.$$eval('.drop .file span:first-of-type', els => els.map(e => e.innerText.trim()))).join(' | '));

  const cfg = await page.evaluate(() => ({
    model: document.getElementById('cfgModel').value,
    side: document.getElementById('cfgSide').value,
    light: document.getElementById('cfgLight').value,
    used: document.querySelectorAll('#listInsp i.used').length,
    ignored: document.querySelectorAll('#listInsp i.unused').length,
  }));
  check(cfg.used === 1 && cfg.ignored === 1, 'only the first InspectionSpec is marked used', JSON.stringify(cfg));
  check(cfg.model === '6ST2001Q01-00' && cfg.side === 'TOP' && cfg.light === '2',
    'Model / Side / Light auto-filled from the first InspectionSpec', JSON.stringify(cfg));

  await page.click('#btnParse');
  await page.waitForFunction(() => !document.getElementById('btnLightXlsx').disabled, { timeout: 30000 });
  const tabs = await page.$$eval('.tab', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  console.log('[tabs]', tabs.join(' | '));
  check(tabs.some(t => t.startsWith('Param:')), 'parameter-sheet tabs present');
  check(tabs.some(t => t.startsWith('Summary')), 'Summary tab present');

  const paramTabs = await page.$$('.tab.k-ps');
  await paramTabs[0].click();
  await new Promise(r => setTimeout(r, 200));
  const view = await page.evaluate(() => ({
    gv: document.querySelectorAll('#tblbox input.gv').length,
    rows: document.querySelectorAll('#tblbox .arearow').length,
    badges: document.querySelectorAll('#tblbox .bdg').length,
    axisChips: document.querySelectorAll('#tblbox .ax .ach').length,
    axisGroups: document.querySelectorAll('#tblbox .ax .ag').length,
    axisText: [...document.querySelectorAll('#tblbox .ax .ach')].slice(0, 4).map(e => e.innerText.replace(/\s+/g, ' ')),
    text: document.getElementById('tblbox').innerText,
    pills: [...document.querySelectorAll('#tblbox .pill')].map(e => e.innerText),
  }));
  check(view.gv > 0, 'GV inputs rendered', view.gv);
  check(view.rows > 0, 'area blocks rendered', view.rows);
  for (const marker of ['채널', '조명 축', 'GV 밝기', '영역', '검출 불량', '파라미터'])
    check(view.text.includes(marker), 'view shows ' + marker);
  check(view.pills.some(p => /from XML/.test(p)), 'coverage pills', view.pills.join(' / '));
  check(view.axisGroups > 0, 'axis row has colour groups', view.axisGroups);
  check(view.axisChips > 0 && /^CH\d+/.test(view.axisText[0] || ''), 'axis chips keep the Channel index', view.axisText.join(' | '));

  await page.$$eval('#tblbox input.gv', els => { els[0].value = '123.5'; els[0].dispatchEvent(new Event('input', { bubbles: true })); });
  // light view: grouped by LED colour, channels kept
  const lightTabs = await page.$$('.tab.k-lv');
  const lightLabels = await page.$$eval('.tab.k-lv', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check(lightTabs.length > 0, 'light tabs present', lightLabels.join(' | '));
  check(lightLabels.some(l => /LIGHT0/.test(l)) && lightLabels.some(l => /LIGHT2/.test(l)),
    'one light tab per light of the single LightSpec file', lightLabels.length + ' tab(s)');
  await lightTabs[0].click();
  await new Promise(r => setTimeout(r, 200));
  const lv = await page.evaluate(() => ({
    legend: document.getElementById('legend').innerText,
    groups: [...document.querySelectorAll('#tblbox .grp')].length,
    chips: [...document.querySelectorAll('#tblbox .chip')].map(e => e.innerText.replace(/\s+/g, ' ')),
    off: document.querySelectorAll('#tblbox .chip.off').length,
    labels: [...document.querySelectorAll('#tblbox .grp-lbl')].map(e => e.innerText.replace(/\s+/g, ' ')),
  }));
  check(lv.groups > 0, 'light channels grouped', lv.labels.join(' | '));
  check(lv.chips.length > 0 && /CH\d+/.test(lv.chips[0]), 'chips keep the Channel index', lv.chips.slice(0, 5).join(' | '));
  check(lv.off > 0, 'disabled channels dimmed', lv.off);
  check(/grouped by LED colour/.test(lv.legend), 'light legend explains the grouping');
  check(/LIGHT\d+/.test(lv.legend) && /Page \d/.test(lv.legend),
    'light tab states which light/page it shows', lv.legend.slice(0, 90));
  await (await page.$('.tab.k-ps')).click();
  await new Promise(r => setTimeout(r, 150));

  // the InspectionSpec tab mirrors the machine UI: sections + Name/Value, no min/max
  for (const t of await page.$$('.tab')) {
    if ((await t.evaluate(e => e.innerText)).startsWith('InspectionSpec')) { await t.click(); break; }
  }
  await new Promise(r => setTimeout(r, 200));
  const insp = await page.evaluate(() => ({
    text: document.getElementById('tblbox').innerText,
    rows: document.querySelectorAll('#tblbox table tr').length,
    dashes: (document.getElementById('tblbox').innerText.match(/–/g) || []).length,
  }));
  check(/Unit/.test(insp.text) && /▸/.test(insp.text) && /·/.test(insp.text),
    'inspection tab shows the Unit/Dummy -> area -> sub-area sections', insp.rows + ' row(s)');
  check(/No\.\s*Name\s*Value/.test(insp.text) && /No\.\s*Name\s*Red\s*Green\s*Blue/.test(insp.text),
    'inspection tab keeps only Name + Value (both block kinds)');
  check(!/MinR|MaxR|ValR|ControlType|NodeCheck/.test(insp.text),
    'inspection tab has no min/max or metadata columns');
  check(insp.dashes === 0, 'sparse rows render empty cells instead of dashes', insp.dashes);
  await (await page.$('.tab.k-ps')).click();
  await new Promise(r => setTimeout(r, 150));

  // base path: choose an export folder, then every export is written straight into it
  await page.click('#pickBase');
  await new Promise(r => setTimeout(r, 250));

  await page.click('#btnLightXlsx');
  await page.waitForFunction(() => window.__dirSaved.length > 0, { timeout: 30000 });
  const dirSaved = await page.evaluate(() => window.__dirSaved);
  check(dirSaved[0].size > 5000, 'LightSpec + GV workbook written to the base path', JSON.stringify(dirSaved[0]));
  check(dirSaved[0].name === '6ST2001Q01-00_TOP_LIGHT2_LightSpec.xlsx',
    'LightSpec file name built from Model / Side / Light', dirSaved[0].name);
  const report = await page.$eval('#report', e => e.innerText);
  check(report.length > 50, 'export report rendered', report.split('\n')[0]);
  check(/Manual work|Nothing left/.test(report), 'report lists manual work');
  check(/조명 2번[\s\S]{0,140}LIGHT1/.test(report), 'template sheet 조명 2번 filled from LIGHT1',
    (report.match(/Top 조명 2번[^\n]*/) || ['(row not found)'])[0].slice(0, 120));

  await page.click('#btnInspXlsx');
  await page.waitForFunction(() => window.__dirSaved.length > 1, { timeout: 30000 });
  const dirSaved2 = await page.evaluate(() => window.__dirSaved);
  check(dirSaved2[1].size > 2000, 'InspectionSpec workbook written to the base path', JSON.stringify(dirSaved2[1]));
  check(dirSaved2[1].name === '6ST2001Q01-00_TOP_LIGHT2_InspectSpec.xlsx',
    'InspectionSpec file name built from Model / Side / Light', dirSaved2[1].name);

  await page.click('#btnRef');
  await page.waitForFunction(() => window.__dirSaved.length > 2, { timeout: 30000 });
  const dirSaved3 = await page.evaluate(() => window.__dirSaved);
  check(/Reference\.xlsx$/.test(dirSaved3[2].name), 'reference workbook name', dirSaved3[2].name);

  await page.select('#optLightOff', '1');
  await new Promise(r => setTimeout(r, 250));
  await page.select('#optLightOff', '0');
  await page.type('#search', '1000');
  await new Promise(r => setTimeout(r, 250));
  for (const t of await page.$$('.tab')) {
    if ((await t.evaluate(e => e.innerText)).includes('Comparison')) { await t.click(); break; }
  }
  await new Promise(r => setTimeout(r, 200));
  check((await page.$eval('#legend', e => e.innerText)).includes('Comparison'), 'table view + search work');

  await page.click('#btnClear');
  check((await page.$eval('#tblbox', e => e.innerText)).includes('Not parsed yet'), 'clear resets the view');

  // theme switch: light by default, dark on click, light again
  const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(theme0 === 'light', 'default theme is light', theme0 + ' / ' + bg0);
  await page.click('#btnTheme');
  const theme1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg1 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(theme1 === 'dark', 'theme toggles to dark', theme1 + ' / ' + bg1);
  check(bg0 !== bg1, 'background colour really changes', bg0 + ' -> ' + bg1);
  await page.screenshot({ path: 'C:/Users/DMT/AppData/Local/Temp/gencode/theme_dark.png' });
  await page.click('#btnTheme');
  check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light',
    'theme toggles back to light');
  check(errs.length === 0, 'no JS errors', errs.join(' | '));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files', '--no-sandbox'],
  });
  for (const label of ['index.html', 'SpecParamTool.html']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1680, height: 1000 });
    await run(page, label);
  }
  await browser.close();
  console.log(failures ? '\nBROWSER TESTS FAILED (' + failures + ')' : '\nBROWSER TESTS OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
