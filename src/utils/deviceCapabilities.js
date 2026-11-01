const PROBE_TIMEOUT_MS = 4000;

async function withTimeout(probe) {
  let timeout;
  try {
    // The race also handles a probe that settles after its timeout.
    return await Promise.race([
      Promise.resolve().then(probe),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Device check timed out")), PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function supportsWasmThreads(env) {
  if (!env.crossOriginIsolated || !env.SharedArrayBuffer || !env.Worker) return false;
  try {
    return new env.WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof env.SharedArrayBuffer;
  } catch {
    return false;
  }
}

async function detectGpu(nav) {
  try {
    if (typeof nav?.gpu?.requestAdapter !== "function") return { status: "unsupported" };
    // Inspect the default adapter without allocating a GPU device or buffers.
    const adapter = await withTimeout(() => nav.gpu.requestAdapter());
    if (!adapter) return { status: "unavailable" };

    const info = adapter.info;
    const name = info?.description?.trim() || [info?.vendor, info?.architecture].filter(Boolean).join(" ");
    return {
      status: "available",
      name: name || "Name hidden by browser",
      isFallback: Boolean(info?.isFallbackAdapter ?? adapter.isFallbackAdapter),
      supportsFp16: adapter.features.has("shader-f16"),
      features: Array.from(adapter.features),
      // WebIDL limits can live on the prototype, so read attributes directly.
      maxBufferSize: positiveNumber(adapter.limits.maxBufferSize),
      maxStorageBufferBindingSize: positiveNumber(adapter.limits.maxStorageBufferBindingSize),
    };
  } catch {
    return { status: "error" };
  }
}

async function detectStorage(nav) {
  try {
    if (typeof nav?.storage?.estimate !== "function") return { status: "unsupported" };
    const { quota, usage } = await withTimeout(() => nav.storage.estimate());
    if (!Number.isFinite(quota) || !Number.isFinite(usage) || quota < 0 || usage < 0) {
      return { status: "unavailable" };
    }
    return { status: "available", remaining: Math.max(0, quota - usage), usage };
  } catch {
    return { status: "error" };
  }
}

async function detectAuthentication(env) {
  const secureContext = env.isSecureContext === true;
  const credentialType = env.PublicKeyCredential;
  const credentials = env.navigator?.credentials;
  const webauthnSupported = typeof credentialType === "function"
    && typeof credentials?.create === "function"
    && typeof credentials?.get === "function";
  const result = { secureContext, webauthnSupported };

  if (!secureContext) return { ...result, platformAuthenticator: "insecure" };
  if (!webauthnSupported || typeof credentialType.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return { ...result, platformAuthenticator: "unsupported" };
  }

  try {
    // Availability never tells a site whether fingerprint, face, or PIN is used.
    // This check does not open a sign-in prompt or enroll a credential.
    const available = await withTimeout(() => credentialType.isUserVerifyingPlatformAuthenticatorAvailable());
    return { ...result, platformAuthenticator: available ? "available" : "unavailable" };
  } catch {
    return { ...result, platformAuthenticator: "error" };
  }
}

export async function collectDeviceCapabilities(env = globalThis) {
  const nav = env.navigator;
  const cpuThreads = positiveNumber(nav?.hardwareConcurrency);
  const memoryGb = positiveNumber(nav?.deviceMemory);
  const wasmSupported = typeof env.WebAssembly?.instantiate === "function";
  const wasmThreads = wasmSupported && supportsWasmThreads(env);
  const [gpu, storage, authentication] = await Promise.all([
    detectGpu(nav), detectStorage(nav), detectAuthentication(env),
  ]);

  return { cpuThreads, memoryGb, wasmSupported, wasmThreads, gpu, storage, authentication };
}
