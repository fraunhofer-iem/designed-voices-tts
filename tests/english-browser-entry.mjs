import { createEnglish } from "../web/english.mjs";
import { checkEnglish } from "./english-fixtures.mjs";

export async function runEnglishBrowserChecks() {
  const phonyModule = await import("/phony/phony_wasm.js");
  const bytes = async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Missing test asset: ${path}`);
    return response.arrayBuffer();
  };
  await phonyModule.default({ module_or_path: await bytes("/phony/phony_wasm_bg.wasm") });
  const english = await createEnglish({
    phonyModule,
    metadataText: await (await fetch("/assets/frontend.json")).text(),
    weightsBytes: new Uint8Array(await bytes("/assets/models.safetensors")),
    englishDictionaryBytes: new Uint8Array(await bytes("/assets/english.lex")),
    quickjsWasmBytes: await bytes("/assets/quickjs.wasm"),
  });
  try {
    return checkEnglish(english);
  } finally {
    english.dispose();
  }
}
