// Expected strings copied from Dizione's Apache-2.0 Python test fixtures.
// https://github.com/n4ze3m/dizione/blob/main/tests/test_dizione.py
// Pinned Git blob: b8ab5d02973d6c784e6c58f708be459b9d2fe549
export const exactFixtures = [
  ["Hello Samir", "h ə l ˈoʊ <sp> s ə m ˈɪɹ"],
  ["Hello", "h ə l ˈoʊ"],
  ["Hello Samir, it costs $3.50.", "h ə l ˈoʊ <sp> s ə m ˈɪɹ , ɪ t <sp> k ˈɔ s t s <sp> θ ɹ ˈiː <sp> d ˈɑː l ɚ z <sp> æ n d <sp> f ˈɪ f t i <sp> s ˈɛ n t s ."],
  ["Samir will read the book", "s ə m ˈɪɹ <sp> w ɪ l <sp> ɹ ˈiː d <sp> ð ə <sp> b ˈʊ k"],
  ["k", "oʊ k ˈeɪ"],
  ["k, thanks", "oʊ k ˈeɪ , θ ˈæ ŋ k s"],
  ["k is not OK", "k ˈeɪ <sp> ɪ z <sp> n ˌɑː t <sp> oʊ k ˈeɪ"],
  ["Sh! Ss! Tsk!", "ʃ ! s ! t ˈɪ s k !"],
  ["Sss. Zzzz. Mmmm. Pssst.", "s . z . m . p s t ."],
  ["coronavirus", "k ɚ ɹ ˈoʊ n ə v ˌaɪ ɹ ə s"],
];
// Marks no training plan contains: the plan must equal the plan of the same words without them.
// [text with untrained marks, the same text with only , . ? ! ; :]
export const markFixtures = [
  ['"Stop," she said, "right now."', "Stop, she said, right now."],
  ["He said: \u201cCome in!\u201d", "He said: Come in!"],
  ["'Stop,' she said.", "Stop, she said."],
  ["Mister Smith's 'big' idea.", "Mister Smith's big idea."],
  ["The dogs' bowls are empty.", "The dogs bowls are empty."],
  ["The plan (the old one) failed.", "The plan the old one failed."],
  ["A [bracketed] note {here}.", "A bracketed note here."],
  ["The answer \u2014 if there is one \u2014 is no.", "The answer if there is one is no."],
  ["The answer \u2013 if there is one \u2013 is no.", "The answer if there is one is no."],
  ["The answer - if there is one - is no.", "The answer if there is one is no."],
  ["Yes, sir--about that.", "Yes, sir about that."],
  ["Wait\u2026 what?", "Wait. what?"],
  ["Wait... Really?! Yes.", "Wait. Really?! Yes."],
  ["And then...", "And then."],
  ["Really\u2026?", "Really?"],
  ["No!... Fine.", "No! Fine."],
  ["\u2026and then he left.", "and then he left."],
  ['"Wait (just a moment) -- it\u2019s the dogs\u2019 turn\u2026" he said \u2014 \u2018fine\u2019.', "Wait just a moment it's the dogs turn. he said fine."],
];
// Exact plans: the linking r of training survives a dropped dash; apostrophes inside words and
// Dizione's reduced forms stay words; accented letters keep the browser reading (never cut).
export const markExactFixtures = [
  ["Yes, sir--about that.", "j ˈɛ s , s ˌɜː ɹ <sp> ɐ b ˌaʊ t <sp> ð ˈæ t ."],
  ["Tell 'em it's nine o'clock.", "t ˈɛ l <sp> ə m <sp> ɪ t s <sp> n ˈaɪ n <sp> ə k l ˈɑː k ."],
  ["Rock 'n' roll is fun.", "ɹ ˈɑː k <sp> ə n <sp> ɹ ˈoʊ l <sp> ɪ z <sp> f ˈʌ n ."],
  ["The café was closed.", "ð ə <sp> k ə f ˈeɪ <sp> w ʌ z <sp> k l ˈoʊ z d ."],
  ["She is naïve.", "ʃ iː <sp> ɪ z <sp> n aɪ ˈiː v ."],
  ['"Café?" (naïve)', "k ə f ˈeɪ ? n aɪ ˈiː v"],
];
const UNTRAINED = ['"', "'", "(", ")", "—", "…"];
export const oovFixtures = ["flurbish", "zentrix", "gwynplaine", "barkilphedro"];
export const marked = (out) => out.symbols.slice(1, -1).map((symbol, i) =>
  ({ 1: "ˈ", 2: "ˌ" }[out.stress[i + 1]] || "") + symbol).join(" ");

