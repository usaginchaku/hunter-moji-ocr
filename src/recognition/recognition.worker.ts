/// <reference lib="webworker" />

import type { LoadedGlyphTemplate } from "../glyphs/load-templates";
import type { BinaryGlyphVariant } from "../image/load";
import {
  runRecognitionPipeline,
  type RecognitionPipelineMode,
  type RecognitionPipelineResult,
} from "./recognition-pipeline";

export interface RecognitionWorkerRequest {
  variants: BinaryGlyphVariant[];
  templates: LoadedGlyphTemplate[];
  mode: RecognitionPipelineMode;
}

export type RecognitionWorkerResponse =
  { ok: true; result: RecognitionPipelineResult } | { ok: false; message: string };

self.addEventListener("message", (event: MessageEvent<RecognitionWorkerRequest>) => {
  try {
    const result = runRecognitionPipeline(
      event.data.variants,
      event.data.templates,
      event.data.mode,
    );
    const response: RecognitionWorkerResponse = { ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: RecognitionWorkerResponse = {
      ok: false,
      message: error instanceof Error ? error.message : "文字認識処理に失敗しました。",
    };
    self.postMessage(response);
  }
});
