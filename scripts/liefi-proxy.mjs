// Lie-fi proxy: every TCP connection from the browser is accepted, and in
// blackhole mode nothing ever comes back - existing tunnels drop every byte,
// new CONNECTs are "established" and then silent. navigator.onLine stays true.
//
// This is what reproduced Matt's "my phone thought I had a connection, but
// basically did not" (2026-09-23) when CDP network throttling could not: DevTools
// throttling never touches service-worker or websocket traffic, and "slow" is
// not "dead". See docs/history/data-and-offline.md, "Lie-fi".
//
//   node scripts/liefi-proxy.mjs          # proxy on :8888, control on :8889
//   curl localhost:8889/mode/blackhole    # kill the internet, keep the bars
//   curl localhost:8889/mode/pass         # bring it back
//
// Drive a browser through it with Playwright:
//   chromium.launch({ proxy: { server: 'http://127.0.0.1:8888', bypass: '<-loopback>' } })
// ('<-loopback>' forces localhost - a locally served dist/ - through the proxy
// too.) Serve dist/ with `python3 -m http.server 8089 --directory dist`, sign in
// with `yarn mint-test-token --seed-from mattgrosso-gmail-com`, wait for the
// service worker to precache, THEN switch to blackhole. Screenshots under
// blackhole must use CDP Page.captureScreenshot: page.screenshot() waits for
// fonts that will never load.
import net from 'node:net';
import http from 'node:http';
let mode = 'pass';
const tunnels = new Set();
const relay = (from, to) => {
  from.on('data', (chunk) => { if (mode === 'pass') { if (!to.write(chunk)) { from.pause(); to.once('drain', () => from.resume()); } } });
  from.on('end', () => { if (mode === 'pass') to.end(); });
  from.on('error', () => to.destroy());
};
const proxy = http.createServer((req, res) => {
  // plain http (localhost dist server)
  if (mode !== 'pass') { tunnels.add(res); return; } // hold forever
  const u = new URL(req.url);
  const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
  up.on('error', () => res.destroy());
  req.pipe(up);
});
proxy.on('connect', (req, client, head) => {
  const [host, port] = req.url.split(':');
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (mode !== 'pass') { client.on('data', () => {}); client.on('error', () => {}); tunnels.add(client); return; }
  const upstream = net.connect(Number(port || 443), host, () => { if (head?.length) upstream.write(head); });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  relay(client, upstream); relay(upstream, client);
});
proxy.listen(8888);
http.createServer((req, res) => {
  const m = req.url.match(/^\/mode\/(pass|blackhole)$/);
  if (m) { mode = m[1]; res.end(`mode=${mode}\n`); console.log(new Date().toISOString(), 'mode ->', mode); return; }
  res.end(`mode=${mode}\n`);
}).listen(8889);
console.log('lie-fi proxy on 8888, control on 8889');
