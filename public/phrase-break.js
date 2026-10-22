// Break Japanese text only between phrases, so lines never split a word
// such as "忘|れ物" or "アバッ|キオ". Safari has no `word-break: auto-phrase`,
// so phrases are found with Intl.Segmenter and joined with <wbr>. The page
// stylesheet sets [data-phrased]{word-break:keep-all;overflow-wrap:anywhere}
// so that lines break only at those points.
(() => {
  "use strict";
  if (typeof Intl === "undefined" || !Intl.Segmenter) return;

  // Pages can add selectors with <script src="phrase-break.js" data-targets="...">.
  const extra = document.currentScript?.dataset.targets;
  const TARGETS =
    "h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,summary,label,button,figcaption,blockquote" +
    (extra ? "," + extra : "");
  const SKIP =
    "script,style,textarea,select,option,input,code,pre,svg,[contenteditable],.no-phrase";
  const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
  // Segments that must stay attached to the previous one: hiragana (particles,
  // okurigana, auxiliary verbs), prolonged sound marks and closing punctuation.
  // Katakana words, numbers with counters and one-kanji suffixes are also kept
  // whole because the segmenter splits them.
  const ATTACH = /^[\u3041-\u309f\u30fc\u30fb、。，．,.!！?？)）」』】〕〉》…‥〜\u30fc々]/;
  const KATAKANA_START = /^[\u30a1-\u30fa\u30fc]/;
  const KATAKANA_END = /[\u30a1-\u30fa\u30fc]$/;
  const OPENING = /[(（「『【〔〈《]$/;
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

  function phrases(text) {
    const out = [];
    for (const { segment } of segmenter.segment(text)) {
      const last = out.length - 1;
      const prev = out[last];
      const latinRun =
        prev !== undefined &&
        !JAPANESE.test(segment) &&
        !JAPANESE.test(prev) &&
        !/^\s/.test(segment) &&
        !/\s$/.test(prev);
      const katakanaRun =
        prev !== undefined && KATAKANA_END.test(prev) && KATAKANA_START.test(segment);
      const counter =
        prev !== undefined && /[0-9０-９]$/.test(prev) && /^[\u3400-\u9fff]/.test(segment);
      const kanjiSuffix =
        prev !== undefined &&
        /[\u30a1-\u30fa\u30fc\u3400-\u9fff]$/.test(prev) &&
        /^[\u3400-\u9fff]$/.test(segment);
      if (
        prev !== undefined &&
        (ATTACH.test(segment) ||
          OPENING.test(prev) ||
          latinRun ||
          katakanaRun ||
          counter ||
          kanjiSuffix)
      ) {
        out[last] = prev + segment;
      } else {
        out.push(segment);
      }
    }
    return out;
  }

  function wrapElement(el) {
    if (el.closest(SKIP)) return;
    const text = el.textContent;
    if (el.dataset.phrased === text || !JAPANESE.test(text)) return;
    for (const node of [...el.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !JAPANESE.test(node.data)) continue;
      const parts = phrases(node.data);
      if (parts.length < 2) continue;
      const fragment = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (index) fragment.append(document.createElement("wbr"));
        fragment.append(part);
      });
      node.replaceWith(fragment);
    }
    el.dataset.phrased = el.textContent;
  }

  function apply(root) {
    if (!(root instanceof Element)) root = root.parentElement;
    if (!root) return;
    const own = root.closest(TARGETS);
    if (own) wrapElement(own);
    for (const el of root.querySelectorAll(TARGETS)) wrapElement(el);
  }

  let pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const roots = pending;
    pending = new Set();
    for (const root of roots) if (root.isConnected) apply(root);
  };
  const queue = (node) => {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };

  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") queue(record.target);
      else
        for (const node of record.addedNodes) {
          if (node.localName === "wbr") continue;
          queue(node.nodeType === Node.ELEMENT_NODE ? node : record.target);
        }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const start = () => apply(document.body);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
