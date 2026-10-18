import { describe, expect, it } from "vitest";
import { ReadingSession } from "../src/domain/reading-session";

function reading() {
  const session = new ReadingSession<{ file: string; crop: string }>();
  session.complete(session.begin(), { file: "first.png", crop: "whole" }, "あい\nうえ");
  return session;
}

describe("reading work survives asynchronous recognition", () => {
  it("retains additions, deletions and line edits through cancellation and a late response", () => {
    const session = reading();
    session.editText("あ\n追加した文章");
    const ticket = session.begin();
    session.cancel();
    expect(session.complete(ticket, { file: "second.png", crop: "whole" }, "かき")).toBe(false);
    expect(session.current?.text).toBe("あ\n追加した文章");
    expect(session.current?.automaticText).toBe("あい\nうえ");
    expect(session.current?.source.file).toBe("first.png");
  });

  it("does not replace human edits when a new reading succeeds, and restores the complete source on undo", () => {
    const session = reading();
    session.editText("手で直した文章");
    session.current!.reviewed = true;
    session.setExpectedDraft("確定正解");
    session.confirmExpected();
    session.complete(session.begin(), { file: "second.png", crop: "top" }, "かき");
    expect(session.current?.text).toBe("手で直した文章");
    expect(session.pending?.source.file).toBe("second.png");
    session.acceptPending();
    session.restorePrevious();
    expect(session.current).toMatchObject({
      text: "手で直した文章",
      reviewed: true,
      confirmedExpected: "確定正解",
      source: { file: "first.png", crop: "whole" },
    });
  });

  it("keeps candidate corrections separate from an independently edited final text", () => {
    const session = reading();
    session.updateCandidates("あいう", true);
    expect(session.current?.text).toBe("あいう");
    session.editText("あいう。\n追加");
    session.updateCandidates("かいう", true);
    expect(session.current?.text).toBe("あいう。\n追加");
    expect(session.current?.candidateText).toBe("かいう");
    expect(session.current?.automaticText).toBe("あい\nうえ");
  });

  it("never treats automatic or copied draft text as confirmed truth", () => {
    const session = reading();
    expect(session.current?.confirmedExpected).toBeNull();
    session.setExpectedDraft(session.current!.text);
    expect(session.current?.confirmedExpected).toBeNull();
    session.confirmExpected();
    expect(session.current?.confirmedExpected).toBe("あい\nうえ");
    session.setExpectedDraft("書きかけ");
    expect(session.current?.confirmedExpected).toBeNull();
  });

  it("rejects an older request after a newer request starts without clearing the successful result", () => {
    const session = reading();
    const old = session.begin();
    const latest = session.begin();
    expect(session.complete(old, { file: "old.png", crop: "whole" }, "古い応答")).toBe(false);
    expect(session.current?.text).toBe("あい\nうえ");
    session.complete(latest, { file: "latest.png", crop: "whole" }, "新結果");
    expect(session.current?.source.file).toBe("latest.png");
  });
});
