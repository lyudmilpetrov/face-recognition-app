import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scratch = path.join(root, '.tmp/voice-verification');
const profile = path.join(scratch, 'chrome-profile');
await mkdir(profile, { recursive: true });
const mimeTypes = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>WASM speaker model validation</title>');
      return;
    }
    const filename = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (!filename.startsWith(`${root}${path.sep}`)) throw new Error('Outside root');
    const bytes = await readFile(filename);
    res.setHeader('content-type', mimeTypes[path.extname(filename)] || 'application/octet-stream');
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', '--remote-allow-origins=*',
  `--user-data-dir=${profile}`, url,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErrors = '';
chrome.stderr.on('data', b => { chromeErrors += b.toString(); });
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      await stat(path.join(profile, 'DevToolsActivePort'));
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!port) throw new Error(`Chrome did not start: ${chromeErrors}`);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = tabs.find(x => x.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (!msg.id) return;
    const deferred = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) deferred.reject(new Error(JSON.stringify(msg.error)));
    else deferred.resolve(msg.result);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  await send('Page.enable', {});
  await send('Page.navigate', { url });
  await new Promise(resolve => setTimeout(resolve, 500));
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/node_modules/onnxruntime-web/dist/ort.wasm.min.js';
        script.onload = resolve; script.onerror = reject;
        document.head.append(script);
      });
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
      const start = performance.now();
      const session = await ort.InferenceSession.create('/.tmp/voice-verification/model_fp16.onnx', { executionProviders: ['wasm'] });
      const loadMs = performance.now() - start;
      const waveform = new Float32Array(48000);
      for (let i = 0; i < waveform.length; i++) {
        const t = i / 16000;
        const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.7 * t);
        waveform[i] = envelope * (0.3 * Math.sin(2 * Math.PI * 130 * t) + 0.15 * Math.sin(2 * Math.PI * 260 * t) + 0.05 * Math.sin(2 * Math.PI * 1200 * t));
      }
      const runStart = performance.now();
      const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', waveform, [1, waveform.length]) });
      const runMs = performance.now() - runStart;
      const name = session.outputNames[0];
      const embedding = Array.from(output[name].data);
      return { userAgent: navigator.userAgent, inputNames: session.inputNames, inputMetadata: session.inputMetadata, outputNames: session.outputNames, outputMetadata: session.outputMetadata, outputType: output[name].type, outputDims: output[name].dims, finite: embedding.every(Number.isFinite), norm: Math.hypot(...embedding), loadMs, runMs, firstValues: embedding.slice(0, 5) };
    })()`,
    awaitPromise: true, returnByValue: true, timeout: 180000,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
