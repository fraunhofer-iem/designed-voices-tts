import { test, expect } from "bun:test";
import { markHyphenUnits, boundaryGroups } from "../web/english-hyphens.mjs";
import { groups, Unit } from "../web/vendor/dizione/sentence.js";
import { tokenize } from "../web/vendor/dizione/symbols.js";

// Token and unit shapes of Dizione: a word after a hyphen is attached; the local change in
// normalize.js also sets `hyphen`. Parts of a split word (camelCase, letter names) are attached too.
const word = (text, rest = {}) => ({ text, attach: false, raw: text, spell: false, phones: null, ...rest });
const hyphenated = (text) => word(text, { attach: true, hyphen: true });
const unit = (token, phones) => new Unit(token.text, phones.split(" ").map((p) => [p, 0]), "c", null, token.attach, "dictionary");
const symbols = (list) => tokenize([[false, list]]).symbols.join(" ");

test("the part after a hyphen starts a new word; the default grouping joins it", () => {
  const words = [word("twenty"), hyphenated("nine"), word("turkeys")];
  const units = [unit(words[0], "t w ɛ n t i"), unit(words[1], "n aɪ n"), unit(words[2], "t ɜː k i z")];
  expect(symbols(groups(units))).toBe("<bos> t w ɛ n t i n aɪ n <sp> t ɜː k i z <eos>");
  expect(markHyphenUnits(units, words)).toBe(true);
  expect(symbols(boundaryGroups(units))).toBe("<bos> t w ɛ n t i <sp> n aɪ n <sp> t ɜː k i z <eos>");
  // The default grouping ignores the mark: plans of the other families do not change.
  expect(symbols(groups(units))).toBe("<bos> t w ɛ n t i n aɪ n <sp> t ɜː k i z <eos>");
});

test("thirty-one and a hyphenated word that is not a number", () => {
  for (const [first, second, a, b] of [["thirty", "one", "θ ɜː ɾ i", "w ʌ n"], ["well", "known", "w ɛ l", "n oʊ n"]]) {
    const words = [word(first), hyphenated(second)], units = [unit(words[0], a), unit(words[1], b)];
    markHyphenUnits(units, words);
    expect(symbols(boundaryGroups(units))).toBe(`<bos> ${a} <sp> ${b} <eos>`);
  }
});

test("three parts give two boundaries; phones, stress and order are unchanged", () => {
  const words = [word("mother"), hyphenated("in"), hyphenated("law")];
  const units = [unit(words[0], "m ʌ ð ɚ"), unit(words[1], "ɪ n"), unit(words[2], "l ɔː")];
  units[0].phones[1][1] = 1;
  markHyphenUnits(units, words);
  const joined = tokenize([[false, groups(units)]]), split = tokenize([[false, boundaryGroups(units)]]);
  expect(split.symbols.join(" ")).toBe("<bos> m ʌ ð ɚ <sp> ɪ n <sp> l ɔː <eos>");
  const drop = (plan) => plan.symbols.map((s, i) => [s, plan.stress[i]]).filter(([s]) => s !== "<sp>");
  expect(drop(split)).toEqual(drop(joined));
});

test("attachment without a hyphen stays one word (letter names, split camelCase)", () => {
  const words = [word("f", { spell: true }), word("a", { spell: true, attach: true }), word("q", { spell: true, attach: true })];
  const units = [unit(words[0], "ɛ f"), unit(words[1], "eɪ"), unit(words[2], "k j uː")];
  expect(markHyphenUnits(units, words)).toBe(true);
  expect(units.some((u) => u.hyphen)).toBe(false);
  expect(symbols(boundaryGroups(units))).toBe(symbols(groups(units)));
});

test("a phrase unit covers several words; the mark belongs to its first word", () => {
  const words = [word("check"), hyphenated("on"), word("the"), word("list")];
  const units = [unit(words[0], "tʃ ɛ k"), new Unit("on the", [["ɑː", 0], ["n", 0], ["ð", 0], ["ə", 0]], "u", null, true, "phrase"), unit(words[3], "l ɪ s t")];
  expect(markHyphenUnits(units, words)).toBe(true);
  expect(units.map((u) => Boolean(u.hyphen))).toEqual([false, true, false]);
  expect(symbols(boundaryGroups(units))).toBe("<bos> tʃ ɛ k <sp> ɑː n ð ə <sp> l ɪ s t <eos>");
});

test("units that do not line up with the words leave the default plan", () => {
  const words = [word("twenty"), hyphenated("nine")];
  for (const units of [
    [unit(words[0], "t w ɛ n t i")],
    [unit(words[0], "t w ɛ n t i"), unit(word("eight"), "eɪ t")],
    [unit(words[0], "t w ɛ n t i"), unit(words[1], "n aɪ n"), unit(word("x"), "ɛ k s")],
  ]) {
    expect(markHyphenUnits(units, words)).toBe(false);
    expect(units.some((u) => u.hyphen)).toBe(false);
  }
});

test("a hyphen mark without attachment is ignored", () => {
  const words = [word("a"), word("b", { hyphen: true })], units = [unit(words[0], "eɪ"), unit(words[1], "b iː")];
  markHyphenUnits(units, words);
  expect(units.some((u) => u.hyphen)).toBe(false);
});
