import { afterEach, describe, expect, it, vi } from "vitest";
import type { BinaryGlyphVariant } from "../src/image/load";
import { recognizeInWorker } from "../src/recognition/recognition-worker-client";

class FakeWorker extends EventTarget {
  static current: FakeWorker | null = null;
  terminated = false;
  shouldThrow = false;

  constructor() {
    super();
    FakeWorker.current = this;
  }

  postMessage(): void {
    if (this.shouldThrow) throw new Error("clone failed");
  }

  terminate(): void {
    this.terminated = true;
  }
}

const variants: BinaryGlyphVariant[] = [
  {
    mode: "background",
    label: "背景色との差",
    binary: { width: 1, height: 1, pixels: new Uint8Array([1]) },
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.current = null;
});

describe("recognizeInWorker", () => {
  it("成功応答後にWorkerを終了する", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const resultPromise = recognizeInWorker(variants, [], "auto");
    FakeWorker.current?.dispatchEvent(
      new MessageEvent("message", {
        data: { ok: true, result: { attempts: [], selected: null } },
      }),
    );

    await expect(resultPromise).resolves.toEqual({ attempts: [], selected: null });
    expect(FakeWorker.current?.terminated).toBe(true);
  });

  it("画像変更による中止時にWorkerを終了してAbortErrorを返す", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const controller = new AbortController();
    const resultPromise = recognizeInWorker(variants, [], "auto", controller.signal);
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.current?.terminated).toBe(true);
  });
});
