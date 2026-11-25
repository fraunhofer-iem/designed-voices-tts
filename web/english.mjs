// English rules execute in QuickJS WASM; lexical/neural primitives execute in Rust WASM.
// This host module only owns resources and marshals strings/bytes across the two VMs.
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { DIZIONE_RULES } from "./dizione-rules.js";

/**
 * Caller initializes phonyModule's WASM before calling this factory.
 * quickjsWasmBytes is the release-sync 0.31.0 binary served at assets/quickjs.wasm.
 * phonemize accepts NRMLZ-normalized English and returns Phony's shared Output ABI.
 * Plans contain only the marks , . ? ! ; : the models were trained on (web/english-marks.mjs).
 * phonemize(text, {hyphenBoundaries: true}) writes the parts of a hyphenated word as separate words;
 * the default is the convention the Voca and German Kale training plans have (one word).
 */
export async function createEnglish({ phonyModule, metadataText, weightsBytes, englishDictionaryBytes, quickjsWasmBytes }) {
  const variant = newVariant(RELEASE_SYNC, { wasmBinary: quickjsWasmBytes });
  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  let deadline = Date.now() + 10_000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  let backend;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    vm.dispose();
    runtime.dispose();
    backend?.free();
  }

  function evaluate(code) {
    const result = vm.evalCode(code, "dizione-quickjs.js");
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`English frontend: ${error.message || error}`, { cause: error });
    }
    const value = vm.getString(result.value);
    result.value.dispose();
    return value;
  }

  function bridge(name, callback) {
    const fn = vm.newFunction(name, (...args) => {
      if (Date.now() > deadline) throw new Error("ENGLISH_DEADLINE");
      return vm.newString(callback(...args.map((arg) => vm.getString(arg))));
    });
    vm.setProp(vm.global, name, fn);
    fn.dispose();
  }

  try {
    backend = new phonyModule.EnglishBackend(metadataText, englishDictionaryBytes, weightsBytes);
    bridge("__lookup", (word) => backend.lookup(word));
    bridge("__spellable", (word) => backend.spellable(word));
    bridge("__predict", (word) => backend.predict(word));
    bridge("__align", (word, phones) => backend.align(word, phones));
    evaluate(DIZIONE_RULES);
    evaluate(`initializeEnglish(${JSON.stringify(metadataText)}); "ready"`);
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    phonemize(text, { hyphenBoundaries = false } = {}) {
      if (disposed) throw new Error("English frontend is disposed");
      deadline = Date.now() + 10_000;
      const options = JSON.stringify({ hyphenBoundaries: hyphenBoundaries === true });
      return JSON.parse(evaluate(`phonemizeEnglish(${JSON.stringify(text)}, ${options})`));
    },
    dispose,
  };
}
