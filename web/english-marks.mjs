// English punctuation convention of the training frontend, applied to Dizione's token stream.
// Both acoustic models saw English plans that contain only the marks , . ? ! ; : -- the training
// frontend dropped every other mark and read the words on both sides as one phrase. Dizione's
// normalizer also emits " ' ( ) — and …; those have symbol ids no training plan ever contained.
// Pure functions: evaluated inside QuickJS with the rules, unit-tested without assets.

export const TRAINED_MARKS = [",", ".", "?", "!", ";", ":"];
export const UNTRAINED_MARKS = ['"', "'", "(", ")", "—", "…"];
const TRAINED = new Set(TRAINED_MARKS);
const isMark = (token) => "mark" in token;

/**
 * Keep words and trained marks; drop every other mark without leaving a gap, so the words around
 * a dropped mark stay in one clause (shared sentence stress, linking, homograph context).
 * An ellipsis is a sentence end for segmentation: between words it becomes a period, the one
 * trained mark with that role; next to another kept mark, or with no word before it, it is dropped.
 */
export function trainedStream(tokens) {
  const kept = tokens.filter((token) => !isMark(token) || TRAINED.has(token.mark) || token.mark === "…");
  const out = [];
  kept.forEach((token, index) => {
    if (!isMark(token) || token.mark !== "…") { out.push(token); return; }
    const before = out.at(-1), after = kept[index + 1];
    if (!before || isMark(before) || (after && isMark(after))) return;
    out.push({ ...token, mark: "." });
  });
  return out;
}

/** Symbols of a plan that no English training plan contained. Empty for every plan this path returns. */
export function untrainedSymbols(symbols) {
  return symbols.filter((symbol) => UNTRAINED_MARKS.includes(symbol));
}
