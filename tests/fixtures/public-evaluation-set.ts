import type { BinaryGlyph } from "../../src/recognition/features";

export interface PublicEvaluationGlyph {
  id: string;
  kana: string;
  binary: BinaryGlyph;
}

export interface PublicEvaluationCase {
  id: string;
  expected: string;
  image: BinaryGlyph;
}

function bitmap(rows: readonly string[]): BinaryGlyph {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width || /[^01]/.test(row)))
    throw new Error("公開評価用ビットマップの形式が不正です。");
  return {
    width,
    height: rows.length,
    pixels: Uint8Array.from(rows.flatMap((row) => [...row].map(Number))),
  };
}

export const PUBLIC_EVALUATION_GLYPHS: readonly PublicEvaluationGlyph[] = [
  {
    id: "original-l",
    kana: "あ",
    binary: bitmap(["10000", "10000", "10000", "10000", "10000", "10000", "11111"]),
  },
  {
    id: "original-t",
    kana: "い",
    binary: bitmap(["11111", "00100", "00100", "00100", "00100", "00100", "00100"]),
  },
  {
    id: "original-u",
    kana: "う",
    binary: bitmap(["10001", "10001", "10001", "10001", "10001", "10001", "11111"]),
  },
];

function composeLine(kana: string): BinaryGlyph {
  const glyphs = [...kana].map((character) => {
    const glyph = PUBLIC_EVALUATION_GLYPHS.find((candidate) => candidate.kana === character);
    if (!glyph) throw new Error(`公開評価用字形 ${character} がありません。`);
    return glyph.binary;
  });
  const gap = 4;
  const padding = 2;
  const width =
    glyphs.reduce((sum, glyph) => sum + glyph.width, 0) +
    Math.max(0, glyphs.length - 1) * gap +
    padding * 2;
  const height = Math.max(...glyphs.map(({ height }) => height)) + padding * 2;
  const pixels = new Uint8Array(width * height);
  let cursorX = padding;
  for (const glyph of glyphs) {
    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1)
        pixels[(padding + y) * width + cursorX + x] = glyph.pixels[y * glyph.width + x];
    }
    cursorX += glyph.width + gap;
  }
  return { width, height, pixels };
}

function composeLines(lines: readonly string[]): BinaryGlyph {
  const rendered = lines.map(composeLine);
  const gap = 5;
  const width = Math.max(...rendered.map((line) => line.width));
  const height =
    rendered.reduce((sum, line) => sum + line.height, 0) + Math.max(0, lines.length - 1) * gap;
  const pixels = new Uint8Array(width * height);
  let cursorY = 0;
  for (const line of rendered) {
    for (let y = 0; y < line.height; y += 1) {
      for (let x = 0; x < line.width; x += 1)
        pixels[(cursorY + y) * width + x] = line.pixels[y * line.width + x];
    }
    cursorY += line.height + gap;
  }
  return { width, height, pixels };
}

export const PUBLIC_EVALUATION_CASES: readonly PublicEvaluationCase[] = [
  { id: "basic-order", expected: "あいう", image: composeLine("あいう") },
  { id: "reverse-order", expected: "ういあ", image: composeLine("ういあ") },
  { id: "repeated-glyph", expected: "ああう", image: composeLine("ああう") },
  { id: "two-lines", expected: "あい\nうあ", image: composeLines(["あい", "うあ"]) },
];
