import { FACE_DESCRIPTOR_LENGTH, FACE_MATCH_THRESHOLD, FACE_MODEL_VERSION } from "./faceComparison";

export const ENROLLMENT_SAMPLE_COUNT = 10;
export const VERIFY_SAMPLE_COUNT = 3;
export const MAX_NOTE_LENGTH = 10000;
const VERSION = 1;
const ITERATIONS = 600000;
const MAX_CIPHERTEXT_BYTES = 131072;
const DB_NAME = "face-recognition-local-vault";
const STORE_NAME = "vaults";
const RECORD_ID = "personal";
const openedKeyIds = new WeakMap();

const messages = {
  UNSUPPORTED: "Encrypted storage requires a secure browser with Web Crypto support. Use HTTPS or localhost.",
  INVALID_PASSPHRASE: "Choose a passphrase with at least 12 characters.",
  INVALID_NOTE: "The note must contain no more than 10,000 characters.",
  INVALID_TEMPLATE: "Face samples could not be used. Enroll again with one clearly visible face and small changes in pose.",
  INCONSISTENT_SAMPLES: "The face samples differ too much. Enroll again with the same person in steady lighting.",
  DUPLICATE_SAMPLES: "Capture distinct face samples with small changes in pose before completing enrollment.",
  INCOMPATIBLE_MODEL: "This enrollment uses a different face model. Restore a compatible app version or recover your note with the passphrase.",
  INVALID_RECORD: "This vault is damaged or uses an unsupported format. Restore a valid encrypted backup.",
  UNLOCK_FAILED: "The vault could not be opened. Check the passphrase or restore a valid encrypted backup.",
  STORAGE_FAILED: "The browser could not access local vault storage. Allow site storage and try again.",
  SAVE_FAILED: "The encrypted vault could not be saved. Your previous stored vault has not been intentionally replaced.",
};

export class FaceVaultError extends Error {
  constructor(code) {
    super(messages[code] || messages.SAVE_FAILED);
    this.name = "FaceVaultError";
    this.code = code;
  }
}

export function getVaultErrorMessage(error) {
  return error instanceof FaceVaultError ? messages[error.code] || messages.SAVE_FAILED : messages.SAVE_FAILED;
}

function fail(code) {
  throw new FaceVaultError(code);
}

function cryptoApi() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") fail("UNSUPPORTED");
  return globalThis.crypto;
}

function descriptorArray(descriptor) {
  if ((!Array.isArray(descriptor) && !(descriptor instanceof Float32Array)) || descriptor.length !== FACE_DESCRIPTOR_LENGTH) {
    fail("INVALID_TEMPLATE");
  }
  const values = Array.from(descriptor);
  if (!values.every((value) => Number.isFinite(value) && Math.abs(value) <= 10) || !values.some((value) => value !== 0)) {
    fail("INVALID_TEMPLATE");
  }
  return values;
}

function euclidean(first, second) {
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

export function validateEnrollment(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length !== ENROLLMENT_SAMPLE_COUNT) fail("INVALID_TEMPLATE");
  const references = descriptors.map(descriptorArray);
  for (let first = 0; first < references.length; first += 1) {
    for (let second = first + 1; second < references.length; second += 1) {
      const distance = euclidean(references[first], references[second]);
      if (distance < 0.0001) fail("DUPLICATE_SAMPLES");
      if (distance >= FACE_MATCH_THRESHOLD) fail("INCONSISTENT_SAMPLES");
    }
  }
  return { modelVersion: FACE_MODEL_VERSION, descriptors: references };
}

function validateTemplate(template) {
  if (!template || typeof template !== "object") fail("INVALID_TEMPLATE");
  if (template.modelVersion !== FACE_MODEL_VERSION) fail("INCOMPATIBLE_MODEL");
  return validateEnrollment(template.descriptors);
}

export function verifyFaceSamples(template, samples) {
  const references = validateTemplate(template).descriptors;
  if (!Array.isArray(samples) || samples.length !== VERIFY_SAMPLE_COUNT) fail("INVALID_TEMPLATE");
  const distances = samples.map(descriptorArray).map((sample) => (
    references.reduce((sum, reference) => sum + euclidean(sample, reference), 0) / references.length
  ));
  // This deliberately remains a demonstration threshold. Several frames help
  // stability; they are neither independent evidence nor a liveness check.
  return {
    isMatch: distances.every((distance) => distance < FACE_MATCH_THRESHOLD),
    distance: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    threshold: FACE_MATCH_THRESHOLD,
  };
}

function validateNote(note) {
  if (typeof note !== "string" || note.length > MAX_NOTE_LENGTH) fail("INVALID_NOTE");
}

function passphraseBytes(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 1024) fail("INVALID_PASSPHRASE");
  // Passphrases are exact strings: do not trim, normalize, log, or persist them.
  return new TextEncoder().encode(passphrase);
}

function toBase64(bytes) {
  return btoa(Array.from(new Uint8Array(bytes), (value) => String.fromCharCode(value)).join(""));
}

function fromBase64(value, minBytes, maxBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("INVALID_RECORD");
  }
  let decoded;
  try {
    decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    fail("INVALID_RECORD");
  }
  if (decoded.length < minBytes || decoded.length > maxBytes) fail("INVALID_RECORD");
  return decoded;
}

