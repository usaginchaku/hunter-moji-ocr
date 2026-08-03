export type OpenCvLoadState = "idle" | "loading" | "ready" | "error";

type OpenCvApi = {
  Mat?: unknown;
  getBuildInformation?: () => string;
};

declare global {
  interface Window {
    cv?: OpenCvApi | Promise<OpenCvApi>;
    Module?: {
      onRuntimeInitialized?: () => void;
    };
  }
}

const SCRIPT_ID = "opencv-js";
export const OPENCV_SCRIPT_URL = `${import.meta.env.BASE_URL}vendor/opencv/opencv.js`;

function isReady(api: OpenCvApi | undefined): api is OpenCvApi {
  return typeof api?.Mat !== "undefined";
}

async function resolveCv(): Promise<OpenCvApi | undefined> {
  return Promise.resolve(window.cv);
}

export async function loadOpenCv(
  scriptUrl = OPENCV_SCRIPT_URL,
  timeoutMs = 45_000,
): Promise<OpenCvApi> {
  const existing = await resolveCv();
  if (isReady(existing)) return existing;

  const failedScript = document.getElementById(SCRIPT_ID);
  if (failedScript?.dataset.failed === "true") failedScript.remove();

  return new Promise<OpenCvApi>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };

    const resolveWhenReady = async (): Promise<void> => {
      try {
        const api = await resolveCv();
        if (!isReady(api)) throw new Error("OpenCV.js APIが初期化されていません。");
        finish(() => resolve(api));
      } catch (error) {
        finish(() => reject(error));
      }
    };

    const timeoutId = window.setTimeout(() => {
      const script = document.getElementById(SCRIPT_ID);
      if (script) script.dataset.failed = "true";
      finish(() => reject(new Error("OpenCV.jsの読み込みがタイムアウトしました。")));
    }, timeoutMs);

    const previousCallback = window.Module?.onRuntimeInitialized;
    window.Module = {
      ...window.Module,
      onRuntimeInitialized: () => {
        previousCallback?.();
        void resolveWhenReady();
      },
    };

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => void resolveWhenReady(), { once: true });
      existingScript.addEventListener(
        "error",
        () => finish(() => reject(new Error("OpenCV.jsを読み込めませんでした。"))),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = scriptUrl;
    script.addEventListener("load", () => void resolveWhenReady(), { once: true });
    script.addEventListener(
      "error",
      () => {
        script.dataset.failed = "true";
        finish(() => reject(new Error("OpenCV.jsを読み込めませんでした。")));
      },
      { once: true },
    );
    document.head.append(script);
  });
}
