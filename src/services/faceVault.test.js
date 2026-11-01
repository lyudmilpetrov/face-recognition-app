import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createVault, deleteVaultRecord, ENROLLMENT_SAMPLE_COUNT, FaceVaultError,
  getVaultErrorMessage, openVault, readVaultRecord, recoverVault, saveVaultContent,
  validateEnrollment, validateVaultRecord, verifyFaceSamples, writeVaultRecord,
} from "./faceVault";
import { FACE_MODEL_VERSION } from "./faceComparison";

const passphrase = "a long test passphrase";

function descriptor(offset = 0) {
  const values = new Float32Array(128);
  values[0] = 1;
  values[1] = offset;
  return values;
}

function enrollment() {
  return Array.from({ length: ENROLLMENT_SAMPLE_COUNT }, (_, index) => descriptor(index * 0.01));
}

function template() {
  return validateEnrollment(enrollment());
}

function validRecord() {
  const base64 = (length) => btoa("x".repeat(length));
  return {
    version: 1, id: base64(16),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: base64(16) },
    wrappedKey: { iv: base64(12), ciphertext: base64(48) },
    content: { iv: base64(12), ciphertext: base64(20) },
  };
}

function mockDatabase(result) {
  const operationRequest = { result };
  const store = {
    get: vi.fn(() => operationRequest),
    put: vi.fn(() => operationRequest),
    delete: vi.fn(() => operationRequest),
  };
  const transaction = { objectStore: vi.fn(() => store), abort: vi.fn() };
  const database = { close: vi.fn(), transaction: vi.fn(() => transaction) };
  const openRequest = { result: database };
  vi.stubGlobal("indexedDB", {
    open: vi.fn(() => {
      queueMicrotask(() => openRequest.onsuccess());
      return openRequest;
    }),
  });
  return { database, transaction, store, operationRequest, openRequest };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => vi.unstubAllGlobals());

test("enrollment copies ten consistent distinct feature vectors without mutating their source", () => {
  const samples = enrollment();
  const references = validateEnrollment(samples);
  expect(references.modelVersion).toBe(FACE_MODEL_VERSION);
  expect(references.descriptors).toHaveLength(10);
  samples[0][0] = 2;
  expect(references.descriptors[0][0]).toBe(1);
});

test.each([
  ["missing samples", () => enrollment().slice(1), "INVALID_TEMPLATE"],
  ["duplicate frames", () => Array.from({ length: 10 }, () => descriptor()), "DUPLICATE_SAMPLES"],
  ["different people", () => { const samples = enrollment(); samples[9] = descriptor(1); return samples; }, "INCONSISTENT_SAMPLES"],
  ["non-finite data", () => { const samples = enrollment(); samples[9][10] = NaN; return samples; }, "INVALID_TEMPLATE"],
  ["wrong dimensions", () => { const samples = enrollment(); samples[9] = [1]; return samples; }, "INVALID_TEMPLATE"],
])("enrollment rejects %s", (_label, samples, code) => {
  expect(() => validateEnrollment(samples())).toThrow(expect.objectContaining({ code }));
});

test("verification requires all three fresh frames to match the reference set", () => {
  expect(verifyFaceSamples(template(), [descriptor(0.04), descriptor(0.05), descriptor(0.06)])).toMatchObject({ isMatch: true, threshold: 0.6 });
  const result = verifyFaceSamples(template(), [descriptor(0.04), descriptor(0.05), descriptor(1)]);
  expect(result.distance).toBeLessThan(0.6);
  expect(result.isMatch).toBe(false);
  expect(() => verifyFaceSamples(template(), [descriptor()])).toThrow(expect.objectContaining({ code: "INVALID_TEMPLATE" }));
  expect(() => verifyFaceSamples({ ...template(), modelVersion: "future-model" }, enrollment().slice(0, 3))).toThrow(expect.objectContaining({ code: "INCOMPATIBLE_MODEL" }));
});

test("a JSON-round-tripped record opens without persisting a note, template, passphrase, or usable key", async () => {
  const enrolled = template();
  const note = "private text with emoji 🔑";
  const record = await createVault(passphrase, enrolled, note);
  const serialized = JSON.stringify(record);
  expect(serialized).not.toContain(note);
  expect(serialized).not.toContain(passphrase);
  expect(serialized).not.toContain("descriptors");
  expect(serialized).not.toContain("modelVersion");
  const opened = await openVault(JSON.parse(serialized), passphrase);
  expect(opened.note).toBe(note);
  expect(opened.template).toEqual(enrolled);
  expect(opened.key.extractable).toBe(false);
  await expect(webcrypto.subtle.exportKey("raw", opened.key)).rejects.toThrow();
});

test("wrong passphrases, modified ciphertext, and substituted metadata cannot open the vault", async () => {
  const record = await createVault(passphrase, template(), "protected");
  await expect(openVault(record, "another long passphrase")).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
  const modified = structuredClone(record);
  modified.content.ciphertext = `${modified.content.ciphertext[0] === "A" ? "B" : "A"}${modified.content.ciphertext.slice(1)}`;
  await expect(openVault(modified, passphrase)).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
  const substituted = { ...record, id: btoa("a".repeat(16)) };
  await expect(openVault(substituted, passphrase)).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
});

