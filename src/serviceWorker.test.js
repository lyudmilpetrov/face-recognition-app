// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const source = readFileSync(
  new URL("../public/service-worker.js", import.meta.url),
  "utf8"
);
const ORIGIN = "https://lyudmilpetrov.github.io";
const BASE_URL = `${ORIGIN}/face-recognition-app/`;
const CACHE_NAME = "face-recognition-cache-v3";

function shellResponse(text) {
  return new Response(text, { headers: { "Content-Type": "text/html" } });
}

function createWorker({ cacheNames = [], cacheUnavailable = false, cacheWritesFail = false } = {}) {
  const handlers = new Map();
  const buckets = new Map(cacheNames.map((name) => [name, new Map()]));
  const fetch = vi.fn(async () => shellResponse("Online shell"));
  const key = (request) => request.url ?? String(request);
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: vi.fn(async (name) => buckets.delete(name)),
    open: async (name) => {
      if (cacheUnavailable) throw new Error("Storage unavailable");
      if (!buckets.has(name)) buckets.set(name, new Map());
      const entries = buckets.get(name);
      const put = async (request, response) => {
        if (cacheWritesFail) throw new Error("Storage quota exceeded");
        entries.set(key(request), response.clone());
      };
      return {
        match: async (request) => entries.get(key(request))?.clone(),
        put,
        addAll: async (urls) => {
          await Promise.all(urls.map(async (url) => put(url, await fetch(url))));
        },
        add: async (url) => put(url, await fetch(url)),
      };
    },
  };
  const self = {
    location: { href: `${BASE_URL}service-worker.js` },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  runInNewContext(source, { URL, Response, self, caches, fetch });

  return {
    buckets,
    caches,
    fetch,
    self,
    seed: async (url, text) => {
      await (await caches.open(CACHE_NAME)).put(url, new Response(text));
    },
    dispatch: async (type) => {
      const pending = [];
      handlers.get(type)({ waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
    request: async (url, { method = "GET", mode = "cors", headers = {} } = {}) => {
      let response;
      handlers.get("fetch")({
        request: { url, method, mode, headers: new Headers(headers) },
        respondWith: (promise) => { response = promise; },
      });
      return { intercepted: response !== undefined, response: await response };
    },
  };
}

test("successive deployments refresh the shell without changing the worker", async () => {
  const worker = createWorker();
  await worker.seed(`${BASE_URL}index.html`, "Old deployment");

  worker.fetch.mockResolvedValueOnce(shellResponse("First deployment"));
  const first = await worker.request(BASE_URL, { mode: "navigate" });
  expect(await first.response.text()).toBe("First deployment");

  worker.fetch.mockResolvedValueOnce(shellResponse("Second deployment"));
  const second = await worker.request(`${BASE_URL}index.html`, { mode: "navigate" });
  expect(await second.response.text()).toBe("Second deployment");
  expect(worker.fetch).toHaveBeenCalledTimes(2);
  expect(worker.fetch.mock.calls.every(([, options]) => options.cache === "no-cache")).toBe(true);

  worker.fetch.mockRejectedValue(new Error("Offline"));
  const offline = await worker.request(BASE_URL, { mode: "navigate" });
  expect(await offline.response.text()).toBe("Second deployment");
});

test("installation caches the app shell under the deployment subpath", async () => {
  const worker = createWorker();
  await worker.dispatch("install");

  expect([...worker.buckets.get(CACHE_NAME).keys()]).toEqual([
    BASE_URL,
    `${BASE_URL}index.html`,
    `${BASE_URL}manifest.json`,
    `${BASE_URL}favicon.ico`,
    `${BASE_URL}logo192.png`,
    `${BASE_URL}logo512.png`,
  ]);
  expect(worker.self.skipWaiting).toHaveBeenCalledOnce();

  worker.fetch.mockRejectedValue(new Error("Offline"));
  const offline = await worker.request(BASE_URL, { mode: "navigate" });
  expect(await offline.response.text()).toBe("Online shell");
});

test("activation preserves caches belonging to other GitHub Pages apps and models", async () => {
  const preserved = [CACHE_NAME, "app-shell-v2", "tensorflow-models", "another-site"];
  const worker = createWorker({
    cacheNames: ["face-recognition-cache-v1", "face-recognition-cache-v2", ...preserved],
  });
  await worker.dispatch("activate");

  expect([...worker.buckets.keys()]).toEqual(preserved);
  expect(worker.self.clients.claim).toHaveBeenCalledOnce();
});

test("unrelated origins, paths, model requests, writes and ranges bypass the worker", async () => {
  const worker = createWorker();
  for (const [url, options] of [
    ["https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1"],
    [`${ORIGIN}/client-side-free-ai/`, { mode: "navigate" }],
    [`${ORIGIN}/assets/app-12345678.js`],
    [`${BASE_URL}api/profile`],
    [`${BASE_URL}model.json`],
    [`${BASE_URL}assets/model-12345678.bin`],
    [`${BASE_URL}assets/model-12345678.json`],
    [`${BASE_URL}assets/unhashed.js`],
    [`${BASE_URL}assets/app-12345678.js`, { method: "POST" }],
    [`${BASE_URL}assets/app-12345678.js`, { headers: { Range: "bytes=0-15" } }],
  ]) {
    expect((await worker.request(url, options)).intercepted, url).toBe(false);
  }
  expect(worker.fetch).not.toHaveBeenCalled();
  expect(worker.buckets.size).toBe(0);
});

test("compiled assets remain usable offline without substituting HTML for missing assets", async () => {
  const worker = createWorker();
  const assetUrl = `${BASE_URL}assets/index-aB12_cD3.js`;
  await worker.seed(`${BASE_URL}index.html`, "Cached shell");
  worker.fetch.mockResolvedValueOnce(new Response("Compiled application"));
  expect(await (await worker.request(assetUrl)).response.text()).toBe("Compiled application");

  worker.fetch.mockRejectedValue(new Error("Offline"));
  expect(await (await worker.request(assetUrl)).response.text()).toBe("Compiled application");
  await expect(worker.request(`${BASE_URL}assets/missing-aB12_cD3.js`)).rejects.toThrow("Offline");
});

test("deployment outages can use the last shell without disguising missing pages", async () => {
  const worker = createWorker();
  await worker.seed(`${BASE_URL}index.html`, "Cached shell");
  worker.fetch.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
  expect(await (await worker.request(BASE_URL, { mode: "navigate" })).response.text()).toBe("Cached shell");

  worker.fetch.mockResolvedValueOnce(new Response("Missing", { status: 404 }));
  const missing = await worker.request(`${BASE_URL}missing`, { mode: "navigate" });
  expect(missing.response.status).toBe(404);
  expect(await missing.response.text()).toBe("Missing");
});

test("unavailable browser storage does not prevent online navigation", async () => {
  const worker = createWorker({ cacheUnavailable: true });
  const online = await worker.request(BASE_URL, { mode: "navigate" });
  expect(await online.response.text()).toBe("Online shell");
});

test("cache quota failures do not discard successful navigation or asset responses", async () => {
  const worker = createWorker({ cacheWritesFail: true });
  const page = await worker.request(BASE_URL, { mode: "navigate" });
  expect(await page.response.text()).toBe("Online shell");
  const asset = await worker.request(`${BASE_URL}assets/index-aB12_cD3.js`);
  expect(await asset.response.text()).toBe("Online shell");
});

test("opening a non-HTML file does not replace the offline application shell", async () => {
  const worker = createWorker();
  await worker.seed(`${BASE_URL}index.html`, "Cached application");
  worker.fetch.mockResolvedValueOnce(new Response("{}", {
    headers: { "Content-Type": "application/json" },
  }));
  const manifest = await worker.request(`${BASE_URL}manifest.json`, { mode: "navigate" });
  expect(await manifest.response.text()).toBe("{}");

  worker.fetch.mockRejectedValue(new Error("Offline"));
  expect(await (await worker.request(BASE_URL, { mode: "navigate" })).response.text()).toBe("Cached application");
});

test("first installation prepares the compiled shell for an offline reload", async () => {
  const worker = createWorker();
  const html = `<script type="module" src="./assets/index-aB12_cD3.js"></script>
    <link rel="stylesheet" href="./assets/index-aB12_cD3.css">
    <script src="https://other.example/assets/remote-12345678.js"></script>
    <script src="/assets/another-app-12345678.js"></script>
    <script data-src="./assets/unused-12345678.js"></script>`;
  worker.fetch.mockImplementation(async (url) => new Response(
    url === `${BASE_URL}index.html` ? html : "Cached asset"
  ));
  await worker.dispatch("install");
  expect(worker.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes("/assets/"))).toEqual([
    `${BASE_URL}assets/index-aB12_cD3.js`,
    `${BASE_URL}assets/index-aB12_cD3.css`,
  ]);

  worker.fetch.mockRejectedValue(new Error("Offline"));
  expect(await (await worker.request(BASE_URL, { mode: "navigate" })).response.text()).toBe(html);
  expect(await (await worker.request(`${BASE_URL}assets/index-aB12_cD3.js`)).response.text()).toBe("Cached asset");
  expect(await (await worker.request(`${BASE_URL}assets/index-aB12_cD3.css`)).response.text()).toBe("Cached asset");
});
