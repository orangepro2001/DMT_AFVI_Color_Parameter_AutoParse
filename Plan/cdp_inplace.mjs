// Verify in-place palette swap (no reload) via CDP: swap to light, check
// computed styles across the tree, take a renderer screenshot.
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const wsUrl = list.find(t => t.type === "page").webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}
await send("Page.enable");

const LIGHT = { '--bg-dark': '#f3f3f3', '--bg-darker': '#e4e4e4', '--bg-deep': '#eaeaea', '--bg-panel': '#ffffff', '--bg-header': '#e8e8e8', '--bg-input': '#ffffff', '--bg-elev': '#dcdcdc', '--tint-ok': '#dcefe2', '--tint-bad': '#f4dede', '--tint-info': '#e6e4f4', '--tint-warn': '#f7ecd2', '--tint-warn-text': '#6b5310', '--text-main': '#1f1f1f', '--text-muted': '#616161', '--accent-blue': '#0067c4', '--accent-blue-bright': '#0067c4', '--status-green': '#5a9e0d', '--border-color': '#d4d4d4', '--border-strong': '#c0c0c0', '--slider-track': '#c8c8c8', '--slider-thumb': '#0067c4', '--toggle-bg': '#b5b5b5', '--toggle-bg-on': '#0067c4', '--scrollbar-thumb': '#c1c1c1', '--scrollbar-thumb-hover': '#a8a8a8', '--row-insp': '#0a8a0a', '--row-sub': '#a07c00' };
const DARK = { '--bg-dark': '#2d2d30', '--bg-darker': '#222222', '--bg-deep': '#1e1e1e', '--bg-panel': '#252526', '--bg-header': '#333337', '--bg-input': '#1e1e1e', '--bg-elev': '#484848', '--tint-ok': '#2e3d56', '--tint-bad': '#4a2d2d', '--tint-info': '#2d2d3d', '--tint-warn': '#4a3200', '--tint-warn-text': '#ffd88a', '--text-main': '#d4d4d4', '--text-muted': '#808080', '--accent-blue': '#007acc', '--accent-blue-bright': '#0088cc', '--status-green': '#8cc63f', '--border-color': '#3f3f46', '--border-strong': '#111111', '--slider-track': '#3e3e42', '--slider-thumb': '#007acc', '--toggle-bg': '#555555', '--toggle-bg-on': '#007acc', '--scrollbar-thumb': '#424242', '--scrollbar-thumb-hover': '#4f4f4f', '--row-insp': '#00ff00', '--row-sub': '#ffff00' };
const cssOf = (vars) => ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('') + '}';

async function probe(tag) {
  const state = await evaluate(`(() => {
    const els = ['.top-nav', '.right-panel .host', '.param-table td', '.param-table th', '.log-panel', '.status-bar', '.info-bar', '.tree-col'];
    const out = {};
    for (const sel of els) {
      const el = document.querySelector(sel);
      if (el) out[sel] = getComputedStyle(el).backgroundColor;
    }
    const td = document.querySelector('.param-table td');
    if (td) out['td-color'] = getComputedStyle(td).color;
    out.glyph = document.querySelector('.theme-toggle')?.textContent?.trim();
    out.ls = localStorage.getItem('afvi-theme');
    return out;
  })()`);
  console.log(tag, JSON.stringify(state, null, 1));
}

await probe("BEFORE (dark):");
await evaluate(`(() => {
  let el = document.getElementById('afvi-theme-vars');
  if (!el) { el = document.createElement('style'); el.id = 'afvi-theme-vars'; document.head.appendChild(el); }
  el.textContent = ${JSON.stringify(cssOf(LIGHT))};
  localStorage.setItem('afvi-theme', 'light');
})()`);
await new Promise(r => setTimeout(r, 800));
await probe("AFTER IN-PLACE LIGHT:");

const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync("C:\\develop\\DMT_AFVI_Color_Parameter_AutoParse\\plan\\cdp_inplace_light.png", Buffer.from(shot.result.data, "base64"));
console.log("saved cdp_inplace_light.png");
ws.close();
process.exit(0);
