// CDP determinism test for the theme toggle (release WebView2).
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
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? r.result?.result?.description ?? JSON.stringify(r.result);
}
await send("Runtime.enable");

async function snapshot(tag) {
  const state = await evaluate(`(() => {
    const host = document.querySelector('.right-panel .host');
    const td = document.querySelector('.param-table td');
    return {
      ls: localStorage.getItem('afvi-theme'),
      bodyTheme: document.body?.dataset.theme,
      glyph: document.querySelector('.theme-toggle')?.textContent?.trim(),
      hostBg: host ? getComputedStyle(host).backgroundColor : null,
      tdColor: td ? getComputedStyle(td).color : null,
      navBg: getComputedStyle(document.querySelector('.top-nav')).backgroundColor,
    };
  })()`);
  console.log(tag, JSON.stringify(state));
}

await snapshot("BEFORE:");

// Programmatic click (DOM click - same as a real user's press).
await evaluate(`document.querySelector('.theme-toggle').click()`);
await new Promise(r => setTimeout(r, 4000));
await snapshot("AFTER-CLICK-1:");
await evaluate(`document.querySelector('.theme-toggle').click()`);
await new Promise(r => setTimeout(r, 4000));
await snapshot("AFTER-CLICK-2:");
ws.close();
process.exit(0);
