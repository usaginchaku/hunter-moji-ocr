import { composeKana, type KanaModifier } from "../domain/kana-composition";
import { composeSmallKana } from "../domain/small-kana";
import { horizontalGlyphs } from "../glyphs/glyph-map";
import type { GlyphTemplateDefinition } from "../glyphs/types";

export type GeneratorToken =
  | {
      kind: "glyph";
      source: string;
      glyph: GlyphTemplateDefinition;
      modifier: KanaModifier | null;
      small: boolean;
    }
  | { kind: "space"; source: string }
  | { kind: "unsupported"; source: string };

export interface GeneratorTextPlan {
  lines: GeneratorToken[][];
  unsupported: string[];
  sourceCharacterCount: number;
}

export const MAX_GENERATOR_SOURCE_CHARACTERS = 200;

export function limitGeneratorSourceText(input: string): string {
  return [...input].slice(0, MAX_GENERATOR_SOURCE_CHARACTERS).join("");
}

interface GlyphVariant {
  glyph: GlyphTemplateDefinition;
  modifier: KanaModifier | null;
  small: boolean;
}

const variants = new Map<string, GlyphVariant>();

for (const glyph of horizontalGlyphs) {
  variants.set(glyph.kana, { glyph, modifier: null, small: false });

  for (const modifier of ["dakuten", "handakuten"] as const) {
    const composed = composeKana(glyph.kana, modifier);
    if (composed.ok) variants.set(composed.kana, { glyph, modifier, small: false });
  }

  const small = composeSmallKana(glyph.kana);
  if (small.ok) variants.set(small.kana, { glyph, modifier: null, small: true });
}

function tokenizeCharacter(source: string): GeneratorToken {
  if (source === " " || source === "　" || source === "\t") return { kind: "space", source };

  const variant = variants.get(source);
  if (!variant) return { kind: "unsupported", source };
  return { kind: "glyph", source, ...variant };
}

export function createGeneratorTextPlan(input: string, maxColumns: number): GeneratorTextPlan {
  if (!Number.isInteger(maxColumns) || maxColumns <= 0) {
    throw new Error("1行の文字数は1以上の整数で指定してください。");
  }

  const normalized = limitGeneratorSourceText(
    input.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
  );
  const explicitLines = normalized.split("\n");
  const lines: GeneratorToken[][] = [];
  const unsupported = new Set<string>();
  let sourceCharacterCount = 0;

  for (const explicitLine of explicitLines) {
    const tokens = [...explicitLine].map((source) => {
      sourceCharacterCount += 1;
      const token = tokenizeCharacter(source);
      if (token.kind === "unsupported") unsupported.add(source);
      return token;
    });

    if (tokens.length === 0) {
      lines.push([]);
      continue;
    }
    for (let start = 0; start < tokens.length; start += maxColumns) {
      lines.push(tokens.slice(start, start + maxColumns));
    }
  }

  return { lines, unsupported: [...unsupported], sourceCharacterCount };
}
