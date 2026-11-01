import { afterEach, describe, expect, test, vi } from "vitest";
import { collectDeviceCapabilities } from "./deviceCapabilities.js";

function environment() {
  class PublicKeyCredential {}
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn().mockResolvedValue(true);
  return {
    isSecureContext: true,
    PublicKeyCredential,
    navigator: {
      hardwareConcurrency: 12,
      deviceMemory: 8,
      credentials: { create: vi.fn(), get: vi.fn() },
    },
    WebAssembly,
  };
}

afterEach(() => vi.useRealTimers());

describe("authentication capabilities", () => {
  test.each([
    [true, "available"],
    [false, "unavailable"],
  ])("reports platform availability (%s) without requesting credentials", async (available, expected) => {
    const env = environment();
    const probe = env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    probe.mockResolvedValue(available);
    const { authentication } = await collectDeviceCapabilities(env);

    expect(authentication).toEqual({ secureContext: true, webauthnSupported: true, platformAuthenticator: expected });
    expect(probe).toHaveBeenCalledExactlyOnceWith();
    expect(env.navigator.credentials.create).not.toHaveBeenCalled();
    expect(env.navigator.credentials.get).not.toHaveBeenCalled();
  });

  test("does not probe authentication in an insecure context", async () => {
    const env = environment();
    env.isSecureContext = false;
    expect((await collectDeviceCapabilities(env)).authentication).toEqual({
      secureContext: false, webauthnSupported: true, platformAuthenticator: "insecure",
    });
    expect(env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable).not.toHaveBeenCalled();
  });

  test("reports missing WebAuthn APIs separately from unavailable authenticators", async () => {
    const env = environment();
    delete env.PublicKeyCredential;
    expect((await collectDeviceCapabilities(env)).authentication).toEqual({
      secureContext: true, webauthnSupported: false, platformAuthenticator: "unsupported",
    });
  });

  test("can distinguish WebAuthn support from a missing availability check", async () => {
    const env = environment();
    delete env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    expect((await collectDeviceCapabilities(env)).authentication).toEqual({
      secureContext: true, webauthnSupported: true, platformAuthenticator: "unsupported",
    });
  });

  test.each(["reject", "throw"])("reports a failed availability check (%s) without losing other capabilities", async (failure) => {
    const env = environment();
    const probe = env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (failure === "reject") probe.mockRejectedValue(new Error("Private diagnostic"));
    else probe.mockImplementation(() => { throw new Error("Private diagnostic"); });
    const result = await collectDeviceCapabilities(env);
    expect(result.authentication.platformAuthenticator).toBe("error");
    expect(result.cpuThreads).toBe(12);
  });

  test("times out a stalled availability check and handles its later rejection", async () => {
    vi.useFakeTimers();
    const env = environment();
    let rejectProbe;
    env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockReturnValue(new Promise((_, reject) => {
      rejectProbe = reject;
    }));
    const result = collectDeviceCapabilities(env);
    await vi.advanceTimersByTimeAsync(4000);
    expect((await result).authentication.platformAuthenticator).toBe("error");
    rejectProbe(new Error("Late rejection"));
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("compute and storage capabilities", () => {
  test("reports default GPU limits and browser estimates without creating a GPU device", async () => {
    const env = environment();
    const adapter = {
      info: { description: "  Browser GPU  ", isFallbackAdapter: true },
      features: new Set(["shader-f16"]),
      limits: Object.create({ maxBufferSize: 1024, maxStorageBufferBindingSize: 512 }),
      requestDevice: vi.fn(),
    };
    env.navigator.gpu = { requestAdapter: vi.fn().mockResolvedValue(adapter) };
    env.navigator.storage = { estimate: vi.fn().mockResolvedValue({ quota: 2000, usage: 500 }) };
    const result = await collectDeviceCapabilities(env);

    expect(result.gpu).toEqual({
      status: "available", name: "Browser GPU", isFallback: true, supportsFp16: true,
      features: ["shader-f16"], maxBufferSize: 1024, maxStorageBufferBindingSize: 512,
    });
    expect(result.storage).toEqual({ status: "available", remaining: 1500, usage: 500 });
    expect(result).toMatchObject({ cpuThreads: 12, memoryGb: 8, wasmSupported: true, wasmThreads: false });
    expect(env.navigator.gpu.requestAdapter).toHaveBeenCalledExactlyOnceWith();
    expect(adapter.requestDevice).not.toHaveBeenCalled();
  });

  test("handles missing hardware APIs and invalid estimates without invented values", async () => {
    const result = await collectDeviceCapabilities({ navigator: { hardwareConcurrency: 0, deviceMemory: NaN } });
    expect(result).toMatchObject({
      cpuThreads: null, memoryGb: null, wasmSupported: false, wasmThreads: false,
      gpu: { status: "unsupported" }, storage: { status: "unsupported" },
    });
  });

  test("reports a missing adapter and invalid storage quota", async () => {
    const env = environment();
    env.navigator.gpu = { requestAdapter: vi.fn().mockResolvedValue(null) };
    env.navigator.storage = { estimate: vi.fn().mockResolvedValue({ quota: NaN, usage: 2 }) };
    const result = await collectDeviceCapabilities(env);
    expect(result.gpu.status).toBe("unavailable");
    expect(result.storage.status).toBe("unavailable");
  });

  test("keeps failed GPU and storage checks independent from successful authentication", async () => {
    const env = environment();
    env.navigator.gpu = { requestAdapter: vi.fn().mockRejectedValue(new Error("GPU denied")) };
    env.navigator.storage = { estimate: vi.fn().mockRejectedValue(new Error("Storage denied")) };
    const result = await collectDeviceCapabilities(env);
    expect(result.gpu.status).toBe("error");
    expect(result.storage.status).toBe("error");
    expect(result.authentication.platformAuthenticator).toBe("available");
  });

  test("bounds concurrent stalled probes to one timeout and ignores a late GPU adapter", async () => {
    vi.useFakeTimers();
    const env = environment();
    let resolveAdapter;
    const adapter = { requestDevice: vi.fn() };
    env.navigator.gpu = { requestAdapter: vi.fn().mockReturnValue(new Promise((resolve) => { resolveAdapter = resolve; })) };
    env.navigator.storage = { estimate: vi.fn().mockReturnValue(new Promise(() => {})) };
    const result = collectDeviceCapabilities(env);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ gpu: { status: "error" }, storage: { status: "error" } });
    resolveAdapter(adapter);
    await vi.runAllTimersAsync();
    expect(adapter.requestDevice).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("requires isolation and actual shared WASM memory before claiming multithreading", async () => {
    const env = environment();
    class SharedMemory {}
    env.crossOriginIsolated = true;
    env.SharedArrayBuffer = SharedMemory;
    env.Worker = class Worker {};
    env.WebAssembly = { instantiate: vi.fn(), Memory: class Memory { buffer = new SharedMemory(); } };
    expect((await collectDeviceCapabilities(env)).wasmThreads).toBe(true);
    env.crossOriginIsolated = false;
    expect((await collectDeviceCapabilities(env)).wasmThreads).toBe(false);
  });
});
