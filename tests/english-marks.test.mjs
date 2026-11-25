import { test, expect } from "bun:test";
import { TRAINED_MARKS, UNTRAINED_MARKS, trainedStream, untrainedSymbols } from "../web/english-marks.mjs";
import { PUNCTUATION } from "../web/vendor/dizione/symbols.js";

// Token shapes of Dizione's normalizer: marks are {mark}, words carry text.
const word = (text) => ({ text, raw: text, phones: null, spell: false, attach: false });
const mark = (value) => ({ mark: value });
const read = (tokens) => trainedStream(tokens).map((token) => ("mark" in token ? token.mark : token.text)).join(" ");

test("the two mark lists are exactly the frontend's punctuation inventory", () => {
  expect([...TRAINED_MARKS, ...UNTRAINED_MARKS]).toEqual(PUNCTUATION);
  expect(TRAINED_MARKS).toEqual([",", ".", "?", "!", ";", ":"]);
});

test("each untrained mark is dropped and leaves the neighbouring words in one clause", () => {
  for (const dropped of ['"', "'", "(", ")", "—"]) {
    expect(read([word("yes"), mark(dropped), word("sir"), mark(".")])).toBe("yes sir .");
    expect(read([mark(dropped), word("yes"), mark(","), mark(dropped), word("sir"), mark("."), mark(dropped)])).toBe("yes , sir .");
  }
});

test("trained marks and words pass through unchanged, in order and by identity", () => {
  const tokens = [word("well"), mark(","), word("no"), mark(";"), word("why"), mark("?"), mark("!"), word("so"), mark(":"), word("go"), mark(".")];
  const out = trainedStream(tokens);
  expect(out).toEqual(tokens);
  out.forEach((token, index) => expect(token).toBe(tokens[index]));
});

test("an ellipsis between words becomes a period, the trained sentence end", () => {
  expect(read([word("wait"), mark("…"), word("what"), mark("?")])).toBe("wait . what ?");
  expect(read([word("and"), word("then"), mark("…")])).toBe("and then .");
});

test("an ellipsis next to a kept mark or without a word before it is dropped", () => {
  expect(read([word("really"), mark("…"), mark("?")])).toBe("really ?");
  expect(read([word("no"), mark("!"), mark("…"), word("okay"), mark(".")])).toBe("no ! okay .");
  expect(read([mark("…"), word("and"), word("then"), mark(".")])).toBe("and then .");
  expect(read([word("so"), mark("…"), mark("…"), word("yes")])).toBe("so . yes");
  expect(read([word("so"), mark("…"), mark('"'), mark("?")])).toBe("so ?");
  expect(read([mark('"'), mark("…"), word("so"), mark('"')])).toBe("so");
});

test("the input is not modified", () => {
  const tokens = [word("wait"), mark("…"), mark('"'), word("what")];
  const copy = JSON.parse(JSON.stringify(tokens));
  trainedStream(tokens);
  expect(tokens).toEqual(copy);
});

test("untrainedSymbols reports exactly the six untrained marks", () => {
  expect(untrainedSymbols(["<bos>", "h", "ə", ",", "<sp>", "l", ".", "<eos>"])).toEqual([]);
  expect(untrainedSymbols(["<bos>", '"', "h", "'", "(", ")", "—", "…", "<eos>"])).toEqual(UNTRAINED_MARKS);
});
