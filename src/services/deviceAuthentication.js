// A local WebAuthn demonstration. Server accounts must verify assertions on a
// trusted server; successful browser checks do not grant server permissions.
const messages = {
  UNSUPPORTED: "Device authentication is unavailable. Use HTTPS or localhost in a browser with WebAuthn and Web Crypto support.",
  UNAVAILABLE: "No device authenticator is available. Set up Windows Hello, Touch ID, or your device's screen lock first.",
  CANCELLED: "Device authentication was cancelled or timed out. You can try again.",
  INVALID: "The device response could not be verified. Register the device again and retry.",
  FAILED: "Unable to complete device authentication. Check your device sign-in settings and try again.",
};

export class DeviceAuthenticationError extends Error {
  constructor(code) {
    super(messages[code] || messages.FAILED);
    this.name = "DeviceAuthenticationError";
    this.code = code;
  }
}

export function getDeviceAuthenticationErrorMessage(error) {
  return error instanceof DeviceAuthenticationError ? messages[error.code] || messages.FAILED : messages.FAILED;
}

function invalid() {
  throw new DeviceAuthenticationError("INVALID");
}

function bytes(value, min = 1, max = 8192) {
  if (!ArrayBuffer.isView(value)) {
    // Brand-check across browser realms without trusting a toStringTag value.
    try {
      ArrayBuffer.prototype.slice.call(value, 0, 0);
    } catch {
      invalid();
    }
  }
  const result = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  if (result.length < min || result.length > max) invalid();
  return result;
}

