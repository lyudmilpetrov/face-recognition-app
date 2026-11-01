import { afterEach, beforeEach, expect, test, vi } from "vitest";

let service;
let registration;
let workers;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  vi.stubEnv("BASE_URL", "/face-recognition-app/");
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  registration = {
    scope: new URL("/face-recognition-app/", window.location.href).href,
    installing: null,
    waiting: null,
    addEventListener: vi.fn(),
    unregister: vi.fn().mockResolvedValue(true),
  };
  workers = {
    controller: null,
    register: vi.fn().mockResolvedValue(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
  };
  vi.stubGlobal("navigator", { serviceWorker: workers });
});

afterEach(async () => {
  await service?.unregister();
  service = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function load() {
  service = await import("./serviceWorkerRegistration.js");
  return service;
}

test("registers a production worker immediately after load with this app's scope and fresh script updates", async () => {
  const { register } = await load();
  register();
  register();
  expect(workers.register).toHaveBeenCalledExactlyOnceWith(
    new URL("/face-recognition-app/service-worker.js", window.location.href).href,
    { scope: "/face-recognition-app/", updateViaCache: "none" }
  );
  await vi.waitFor(() => expect(registration.addEventListener).toHaveBeenCalledWith("updatefound", expect.any(Function)));
});

test("waits for window load only once when the document is still loading", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  const addEventListener = vi.spyOn(window, "addEventListener");
  const { register } = await load();
  register();
  register();
  expect(workers.register).not.toHaveBeenCalled();
  expect(addEventListener).toHaveBeenCalledExactlyOnceWith("load", expect.any(Function), { once: true });
  window.dispatchEvent(new Event("load"));
  window.dispatchEvent(new Event("load"));
  expect(workers.register).toHaveBeenCalledOnce();
});

test("does not register in development or in a browser without service workers", async () => {
  vi.stubEnv("PROD", false);
  const { register } = await load();
  register();
  expect(workers.register).not.toHaveBeenCalled();
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", {});
  register();
  expect(workers.register).not.toHaveBeenCalled();
});

test("rejects a cross-origin deployment base without touching another origin's worker", async () => {
  vi.stubEnv("BASE_URL", "https://cdn.example/face-recognition-app/");
  const { register, unregister } = await load();
  register();
  await unregister();
  expect(workers.register).not.toHaveBeenCalled();
  expect(workers.getRegistration).not.toHaveBeenCalled();
});

test("keeps first-install callbacks without activating updates or reloading the page", async () => {
  const handlers = new Map();
  const worker = { state: "installing", addEventListener: (type, handler) => handlers.set(type, handler), postMessage: vi.fn() };
  registration.installing = worker;
  const onSuccess = vi.fn();
  const onUpdate = vi.fn();
  const { register } = await load();
  register({ onSuccess, onUpdate });
  await vi.waitFor(() => expect(handlers.has("statechange")).toBe(true));
  worker.state = "installed";
  handlers.get("statechange")();
  expect(onSuccess).toHaveBeenCalledWith(registration);
  expect(onUpdate).not.toHaveBeenCalled();
  expect(worker.postMessage).not.toHaveBeenCalled();
});

test("reports an available waiting update without forcing it into an active camera or microphone session", async () => {
  registration.waiting = { postMessage: vi.fn() };
  workers.controller = {};
  const onUpdate = vi.fn();
  const { register } = await load();
  register({ onUpdate });
  await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(registration));
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  expect(registration.unregister).not.toHaveBeenCalled();
});

test("registration failure leaves the online app running without localhost reload or unregister logic", async () => {
  workers.register.mockRejectedValue(new Error("Browser blocked registration"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { register } = await load();
  expect(() => register()).not.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(workers.getRegistration).not.toHaveBeenCalled();
  expect(registration.unregister).not.toHaveBeenCalled();
});

test("unregister cancels a pending load and removes only this app's exact worker scope", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  const { register, unregister } = await load();
  register();
  await expect(unregister()).resolves.toBe(true);
  window.dispatchEvent(new Event("load"));
  expect(workers.register).not.toHaveBeenCalled();
  expect(workers.getRegistration).toHaveBeenCalledWith(registration.scope);
  expect(registration.unregister).toHaveBeenCalledOnce();
});

test("unregister preserves an ancestor registration belonging to another app", async () => {
  registration.scope = new URL("/", window.location.href).href;
  const { unregister } = await load();
  await unregister();
  expect(registration.unregister).not.toHaveBeenCalled();
});
