import { waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import reportWebVitals from "./reportWebVitals";

const metrics = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onFCP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}));

vi.mock("web-vitals", () => metrics);

beforeEach(() => {
  vi.clearAllMocks();
});

test("registers the performance callback for all supported metrics, including INP", async () => {
  const callback = vi.fn();

  reportWebVitals(callback);

  await waitFor(() => {
    for (const registerMetric of Object.values(metrics)) {
      expect(registerMetric).toHaveBeenCalledExactlyOnceWith(callback);
    }
  });
});

test("does not register observers without a callback", () => {
  reportWebVitals();
  reportWebVitals("invalid callback");

  for (const registerMetric of Object.values(metrics)) {
    expect(registerMetric).not.toHaveBeenCalled();
  }
});