test("saving uses a fresh content IV, preserves independent key protection, and does not mutate the old record", async () => {
  const record = await createVault(passphrase, template(), "before");
  const original = JSON.stringify(record);
  const opened = await openVault(record, passphrase);
  const next = await saveVaultContent(record, opened.key, opened.template, "after");
  expect(next.content.iv).not.toBe(record.content.iv);
  expect(next.content.ciphertext).not.toBe(record.content.ciphertext);
  expect(next.wrappedKey).toEqual(record.wrappedKey);
  expect(JSON.stringify(record)).toBe(original);
  expect((await openVault(next, passphrase)).note).toBe("after");
  expect((await openVault(record, passphrase)).note).toBe("before");
  await expect(saveVaultContent({ ...record, id: btoa("a".repeat(16)) }, opened.key, opened.template, "lost")).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
});

test("passphrase recovery reads the note despite an incompatible enrollment and still authenticates the record", async () => {
  const record = await createVault(passphrase, template(), "recover this note");
  const opened = await openVault(record, passphrase);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify({
    note: opened.note, template: { ...opened.template, modelVersion: "future-model" },
  }));
  const ciphertext = await webcrypto.subtle.encrypt({
    name: "AES-GCM", iv,
    additionalData: new TextEncoder().encode(JSON.stringify({ application: "face-recognition-local-vault", version: 1, id: record.id, kind: "content" })),
  }, opened.key, bytes);
  const encode = (value) => btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join(""));
  const incompatible = { ...record, content: { iv: encode(iv), ciphertext: encode(ciphertext) } };
  await expect(openVault(incompatible, passphrase)).rejects.toMatchObject({ code: "INCOMPATIBLE_MODEL" });
  const recovered = await recoverVault(incompatible, passphrase);
  expect(recovered).toMatchObject({ note: "recover this note", template: null });
  expect(recovered.key.extractable).toBe(false);
  await expect(recoverVault(incompatible, "another long passphrase")).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
  const damaged = { ...incompatible, content: { ...incompatible.content, iv: btoa("a".repeat(12)) } };
  await expect(recoverVault(damaged, passphrase)).rejects.toMatchObject({ code: "UNLOCK_FAILED" });
});

test("rejects unsupported record formats and excessive key-derivation work before invoking crypto", async () => {
  const api = { getRandomValues: vi.fn(), subtle: { importKey: vi.fn() } };
  vi.stubGlobal("crypto", api);
  const record = validRecord();
  await expect(openVault({ ...record, version: 99 }, passphrase)).rejects.toMatchObject({ code: "INVALID_RECORD" });
  await expect(openVault({ ...record, kdf: { ...record.kdf, iterations: 999999999 } }, passphrase)).rejects.toMatchObject({ code: "INVALID_RECORD" });
  await expect(openVault({ ...record, content: { ...record.content, ciphertext: "A".repeat(200000) } }, passphrase)).rejects.toMatchObject({ code: "INVALID_RECORD" });
  expect(api.subtle.importKey).not.toHaveBeenCalled();
  expect(validateVaultRecord({ ...record, note: "plaintext must be stripped" })).toEqual(record);
});

test("validates passphrases and note sizes and safely describes unexpected failures", async () => {
  await expect(createVault("short", template(), "note")).rejects.toMatchObject({ code: "INVALID_PASSPHRASE" });
  await expect(createVault(passphrase, template(), "x".repeat(10001))).rejects.toMatchObject({ code: "INVALID_NOTE" });
  vi.stubGlobal("crypto", {});
  await expect(createVault(passphrase, template(), "note")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(getVaultErrorMessage(new Error("secret diagnostic"))).not.toContain("secret diagnostic");
  expect(getVaultErrorMessage(new FaceVaultError("UNLOCK_FAILED"))).toMatch(/passphrase/);
});

test("IndexedDB writes wait for transaction completion and strip unexpected plaintext properties", async () => {
  const mock = mockDatabase();
  let settled = false;
  const record = validRecord();
  const pending = writeVaultRecord({ ...record, note: "must not persist" }).then(() => { settled = true; });
  await vi.waitFor(() => expect(mock.store.put).toHaveBeenCalledOnce());
  expect(mock.store.put).toHaveBeenCalledWith(record, "personal");
  mock.operationRequest.onsuccess();
  await Promise.resolve();
  expect(settled).toBe(false);
  mock.transaction.oncomplete();
  await pending;
  expect(mock.database.close).toHaveBeenCalledOnce();
});

test("a storage transaction abort after a successful request still rejects", async () => {
  const mock = mockDatabase();
  const pending = writeVaultRecord(validRecord());
  const assertion = expect(pending).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  await vi.waitFor(() => expect(mock.store.put).toHaveBeenCalledOnce());
  mock.operationRequest.onsuccess();
  mock.transaction.onabort();
  await assertion;
  expect(mock.database.close).toHaveBeenCalled();
});

test("an empty store resolves to null, and stored records are validated before use", async () => {
  let mock = mockDatabase();
  const empty = readVaultRecord();
  await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalledWith("personal"));
  mock.operationRequest.onsuccess();
  mock.transaction.oncomplete();
  await expect(empty).resolves.toBeNull();

  mock = mockDatabase({ version: 99 });
  const invalid = readVaultRecord();
  const assertion = expect(invalid).rejects.toMatchObject({ code: "INVALID_RECORD" });
  await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalled());
  mock.operationRequest.onsuccess();
  mock.transaction.oncomplete();
  await assertion;
});

test("deletion waits for its transaction and unavailable storage is a safe error", async () => {
  const mock = mockDatabase();
  const pending = deleteVaultRecord();
  await vi.waitFor(() => expect(mock.store.delete).toHaveBeenCalledWith("personal"));
  mock.operationRequest.onsuccess();
  mock.transaction.oncomplete();
  await pending;
  vi.stubGlobal("indexedDB", undefined);
  await expect(readVaultRecord()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
});
