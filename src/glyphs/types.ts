export type WritingDirection = "horizontal" | "vertical";
export type GlyphStatus = "draft" | "ready" | "later";

export interface GlyphTemplateDefinition {
  id: string;
  kana: string;
  direction: WritingDirection;
  templatePath: string;
  width: 64;
  height: 64;
  status: GlyphStatus;
  supportsDakuten: boolean;
  supportsHandakuten: boolean;
  supportsSmallForm: boolean;
}
