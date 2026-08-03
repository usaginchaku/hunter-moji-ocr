import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { BinaryGlyphVariant } from "../image/load";
import type { RecognitionPipelineMode, RecognitionPipelineResult } from "./recognition-pipeline";
import type { RecognitionWorkerRequest, RecognitionWorkerResponse } from "./recognition.worker";

export function recognizeInWorker(
  variants: BinaryGlyphVariant[],
  templates: LoadedGlyphTemplate[],
  mode: RecognitionPipelineMode,
  signal?: AbortSignal,
): Promise<RecognitionPipelineResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("文字認識を中止しました。", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./recognition.worker.ts", import.meta.url), {
      type: "module",
      name: "hunter-moji-recognition",
    });
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      fail(new Error("文字認識が3分以内に完了しなかったため中止しました。"));
    }, 180_000);
    const dispose = (): void => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };
    const succeed = (result: RecognitionPipelineResult): void => {
      if (settled) return;
      settled = true;
      dispose();
      resolve(result);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      dispose();
      reject(error);
    };
    const handleAbort = (): void => {
      fail(new DOMException("文字認識を中止しました。", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.addEventListener(
      "message",
      (event: MessageEvent<RecognitionWorkerResponse>) => {
        if (event.data.ok) succeed(event.data.result);
        else fail(new Error(event.data.message));
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      () => {
        fail(new Error("文字認識用のバックグラウンド処理を開始できませんでした。"));
      },
      { once: true },
    );
    worker.addEventListener(
      "messageerror",
      () => {
        fail(new Error("文字認識用のバックグラウンド処理結果を読み取れませんでした。"));
      },
      { once: true },
    );
    const request: RecognitionWorkerRequest = { variants, templates, mode };
    const transfer = variants.map((variant) => variant.binary.pixels.buffer);
    try {
      worker.postMessage(request, transfer);
    } catch {
      fail(new Error("文字認識用のデータをバックグラウンド処理へ渡せませんでした。"));
    }
  });
}
