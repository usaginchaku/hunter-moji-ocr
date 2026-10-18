/** A completed reading owns its source, automatic text and human work together. */
export interface ReadingDraft<Source> {
  source: Source;
  readonly automaticText: string;
  candidateText: string;
  text: string;
  textEdited: boolean;
  candidatesEdited: boolean;
  reviewed: boolean;
  expectedDraft: string;
  confirmedExpected: string | null;
}

export class ReadingSession<Source> {
  current: ReadingDraft<Source> | null = null;
  pending: ReadingDraft<Source> | null = null;
  previous: ReadingDraft<Source> | null = null;
  private revision = 0;

  begin(): number {
    return ++this.revision;
  }

  cancel(): void {
    this.revision += 1;
  }

  isCurrentRequest(request: number): boolean {
    return request === this.revision;
  }

  complete(request: number, source: Source, automaticText: string, savedExpected = ""): boolean {
    if (!this.isCurrentRequest(request)) return false;
    const next: ReadingDraft<Source> = {
      source,
      automaticText,
      candidateText: automaticText,
      text: automaticText,
      textEdited: false,
      candidatesEdited: false,
      reviewed: false,
      expectedDraft: savedExpected,
      confirmedExpected: savedExpected.trim() ? savedExpected : null,
    };
    const current = this.current;
    if (
      current &&
      (current.textEdited ||
        current.candidatesEdited ||
        current.reviewed ||
        current.expectedDraft.trim())
    ) {
      this.pending = next;
    } else {
      this.previous = current;
      this.current = next;
      this.pending = null;
    }
    return true;
  }

  acceptPending(): void {
    if (!this.pending) return;
    this.previous = this.current;
    this.current = this.pending;
    this.pending = null;
  }

  restorePrevious(): void {
    if (!this.previous) return;
    [this.current, this.previous] = [this.previous, this.current];
  }

  editText(text: string): void {
    if (!this.current) return;
    this.current.text = text;
    this.current.textEdited = true;
    this.current.reviewed = false;
  }

  updateCandidates(text: string, edited: boolean): void {
    if (!this.current) return;
    this.current.candidateText = text;
    this.current.candidatesEdited = edited;
    if (!this.current.textEdited) this.current.text = text;
    this.current.reviewed = false;
  }

  useCandidateText(): void {
    if (!this.current) return;
    this.current.text = this.current.candidateText;
    this.current.textEdited = false;
    this.current.reviewed = false;
  }

  setExpectedDraft(text: string): void {
    if (!this.current) return;
    this.current.expectedDraft = text;
    this.current.confirmedExpected = null;
  }

  confirmExpected(): void {
    if (!this.current) return;
    this.current.confirmedExpected = this.current.expectedDraft.trim()
      ? this.current.expectedDraft
      : null;
  }
}
