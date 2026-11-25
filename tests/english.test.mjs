import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEnglish } from "../web/english.mjs";
import { checkEnglish } from "./english-fixtures.mjs";

// Opt in to real registered assets; tests never install, generate or modify them.
const assets = process.env.ENGLISH_ASSETS_DIR;
const wasmDir = process.env.PHONY_WASM_DIR;
const integration = assets && wasmDir ? test : test.skip;

let phonyModule;
if (assets && wasmDir) {
  phonyModule = await import(pathToFileURL(resolve(wasmDir, "phony_wasm.js")).href);
  await phonyModule.default({ module_or_path: await Bun.file(resolve(wasmDir, "phony_wasm_bg.wasm")).arrayBuffer() });
}
// The English Kale ids need a Phony build with toKaleEnglish; older builds skip that test.
const kaleEnglish = integration === test && typeof phonyModule.toKaleEnglish === "function" ? test : test.skip;
async function createEnglishForTest() {
  return createEnglish({
    phonyModule,
    metadataText: await Bun.file(resolve(assets, "frontend.json")).text(),
    weightsBytes: new Uint8Array(await Bun.file(resolve(assets, "models.safetensors")).arrayBuffer()),
    englishDictionaryBytes: new Uint8Array(await Bun.file(resolve(assets, "english.lex")).arrayBuffer()),
    quickjsWasmBytes: await Bun.file(import.meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm").replace("file://", "")).arrayBuffer(),
  });
}

integration("production QuickJS + Rust WASM matches pinned Python Dizione fixtures", async () => {
  const english = await createEnglishForTest();
  try {
    const result = checkEnglish(english);
    expect(result.checks).toBeGreaterThan(130);
  } finally {
    english.dispose();
  }
  expect(() => english.phonemize("Hello")).toThrow("disposed");
  english.dispose();
}, 30_000);

// Plans of the Python training frontend for every English text of the released supervision
// (symbols and stress as trained). The browser path must feed the models the same plans.
integration("the English path reproduces the training plan of all 404 English training texts", async () => {
  const rows = (await Bun.file(new URL("./fixtures/english-training-plans.jsonl", import.meta.url)).text()).trim().split("\n").map((line) => JSON.parse(line));
  expect(rows.length).toBe(404);
  const english = await createEnglishForTest();
  const different = [];
  try {
    for (const row of rows) {
      const plan = english.phonemize(row.text);
      if (plan.symbols.join(" ") !== row.symbols || plan.stress.join("") !== row.stress) different.push(row.text);
    }
  } finally {
    english.dispose();
  }
  expect(different).toEqual([]);
  // 19 of them carry marks the training frontend dropped: quotation marks or a double hyphen.
  expect(rows.filter((row) => /["]|--|(?<![A-Za-z])'|'(?![A-Za-z])/.test(row.text)).length).toBe(19);
}, 60_000);

// English upstream Kale only: the parts of a hyphenated word are separate words in the plan.
// Without the option nothing changes, which is what Voca and German Kale were trained on.
integration("hyphen boundaries are opt-in and change nothing but the word boundary", async () => {
  const english = await createEnglishForTest();
  const read = (text, options) => { const plan = english.phonemize(text, options); return { symbols: plan.symbols.join(" "), plan }; };
  const pairs = (plan) => plan.symbols.map((symbol, index) => [symbol, plan.stress[index]]);
  try {
    for (const [text, joined, split] of [
      ["Exactly twenty-nine turkeys.", "t w ɛ n t i n aɪ n", "t w ɛ n t i <sp> n aɪ n"],
      ["It is thirty-one.", "θ ɜː ɾ i w ʌ n", "θ ɜː ɾ i <sp> w ʌ n"],
      ["A well-known story.", "w ɛ l n oʊ n", "w ɛ l <sp> n oʊ n"],
    ]) {
      const base = read(text), same = read(text, { hyphenBoundaries: false }), marked = read(text, { hyphenBoundaries: true });
      expect(base.symbols).toContain(joined);
      expect(base.symbols).not.toContain(split);
      expect(same.plan).toEqual(base.plan);
      expect(marked.symbols).toContain(split);
      // One added <sp>; every phone, stress level and mark is the one of the default plan.
      expect(marked.plan.symbols.length).toBe(base.plan.symbols.length + 1);
      let at = 0;
      const rest = pairs(marked.plan).filter(([symbol], index) => !(symbol === "<sp>" && pairs(base.plan)[index - at]?.[0] !== "<sp>" && ++at));
      expect(rest).toEqual(pairs(base.plan));
      expect(marked.plan.ids.length).toBe(marked.plan.symbols.length);
    }
    // No hyphen, a spaced dash, letter names and a double hyphen: identical with and without the option.
    for (const text of ["The meeting starts at nine.", "The answer - if there is one - is no.", "Read the FAQ at the UN.", "Yes, sir--about that.", "Tell 'em it's nine o'clock."]) {
      expect(read(text, { hyphenBoundaries: true }).plan).toEqual(read(text).plan);
    }
  } finally {
    english.dispose();
  }
}, 60_000);

// Frontend to token ids of the English Kale family, as web/engine.mjs does it: hyphen boundaries,
// sentence plan, toKaleEnglish. Expected ids are those of the reference mapping for this sentence.
kaleEnglish("English Kale token ids of a hyphenated number follow upstream's frontend", async () => {
  const vocabulary = await Bun.file(new URL("./fixtures/kale-english-vocabulary.json", import.meta.url)).text();
  const english = await createEnglishForTest();
  const ids = (text, options) => JSON.parse(phonyModule.sentencePlan(JSON.stringify(english.phonemize(text, options)), 128))
    .map((part) => Array.from(phonyModule.toKaleEnglish(JSON.stringify(part), vocabulary)));
  const text = "Exactly twenty-nine turkeys crossed the road this morning.";
  const expected = [0, 86, 92, 68, 156, 72, 53, 62, 54, 51, 16, 62, 65, 156, 86, 56, 62, 51, 16, 56, 156, 25, 56, 16, 62, 156, 87, 53, 51, 68, 16,
    53, 123, 156, 76, 61, 62, 16, 81, 83, 16, 123, 156, 31, 46, 16, 81, 102, 61, 16, 55, 156, 76, 123, 56, 102, 112, 4, 0];
  try {
    expect(ids(text, { hyphenBoundaries: true })).toEqual([expected]);
    // Without the boundary the space id (16) between the two parts is missing: one id fewer.
    const joined = ids(text)[0];
    expect(joined.length).toBe(expected.length - 1);
    expect(joined).toEqual(expected.filter((id, index) => index !== 18));
    // Two sentences are two utterances, each with the pad id at both ends.
    const two = ids("It is thirty-one. A well-known story.", { hyphenBoundaries: true });
    expect(two.length).toBe(2);
    for (const part of two) expect([part[0], part.at(-1)]).toEqual([0, 0]);
    // it is thirty one / a well known story: three word boundaries each.
    expect(two.map((part) => part.filter((id) => id === 16).length)).toEqual([3, 3]);
  } finally {
    english.dispose();
  }
}, 30_000);
