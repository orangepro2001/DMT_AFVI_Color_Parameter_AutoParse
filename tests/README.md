# Tests

Regression harness for `SpecParamTool`. Nothing here is needed to *use* the tool — only to verify it
after changing `src/`.

```bash
cd tests
npm install                 # @xmldom/xmldom (XML parsing in Node), puppeteer-core (drives installed Chrome)
node run-model-tests.js     # parse -> views -> xlsx -> fill the real template
python validate_export.py   # re-open both workbooks with openpyxl (independent reader)
node run-browser-tests.js   # full UI in headless Chrome, on index.html AND SpecParamTool.html
```

| Env var | Default | Meaning |
|---|---|---|
| `SPEC_ROOT` | `D:\신규 Color 폴더 구조\FM1\PxInventory` | folder holding `LIGHT_SPEC/` and `INSPECT_SPEC/` |
| `TEMPLATE` | `D:\검사기술파라미터\Parameter_Template.xlsx` | the real template (fill test is skipped when absent) |
| `OUT_DIR` | `%TEMP%\spec-param-tool` | where generated workbooks are written |
| `CHROME` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | browser for the UI test |

`run-model-tests.js` uses the same `src/*.js` as the browser (loaded with `vm.runInThisContext`), so a
model-layer regression is caught without a browser. `run-browser-tests.js` injects a real folder drop
(`DataTransfer` + `webkitRelativePath`), types a GV value, and inspects the bytes handed to the writer,
because automated Chrome cancels real downloads.

Expected results on the FM1 tree: 18 parameter sheets (two models + copy folders), first sheet
`TOP - LIGHT0` with 16/16 template areas, ~257 parameter rows and ~233 values resolved from the XML;
template fill patches `Top 조명 2번` / `Bottom 조명 2번` and reports the unmatched rows
(Dummy family C) as manual work.
