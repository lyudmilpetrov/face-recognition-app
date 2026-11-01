// @vitest-environment node
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, test } from "vitest";

const publicRoot = new URL("../public/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", publicRoot), "utf8"));
const document = new JSDOM(readFileSync(new URL("../index.html", import.meta.url), "utf8")).window.document;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngSize(bytes) {
  expect(bytes.subarray(0, 8)).toEqual(pngSignature);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test.each(["/", "/face-recognition-app/"])("keeps installation identity, launch URLs, and icon URLs within deployment scope %s", (base) => {
  const manifestUrl = new URL(`${base}manifest.json`, "https://example.test");
  const start = new URL(manifest.start_url, manifestUrl);
  const scope = new URL(manifest.scope, manifestUrl);
  expect(new URL(manifest.id, start).href).toBe(new URL(".", manifestUrl).href);
  expect(scope.pathname).toBe(base);
  expect(start.origin).toBe(scope.origin);
  expect(start.pathname.startsWith(scope.pathname)).toBe(true);
  expect(manifest.display).toBe("standalone");
  expect(manifest.name).toBeTruthy();
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl);
    expect(url.origin).toBe(scope.origin);
    expect(url.pathname.startsWith(scope.pathname)).toBe(true);
  }
});

test("provides real 192/512px installation icons and a separate maskable icon matching manifest metadata", () => {
  const standardSizes = new Set();
  const maskable = [];
  for (const icon of manifest.icons) {
    expect(icon.type).toBe("image/png");
    expect(pngSize(readFileSync(new URL(icon.src, publicRoot)))).toBe(icon.sizes);
    if (icon.purpose === "any") standardSizes.add(icon.sizes);
    if (icon.purpose === "maskable") maskable.push(icon);
  }
  expect(standardSizes).toEqual(new Set(["192x192", "512x512"]));
  expect(maskable).toHaveLength(1);
  expect(maskable[0].sizes).toBe("512x512");
});

test("links the manifest, browser icons, and correctly sized Apple icon under Vite's deployment base", () => {
  expect(document.querySelector('link[rel="manifest"]').getAttribute("href")).toBe("%BASE_URL%manifest.json");
  expect(document.querySelector('meta[name="theme-color"]').content).toBe(manifest.theme_color);
  expect(document.title).toBe(manifest.name);
  const links = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
  for (const link of links) {
    const href = link.getAttribute("href");
    expect(href.startsWith("%BASE_URL%")).toBe(true);
    const bytes = readFileSync(new URL(href.replace("%BASE_URL%", ""), publicRoot));
    expect(bytes.length).toBeGreaterThan(0);
    if (link.rel === "apple-touch-icon") expect(pngSize(bytes)).toBe(link.getAttribute("sizes"));
    if (link.type === "image/svg+xml") expect(bytes.toString()).toContain('viewBox="0 0 64 64"');
  }
  expect(links.some((link) => link.rel === "apple-touch-icon")).toBe(true);
  expect(links.some((link) => link.type === "image/svg+xml")).toBe(true);
});

test("ships usable ICO frames for each advertised favicon size", () => {
  const bytes = readFileSync(new URL("favicon.ico", publicRoot));
  expect(bytes.readUInt16LE(0)).toBe(0);
  expect(bytes.readUInt16LE(2)).toBe(1);
  const frames = [];
  for (let index = 0; index < bytes.readUInt16LE(4); index += 1) {
    const entry = 6 + index * 16;
    const size = `${bytes[entry] || 256}x${bytes[entry + 1] || 256}`;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    expect(offset + length).toBeLessThanOrEqual(bytes.length);
    expect(pngSize(bytes.subarray(offset, offset + length))).toBe(size);
    frames.push(size);
  }
  const icoLink = [...document.querySelectorAll('link[rel="icon"]')].find((link) => link.getAttribute("href").endsWith(".ico"));
  expect(new Set(frames)).toEqual(new Set(icoLink.getAttribute("sizes").split(" ")));
});