/** Shared checks exercise the real two-WASM production path, in Bun and Chromium. */
export function checkEnglish(engine) {
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  for (const [text, expected] of exactFixtures) {
    const output = engine.phonemize(text);
    assert(marked(output) === expected, `${text}: ${marked(output)} != ${expected}`);
    assert(output.vocabulary === "phony-shared-v1", "shared vocabulary");
    assert(output.ids.length === output.stress.length && output.ids.length === output.symbols.length, "parallel arrays");
    assert(output.ids.every((id) => Number.isInteger(id) && id >= 0 && id < 88), "88-symbol IDs");
  }
  const present = engine.phonemize("Samir will read the book");
  assert(present.details.some((d) => d.text === "read" && d.source === "homograph"), "read homograph model");
  const joined = marked(engine.phonemize("Well-read people read a lot."));
  assert(joined.includes("w ˈɛ l ɹ ˈɛ d"), "hyphen selects read past");
  assert(joined.includes("p ˈiː p əl <sp> ɹ ˈiː d"), "context selects read present");
  const phrase = engine.phonemize("Most of the time");
  assert(marked(phrase).includes("ʌ v ð ə"), "phrase joining survives");
  assert(phrase.details.some((d) => d.source === "phrase"), "phrase provenance");
  const noun = engine.phonemize("The record is on the table.").details.find((d) => d.text === "record");
  const verb = engine.phonemize("Please record the message.").details.find((d) => d.text === "record");
  assert(noun.source === "homograph" && verb.source === "homograph", "record homograph provenance");
  assert(JSON.stringify(noun.phones) !== JSON.stringify(verb.phones), "record noun/verb differ");
  for (const word of oovFixtures) {
    const output = engine.phonemize(word);
    assert(output.details[0].source === "model", `${word}: Rust neural OOV path`);
    assert(output.stress.filter((stress) => stress === 1).length === 1, `${word}: primary stress`);
    assert(output.details[0].phones.length < word.length + 3, `${word}: not letter spelling`);
  }
  for (const [text, plain] of markFixtures) {
    const output = engine.phonemize(text), expected = engine.phonemize(plain);
    assert(!output.symbols.some((symbol) => UNTRAINED.includes(symbol)), `${text}: untrained mark in ${marked(output)}`);
    assert(output.ids.every((id) => id < 11 || id > 16), `${text}: untrained symbol id`);
    assert(marked(output) === marked(expected), `${text}: ${marked(output)} != ${marked(expected)}`);
    assert(JSON.stringify(output.ids) === JSON.stringify(expected.ids), `${text}: ids differ from the plain text`);
  }
  for (const [text, expected] of markExactFixtures) {
    const output = engine.phonemize(text);
    assert(marked(output) === expected, `${text}: ${marked(output)} != ${expected}`);
    assert(!output.symbols.some((symbol) => UNTRAINED.includes(symbol)), `${text}: untrained mark`);
  }
  assert(JSON.stringify(engine.phonemize("You did.").ids) === JSON.stringify(engine.phonemize(" You  did. ").ids), "whitespace parity");
  assert(JSON.stringify(engine.phonemize("You did.").ids) !== JSON.stringify(engine.phonemize("You did?").ids), "punctuation preserved");
  for (const text of ["", ":)", "a".repeat(2001), "hello ".repeat(110)]) {
    let failed = false;
    try { engine.phonemize(text); } catch { failed = true; }
    assert(failed, "empty/unpronounceable/oversized input rejected");
  }
  assert(marked(engine.phonemize("Hello")) === "h ə l ˈoʊ", "frontend recovers after bounded errors");
  return { checks, exactFixtures: exactFixtures.length, oovFixtures: oovFixtures.length,
    markFixtures: markFixtures.length, markExactFixtures: markExactFixtures.length };
}
