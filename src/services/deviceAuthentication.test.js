import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { checkDeviceAuthenticationSupport, decodeEs256Signature, getDeviceAuthenticationErrorMessage, registerDevice, verifyDevice } from "./deviceAuthentication.js";

const credentialId = new Uint8Array([19, 27, 42, 81]);
const origin = "https://example.test";
let keys;
let spki;

function base64url(value) {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function clientData(type, challenge, overrides = {}) {
  return new TextEncoder().encode(JSON.stringify({ type, challenge: base64url(challenge), origin, crossOrigin: false, ...overrides }));
}

async function authenticatorData({ registration = false, flags = 5, count = 0, rpId = "example.test" } = {}) {
  const data = new Uint8Array(registration ? 55 + credentialId.length + 1 : 37);
  data.set(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId))));
  data[32] = flags | (registration ? 0x40 : 0);
  new DataView(data.buffer).setUint32(33, count);
  if (registration) {
    new DataView(data.buffer).setUint16(53, credentialId.length);
    data.set(credentialId, 55);
  }
  return data;
}

function asDer(raw) {
  const integers = [raw.subarray(0, 32), raw.subarray(32)].map((part) => {
    let first = 0;
    while (first < part.length - 1 && part[first] === 0) first += 1;
    const value = Array.from(part.subarray(first));
    if (value[0] & 0x80) value.unshift(0);
    return [2, value.length, ...value];
  }).flat();
  return new Uint8Array([0x30, integers.length, ...integers]);
}

function environment() {
  function PublicKeyCredential() {}
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = vi.fn().mockResolvedValue(true);
  return {
    isSecureContext: true,
    PublicKeyCredential,
    crypto: webcrypto,
    location: { hostname: "example.test", origin },
    navigator: {
      credentials: {
        create: vi.fn(async ({ publicKey }) => ({
          type: "public-key",
          id: base64url(credentialId),
          rawId: credentialId.buffer,
          response: {
            clientDataJSON: clientData("webauthn.create", publicKey.challenge),
            getAuthenticatorData: () => publicKey.authData,
            getPublicKey: () => spki,
            getPublicKeyAlgorithm: () => -7,
          },
        })),
        get: vi.fn(),
      },
    },
  };
}

async function registeredEnvironment() {
  const env = environment();
  const registrationData = await authenticatorData({ registration: true });
  const create = env.navigator.credentials.create.getMockImplementation();
  env.navigator.credentials.create.mockImplementation((options) => create({ ...options, publicKey: { ...options.publicKey, authData: registrationData } }));
  return { env, registration: await registerDevice({ env }) };
}

function mockAssertion(env, { clientOverrides = {}, flags = 5, count = 0, rpId, tamper = false, id = credentialId } = {}) {
  env.navigator.credentials.get.mockImplementation(async ({ publicKey }) => {
    const json = clientData("webauthn.get", publicKey.challenge, clientOverrides);
    const authData = await authenticatorData({ flags, count, rpId });
    const hash = new Uint8Array(await webcrypto.subtle.digest("SHA-256", json));
    const signed = new Uint8Array(authData.length + hash.length);
    signed.set(authData);
    signed.set(hash, authData.length);
    const raw = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
    if (tamper) raw[10] ^= 1;
    return { type: "public-key", id: base64url(id), rawId: id, response: { clientDataJSON: json, authenticatorData: authData, signature: asDer(raw), userHandle: null } };
  });
}

beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  spki = await webcrypto.subtle.exportKey("spki", keys.publicKey);
});

test("availability check needs a secure context and never creates a credential", async () => {
  const env = environment();
  expect(await checkDeviceAuthenticationSupport({ ...env, isSecureContext: false })).toBe("unsupported");
  expect(await checkDeviceAuthenticationSupport(env)).toBe("available");
  env.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(false);
  expect(await checkDeviceAuthenticationSupport(env)).toBe("unavailable");
  expect(env.navigator.credentials.create).not.toHaveBeenCalled();
});

test("registers a platform credential and verifies an actual signed fresh assertion", async () => {
  const { env, registration } = await registeredEnvironment();
  const options = env.navigator.credentials.create.mock.calls[0][0].publicKey;
  expect(options.authenticatorSelection).toMatchObject({ authenticatorAttachment: "platform", userVerification: "required" });
  expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
  mockAssertion(env, { count: 1 });
  const verified = await verifyDevice(registration, { env });
  expect(verified.signCount).toBe(1);
  const request = env.navigator.credentials.get.mock.calls[0][0].publicKey;
  expect(request.userVerification).toBe("required");
  expect(request.challenge).not.toEqual(options.challenge);
});

describe("rejects invalid signed assertions", () => {
  test.each([
    ["different challenge", { clientOverrides: { challenge: "replayed-challenge" } }],
    ["different origin", { clientOverrides: { origin: "https://attacker.test" } }],
    ["cross-origin ceremony", { clientOverrides: { crossOrigin: true } }],
    ["wrong ceremony", { clientOverrides: { type: "webauthn.create" } }],
    ["missing user verification", { flags: 1 }],
    ["different RP", { rpId: "attacker.test" }],
    ["tampered signature", { tamper: true }],
    ["different credential", { id: new Uint8Array([91, 92]) }],
  ])("%s", async (_, options) => {
    const { env, registration } = await registeredEnvironment();
    mockAssertion(env, options);
    await expect(verifyDevice(registration, { env })).rejects.toMatchObject({ code: "INVALID" });
  });
});

test("rejects replayed nonzero counters and cancelled results", async () => {
  const { env, registration } = await registeredEnvironment();
  mockAssertion(env, { count: 2 });
  const verified = await verifyDevice(registration, { env });
  await expect(verifyDevice(verified, { env })).rejects.toMatchObject({ code: "INVALID" });
  const controller = new AbortController();
  controller.abort();
  env.navigator.credentials.get.mockClear();
  await expect(verifyDevice(registration, { env, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
  expect(env.navigator.credentials.get).not.toHaveBeenCalled();
});

test("accepts valid DER sign padding and rejects malformed signatures", () => {
  const raw = new Uint8Array(64);
  raw[0] = 0x82;
  raw[32] = 0x95;
  expect(decodeEs256Signature(asDer(raw))).toEqual(raw);
  expect(() => decodeEs256Signature(new Uint8Array([0x30, 6, 2, 1, 0xff, 2, 1, 1]))).toThrow();
  expect(() => decodeEs256Signature(new Uint8Array([0x30, 7, 2, 2, 0, 1, 2, 1, 1]))).toThrow();
});

test("maps browser errors without exposing exception details", async () => {
  const env = environment();
  env.navigator.credentials.create.mockRejectedValue(new DOMException("private platform details", "NotAllowedError"));
  await expect(registerDevice({ env })).rejects.toMatchObject({ code: "CANCELLED" });
  expect(getDeviceAuthenticationErrorMessage(new Error("private platform details"))).not.toContain("private platform details");
});
