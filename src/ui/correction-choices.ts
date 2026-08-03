import type { GlyphTemplateDefinition } from "../glyphs/types";
import type { GlyphCandidate } from "../recognition/similarity";

export interface CorrectionChoice {
  templateId: string;
  kana: string;
  score: number | null;
  isTopCandidate: boolean;
}

export interface CorrectionChoiceGroups {
  topCandidates: CorrectionChoice[];
  otherGlyphs: CorrectionChoice[];
}

export function buildCorrectionChoices(
  candidates: readonly GlyphCandidate[],
  glyphs: readonly GlyphTemplateDefinition[],
): CorrectionChoiceGroups {
  const topIds = new Set(candidates.map((candidate) => candidate.templateId));
  return {
    topCandidates: candidates.map((candidate) => ({
      templateId: candidate.templateId,
      kana: candidate.kana,
      score: candidate.score,
      isTopCandidate: true,
    })),
    otherGlyphs: glyphs
      .filter((glyph) => !topIds.has(glyph.id))
      .map((glyph) => ({
        templateId: glyph.id,
        kana: glyph.kana,
        score: null,
        isTopCandidate: false,
      })),
  };
}
