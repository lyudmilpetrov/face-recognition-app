// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const source = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");

function createWorker(cacheNames = []) {
  const handlers = new Map();
  const caches = {
    keys: vi.fn().mockResolvedValue(cacheNames),
    delete: vi.fn().mockResolvedValue(true),
    open: vi.fn(),
  };
  const self = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const fetch = vi.fn();
  runInNewContext(source, { self, caches, fetch });
  return {
    handlers, caches, self, fetch,
    async activate() {
      let pending;
      handlers.get("activate")({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
  };
}

test("leaves all requests to normal networking without shell caching or forced updates", () => {
  const worker = createWorker();
  expect([...worker.handlers.keys()]).toEqual(["activate"]);
  expect(worker.caches.open).not.toHaveBeenCalled();
  expect(worker.fetch).not.toHaveBeenCalled();
  expect(worker.self.skipWaiting).not.toHaveBeenCalled();
  expect(worker.self.clients.claim).not.toHaveBeenCalled();
});

test("activation removes only this app's old shell caches and preserves downloaded models and other apps", async () => {
  const worker = createWorker([
    "face-recognition-cache-v1", "face-recognition-cache-v2", "face-recognition-cache-v3",
    "transformers-cache", "tensorflow-models", "voice-model-cache", "another-app-shell", "face-recognition-models",
  ]);
  await worker.activate();
  expect(worker.caches.delete.mock.calls.map(([name]) => name)).toEqual([
    "face-recognition-cache-v1", "face-recognition-cache-v2", "face-recognition-cache-v3",
  ]);
  expect(worker.self.clients.claim).not.toHaveBeenCalled();
});

test("storage or individual cache cleanup failures do not block network-only activation", async () => {
  const worker = createWorker(["face-recognition-cache-v1", "face-recognition-cache-v3"]);
  worker.caches.delete.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(worker.activate()).resolves.toBeUndefined();
  expect(worker.caches.delete).toHaveBeenCalledTimes(2);
  worker.caches.keys.mockRejectedValue(new Error("Storage unavailable"));
  await expect(worker.activate()).resolves.toBeUndefined();
});
