// Plans of the German browser frontend for a list of texts, in the call order of web/engine.mjs:
// nrmlz.normalize('de', text) -> Phony German in WASM -> phony.sentencePlan(plan, 128) -> phony.toKale(chunk).
// Reads {id, text} lines on stdin, writes {id, text, normalized, chunks:[{symbols, stress, ids}]} lines.
//   bun tools/german-plans.mjs --assets <frontend assets> --phony <pkg-web> --nrmlz <pkg-web> --kale <config.json>
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const assets=resolve(option('assets')),phonyDir=resolve(option('phony')),nrmlzDir=resolve(option('nrmlz'));
const vocabulary=JSON.stringify(JSON.parse(readFileSync(resolve(option('kale')),'utf8')).vocabulary);
const phony=await import(pathToFileURL(join(phonyDir,'phony_wasm.js')).href),nrmlz=await import(pathToFileURL(join(nrmlzDir,'nrmlz_wasm.js')).href);
await phony.default({module_or_path:readFileSync(join(phonyDir,'phony_wasm_bg.wasm'))});
await nrmlz.default({module_or_path:readFileSync(join(nrmlzDir,'nrmlz_wasm_bg.wasm'))});
const german=phony.Phony.fromPacked(readFileSync(join(assets,'frontend.json'),'utf8'),new Uint8Array(readFileSync(join(assets,'german.lex'))));
german.loadModels(new Uint8Array(readFileSync(join(assets,'models.safetensors'))));nrmlz.warmUp();
const out=[];
for(const line of readFileSync(0,'utf8').split('\n').filter(line=>line.trim())){
 const row=JSON.parse(line),normalized=nrmlz.normalize('de',row.text),plan=german.phonemize(normalized,'de','[]');
 const chunks=JSON.parse(phony.sentencePlan(plan,128)).map(part=>({symbols:part.symbols,stress:part.stress,ids:Array.from(phony.toKale(JSON.stringify(part),vocabulary))}));
 out.push(JSON.stringify({id:row.id,text:row.text,normalized,chunks}));
}
process.stdout.write(out.join('\n')+'\n');
