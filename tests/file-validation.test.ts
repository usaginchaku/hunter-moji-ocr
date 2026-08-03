import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  validateImageDimensions,
  validateImageFile,
} from "../src/app/file-validation";

describe("validateImageFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("%sを受け付ける", (type) => {
    expect(validateImageFile({ type, size: 1024 })).toEqual({ ok: true });
  });

  it("未対応形式を拒否する", () => {
    expect(validateImageFile({ type: "image/gif", size: 1024 })).toEqual({
      ok: false,
      message: "PNG、JPEG、WebPの画像を選択してください。",
    });
  });

  it("空ファイルを拒否する", () => {
    expect(validateImageFile({ type: "image/png", size: 0 })).toEqual({
      ok: false,
      message: "空の画像ファイルは読み込めません。",
    });
  });

  it("上限を超える画像を拒否する", () => {
    expect(validateImageFile({ type: "image/png", size: 101 }, 100)).toEqual({
      ok: false,
      message: "画像サイズが上限の100 Bを超えています。",
    });
  });
});

describe("formatFileSize", () => {
  it("読みやすい単位へ変換する", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("validateImageDimensions", () => {
  it("通常の画像寸法を受け付ける", () => {
    expect(validateImageDimensions(4096, 2160)).toEqual({ ok: true });
  });

  it("圧縮ファイルが小さくても過大な総画素数を拒否する", () => {
    expect(validateImageDimensions(20_000, 20_000)).toMatchObject({ ok: false });
  });

  it("0や小数の寸法を拒否する", () => {
    expect(validateImageDimensions(0, 100)).toMatchObject({ ok: false });
    expect(validateImageDimensions(100.5, 100)).toMatchObject({ ok: false });
  });
});
