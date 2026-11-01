import { afterEach, expect, test, vi } from "vitest";
import { cosineSimilarity, loadSpeakerModel, MODEL_URL } from "./speakerModel.js";

afterEach(() => vi.unstubAllGlobals());

test("cosine compares direction independently of volume and handles distinct voices", () => {
  expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
});

test.each([[[], []], [[0, 0], [1, 1]], [[1], [1, 2]], [[NaN], [1]], [[Infinity], [1]]])(
  "rejects invalid embeddings instead of producing a misleading score (%j, %j)",
  (a, b) => expect(() => cosineSimilarity(a, b)).toThrow(),
);

test("reuses cached model weights without any network request", async () => {
  const bytes = { byteLength: 42324080 };
  const cache = { match: vi.fn().mockResolvedValue({ arrayBuffer: async () => bytes }) };
  vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue(cache) });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await loadSpeakerModel(vi.fn())).toBe(bytes);
  expect(cache.match).toHaveBeenCalledWith(MODEL_URL);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("downloads only pinned static model weights and tolerates disabled caching", async () => {
  const bytes = { byteLength: 42324080 };
  const response = { ok: true, clone: () => ({ arrayBuffer: async () => bytes }) };
  vi.stubGlobal("caches", { open: vi.fn().mockRejectedValue(new Error("Storage denied")) });
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  expect(await loadSpeakerModel(vi.fn())).toBe(bytes);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(MODEL_URL, {
    credentials: "omit", referrerPolicy: "no-referrer",
  });
});

test("network errors produce a safe retry message", async () => {
  vi.stubGlobal("caches", undefined);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Internal diagnostic")));
  await expect(loadSpeakerModel(vi.fn())).rejects.toThrow("Unable to download the speaker model");
});
