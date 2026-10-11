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
await send("Page.enable");
const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync("C:\\develop\\DMT_AFVI_Color_Parameter_AutoParse\\plan\\cdp_shot.png", Buffer.from(shot.result.data, "base64"));
console.log("saved cdp_shot.png");
ws.close();
process.exit(0);