function equal(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function encodeBase64url(value) {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function prerequisites(env) {
  return env.isSecureContext === true
    && typeof env.PublicKeyCredential === "function"
    && typeof env.navigator?.credentials?.create === "function"
    && typeof env.navigator?.credentials?.get === "function"
    && typeof env.crypto?.getRandomValues === "function"
    && Boolean(env.crypto?.subtle)
    && Boolean(env.location?.hostname)
    && env.location?.origin !== "null";
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new DeviceAuthenticationError("CANCELLED");
}

function normalizeError(error) {
  if (error instanceof DeviceAuthenticationError) return error;
  if (error?.name === "AbortError" || error?.name === "NotAllowedError") {
    return new DeviceAuthenticationError("CANCELLED");
  }
  if (error?.name === "NotSupportedError") return new DeviceAuthenticationError("UNSUPPORTED");
  return new DeviceAuthenticationError("FAILED");
}

export async function checkDeviceAuthenticationSupport(env = globalThis) {
  if (!prerequisites(env)) return "unsupported";
  if (typeof env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return "unsupported";
  let timer;
  try {
    // This availability check never requests a fingerprint or opens sign-in UI.
    const available = await Promise.race([
      env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 4000); }),
    ]);
    return available ? "available" : "unavailable";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

function validateClientData(response, type, challenge, origin) {
  const encoded = bytes(response.clientDataJSON);
  let data;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
  } catch {
    invalid();
  }
  if (data.type !== type || data.challenge !== encodeBase64url(challenge) || data.origin !== origin || data.crossOrigin === true) invalid();
  return encoded;
}

async function validateAuthenticatorData(value, rpId, env) {
  const data = bytes(value, 37);
  const rpHash = new Uint8Array(await env.crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  // Both user presence and user verification must be asserted by the device.
  if (!equal(data.subarray(0, 32), rpHash) || (data[32] & 0x05) !== 0x05) invalid();
  if ((data[32] & 0x10) && !(data[32] & 0x08)) invalid();
  return { data, signCount: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(33), backupEligible: Boolean(data[32] & 0x08) };
}

function validateCredential(credential) {
  if (credential?.type !== "public-key" || !credential.response) invalid();
  const id = bytes(credential.rawId, 1, 1024);
  if (credential.id !== encodeBase64url(id)) invalid();
  return id;
}

// WebAuthn ES256 signatures use ASN.1 DER; Web Crypto expects fixed-width r || s.
// Only canonical P-256 integers are accepted, with a leading sign byte as needed.
export function decodeEs256Signature(signature) {
  const encoded = bytes(signature, 8, 72);
  if (encoded[0] !== 0x30 || encoded[1] !== encoded.length - 2) invalid();
  const raw = new Uint8Array(64);
  let offset = 2;
  for (let part = 0; part < 2; part += 1) {
    if (encoded[offset++] !== 0x02) invalid();
    const length = encoded[offset++];
    if (length < 1 || length > 33 || offset + length > encoded.length) invalid();
    let integer = encoded.subarray(offset, offset + length);
    offset += length;
    if (integer[0] & 0x80) invalid();
    if (integer.length > 1 && integer[0] === 0) {
      if (!(integer[1] & 0x80)) invalid();
      integer = integer.subarray(1);
    }
    if (integer.length > 32) invalid();
    raw.set(integer, part * 32 + 32 - integer.length);
  }
  if (offset !== encoded.length) invalid();
  return raw;
}

export async function registerDevice({ signal, env = globalThis } = {}) {
  try {
    checkCancelled(signal);
    if (!prerequisites(env)) throw new DeviceAuthenticationError("UNSUPPORTED");
    const challenge = env.crypto.getRandomValues(new Uint8Array(32));
    const userId = env.crypto.getRandomValues(new Uint8Array(32));
    const rpId = env.location.hostname;
    const origin = env.location.origin;
    const credential = await env.navigator.credentials.create({
      signal,
      publicKey: {
        challenge,
        rp: { id: rpId, name: "Face Recognition App" },
        user: { id: userId, name: "local-device-demo", displayName: "Local device demo" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
        attestation: "none",
        timeout: 60000,
      },
    });
    checkCancelled(signal);
    const credentialId = validateCredential(credential);
    const response = credential.response;
    validateClientData(response, "webauthn.create", challenge, origin);
    if (typeof response.getPublicKey !== "function" || typeof response.getAuthenticatorData !== "function" || response.getPublicKeyAlgorithm?.() !== -7) {
      throw new DeviceAuthenticationError("UNSUPPORTED");
    }
    const auth = await validateAuthenticatorData(response.getAuthenticatorData(), rpId, env);
    if (!(auth.data[32] & 0x40) || auth.data.length < 55) invalid();
    const credentialLength = new DataView(auth.data.buffer, auth.data.byteOffset, auth.data.byteLength).getUint16(53);
    if (!equal(auth.data.subarray(55, 55 + credentialLength), credentialId)) invalid();
    const publicKey = await env.crypto.subtle.importKey("spki", bytes(response.getPublicKey()), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    checkCancelled(signal);
    return { credentialId: credentialId.slice(), userId, publicKey, rpId, origin, signCount: auth.signCount, backupEligible: auth.backupEligible };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function verifyDevice(registration, { signal, env = globalThis } = {}) {
  try {
    checkCancelled(signal);
    if (!prerequisites(env)) throw new DeviceAuthenticationError("UNSUPPORTED");
    if (!registration || registration.rpId !== env.location.hostname || registration.origin !== env.location.origin || !registration.publicKey) invalid();
    const credentialId = bytes(registration.credentialId, 1, 1024);
    const challenge = env.crypto.getRandomValues(new Uint8Array(32));
    const credential = await env.navigator.credentials.get({
      signal,
      publicKey: { challenge, rpId: registration.rpId, allowCredentials: [{ type: "public-key", id: credentialId, transports: ["internal"] }], userVerification: "required", timeout: 60000 },
    });
    checkCancelled(signal);
    if (!equal(validateCredential(credential), credentialId)) invalid();
    const response = credential.response;
    const clientData = validateClientData(response, "webauthn.get", challenge, registration.origin);
    if (response.userHandle != null && !equal(bytes(response.userHandle, 1, 64), bytes(registration.userId, 1, 64))) invalid();
    const auth = await validateAuthenticatorData(response.authenticatorData, registration.rpId, env);
    if (auth.backupEligible !== registration.backupEligible || ((registration.signCount || auth.signCount) && auth.signCount <= registration.signCount)) invalid();
    const clientHash = new Uint8Array(await env.crypto.subtle.digest("SHA-256", clientData));
    const signed = new Uint8Array(auth.data.length + clientHash.length);
    signed.set(auth.data);
    signed.set(clientHash, auth.data.length);
    const verified = await env.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, registration.publicKey, decodeEs256Signature(response.signature), signed);
    checkCancelled(signal);
    if (!verified) invalid();
    return { ...registration, signCount: auth.signCount };
  } catch (error) {
    throw normalizeError(error);
  }
}
