// All Dizione rule evaluation runs inside QuickJS WebAssembly, not the host JS VM.
import { Phonemizer } from "./engine.js";
import { DATA } from "./tables.js";
import { SYMBOLS, ValueError, tokenize } from "./symbols.js";
import { groups, stressClause, joinClause } from "./sentence.js";
import { trainedStream, untrainedSymbols } from "../../english-marks.mjs";
import { markHyphenUnits, boundaryGroups } from "../../english-hyphens.mjs";

let engine;
let vocabulary;
let symbolIds;

globalThis.initializeEnglish = (metadataText) => {
  const metadata = JSON.parse(metadataText);
  vocabulary = metadata.symbols;
  if (!Array.isArray(vocabulary) || vocabulary.length !== 88 || SYMBOLS.some((s, i) => vocabulary[i] !== s)) {
    throw new Error("ENGLISH_VOCABULARY_ABI: expected shared 88-symbol inventory");
  }
  symbolIds = new Map(vocabulary.map((s, i) => [s, i]));
  Object.assign(DATA, metadata.english.tables);
  const lookup = (word) => JSON.parse(__lookup(word));
  engine = new Phonemizer({
    lexicon: { get: lookup, has: (word) => lookup(word) !== null },
    model: {
      spellable: (word) => __spellable(word),
      predict: (word) => JSON.parse(__predict(word)),
    },
    aligner: { align: (word, phones) => JSON.parse(__align(word, JSON.stringify(phones))) },
    homographs: metadata.english.homographs,
  });
};

// Engine.analyse with the training frontend's punctuation convention: clauses end only at the marks
// the models were trained on; any other mark is removed from the stream before clauses are built.
function analyse(text, hyphenBoundaries) {
  const stream = trainedStream(engine.normalizer.tokens(text)), isMark = (token) => "mark" in token;
  const written = stream.map((token) => (isMark(token) ? token.mark : token.raw || token.text || "x"));
  const out = [];
  let words = [], places = [];
  const flush = () => {
    if (!words.length) return;
    const units = engine.units(words, places, written);
    if (hyphenBoundaries) markHyphenUnits(units, words);
    stressClause(units);
    joinClause(units);
    out.push(["clause", units]);
    words = [];
    places = [];
  };
  stream.forEach((token, place) => {
    if (isMark(token)) { flush(); out.push(["punct", token.mark]); }
    else { words.push(token); places.push(place); }
  });
  flush();
  return out;
}

// options.hyphenBoundaries: a hyphenated word is written as separate words in the plan (same phones,
// stress and linking). Only the English upstream Kale family asks for it; see web/english-hyphens.mjs.
globalThis.phonemizeEnglish = (text, options = {}) => {
  if (typeof text !== "string" || !text.trim()) throw new ValueError("text must not be empty");
  if (text.length > 2000) throw new ValueError("ENGLISH_TEXT_BOUND: maximum 2000 characters");
  // Bound retention even if the previous request failed after populating the cache.
  if (engine.cache.size > 2048) engine.cache.clear();
  // One whole-phrase analysis preserves clause stress, linking and homograph context.
  const hyphenBoundaries = options.hyphenBoundaries === true;
  const analysis = analyse(text, hyphenBoundaries);
  const pieces = analysis.map(([kind, value]) => kind === "punct" ? [true, value] : [false, hyphenBoundaries ? boundaryGroups(value) : groups(value)]);
  const out = tokenize(pieces);
  if (out.symbols.length > 512) throw new ValueError("ENGLISH_TOKEN_BOUND: maximum 512 tokens");
  if (out.unknown.length) throw new ValueError("ENGLISH_UNKNOWN_PHONE: " + out.unknown.join(" "));
  const untrained = untrainedSymbols(out.symbols);
  if (untrained.length) throw new ValueError("ENGLISH_UNTRAINED_SYMBOL: " + untrained.join(" "));
  const details = analysis.flatMap(([kind, units]) => kind === "punct" ? [] : units.map((unit) => ({
    text: unit.word, lang: "en", phones: unit.phones.map(([phone]) => phone), source: unit.source,
  })));
  return JSON.stringify({
    vocabulary: "phony-shared-v1",
    symbols: out.symbols,
    stress: out.stress,
    ids: out.symbols.map((symbol) => symbolIds.get(symbol)),
    details,
  });
};