export function validateVaultRecord(record) {
  if (!record || typeof record !== "object" || record.version !== VERSION) fail("INVALID_RECORD");
  fromBase64(record.id, 16, 16);
  const kdf = record.kdf;
  if (!kdf || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || kdf.iterations !== ITERATIONS) fail("INVALID_RECORD");
  fromBase64(kdf.salt, 16, 16);
  if (!record.wrappedKey || !record.content) fail("INVALID_RECORD");
  fromBase64(record.wrappedKey.iv, 12, 12);
  fromBase64(record.wrappedKey.ciphertext, 48, 48);
  fromBase64(record.content.iv, 12, 12);
  fromBase64(record.content.ciphertext, 17, MAX_CIPHERTEXT_BYTES);
  return {
    version: VERSION,
    id: record.id,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: kdf.salt },
    wrappedKey: { iv: record.wrappedKey.iv, ciphertext: record.wrappedKey.ciphertext },
    content: { iv: record.content.iv, ciphertext: record.content.ciphertext },
  };
}

function aad(record, kind) {
  return new TextEncoder().encode(JSON.stringify({
    application: DB_NAME, version: record.version, id: record.id, kind,
    ...(kind === "wrapped-key" ? { kdf: record.kdf } : {}),
  }));
}

async function deriveWrappingKey(passphrase, kdf) {
  const api = cryptoApi();
  const bytes = passphraseBytes(passphrase);
  try {
    const material = await api.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return await api.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(kdf.salt, 16, 16), iterations: kdf.iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } finally {
    bytes.fill(0);
  }
}

async function encryptContent(record, key, template, note) {
  const normalized = validateTemplate(template);
  validateNote(note);
  const api = cryptoApi();
  const iv = api.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ template: normalized, note }));
  try {
    const ciphertext = await api.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(record, "content") }, key, plaintext);
    return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
  } finally {
    plaintext.fill(0);
  }
}

export async function createVault(passphrase, template, note = "") {
  template = validateTemplate(template);
  validateNote(note);
  passphraseBytes(passphrase).fill(0);
  const api = cryptoApi();
  const record = {
    version: VERSION,
    id: toBase64(api.getRandomValues(new Uint8Array(16))),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: toBase64(api.getRandomValues(new Uint8Array(16))) },
  };
  const rawKey = api.getRandomValues(new Uint8Array(32));
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, record.kdf);
    const iv = api.getRandomValues(new Uint8Array(12));
    const ciphertext = await api.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(record, "wrapped-key") }, wrappingKey, rawKey);
    record.wrappedKey = { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
    const key = await api.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    record.content = await encryptContent(record, key, template, note);
    return record;
  } catch (error) {
    throw error instanceof FaceVaultError ? error : new FaceVaultError("SAVE_FAILED");
  } finally {
    rawKey.fill(0);
  }
}

async function decryptVault(record, passphrase, recoverNote) {
  record = validateVaultRecord(record);
  const api = cryptoApi();
  let rawKey;
  let plaintext;
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, record.kdf);
    rawKey = new Uint8Array(await api.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.wrappedKey.iv, 12, 12), additionalData: aad(record, "wrapped-key") }, wrappingKey, fromBase64(record.wrappedKey.ciphertext, 48, 48)));
    const key = await api.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    plaintext = new Uint8Array(await api.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.content.iv, 12, 12), additionalData: aad(record, "content") }, key, fromBase64(record.content.ciphertext, 17, MAX_CIPHERTEXT_BYTES)));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    validateNote(payload.note);
    const template = recoverNote ? null : validateTemplate(payload.template);
    openedKeyIds.set(key, record.id);
    return { template, note: payload.note, key };
  } catch (error) {
    throw error instanceof FaceVaultError ? error : new FaceVaultError("UNLOCK_FAILED");
  } finally {
    rawKey?.fill(0);
    plaintext?.fill(0);
  }
}

export async function openVault(record, passphrase) {
  return decryptVault(record, passphrase, false);
}

// Recovery still authenticates/decrypts the entire record, but permits reading
// a note when its accompanying face enrollment can no longer be used. Recovery
// never authorizes saving under an unvalidated template; re-enroll instead.
export async function recoverVault(record, passphrase) {
  return decryptVault(record, passphrase, true);
}

export async function saveVaultContent(record, key, template, note) {
  record = validateVaultRecord(record);
  if (!key || openedKeyIds.get(key) !== record.id) fail("UNLOCK_FAILED");
  try {
    return { ...record, content: await encryptContent(record, key, template, note) };
  } catch (error) {
    throw error instanceof FaceVaultError ? error : new FaceVaultError("SAVE_FAILED");
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new FaceVaultError("STORAGE_FAILED"));
      return;
    }
    let request;
    let settled = false;
    try {
      request = globalThis.indexedDB.open(DB_NAME, 1);
    } catch {
      reject(new FaceVaultError("STORAGE_FAILED"));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    const failed = () => {
      if (!settled) {
        settled = true;
        reject(new FaceVaultError("STORAGE_FAILED"));
      }
    };
    request.onerror = failed;
    request.onblocked = failed;
  });
}

async function storageOperation(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    const failed = () => {
      database.close();
      reject(new FaceVaultError("STORAGE_FAILED"));
    };
    try {
      transaction = database.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onerror = failed;
      transaction.onabort = failed;
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = failed;
    } catch {
      transaction?.abort();
      failed();
    }
  });
}

export async function readVaultRecord() {
  const record = await storageOperation("readonly", (store) => store.get(RECORD_ID));
  return record === undefined ? null : validateVaultRecord(record);
}

export async function writeVaultRecord(record) {
  record = validateVaultRecord(record);
  await storageOperation("readwrite", (store) => store.put(record, RECORD_ID));
}

export async function deleteVaultRecord() {
  await storageOperation("readwrite", (store) => store.delete(RECORD_ID));
}
