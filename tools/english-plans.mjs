// Plans of the English browser frontend for a list of texts, in the call order of web/engine.mjs:
// nrmlz.normalize('en', text) -> English frontend in QuickJS -> phony.sentencePlan(plan, 128).
// Reads {id, text} lines on stdin, writes {id, text, normalized, chunks:[{symbols, stress}]} lines.
//   bun tools/english-plans.mjs --assets <frontend assets> --phony <pkg-web> --nrmlz <pkg-web> [--hyphen-boundaries] [--kale-english <config.json> | --kale <config.json>]
// --hyphen-boundaries is the plan convention of the English upstream Kale family; --kale-english adds its token ids.
// --kale adds the token ids of a model of the German family type (the English fit with our own voices): default plans, toKale.
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createEnglish} from '../web/english.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const assets=resolve(option('assets')),phonyDir=resolve(option('phony')),nrmlzDir=resolve(option('nrmlz'));
const hyphenBoundaries=args.includes('--hyphen-boundaries');
const config=option('kale-english')||option('kale'),mapping=option('kale-english')?'toKaleEnglish':'toKale';
if(option('kale-english')&&option('kale'))throw Error('Give --kale-english or --kale, not both.');
const vocabulary=config?JSON.stringify(JSON.parse(readFileSync(resolve(config),'utf8')).vocabulary):null;
const phony=await import(pathToFileURL(join(phonyDir,'phony_wasm.js')).href),nrmlz=await import(pathToFileURL(join(nrmlzDir,'nrmlz_wasm.js')).href);
await phony.default({module_or_path:readFileSync(join(phonyDir,'phony_wasm_bg.wasm'))});
await nrmlz.default({module_or_path:readFileSync(join(nrmlzDir,'nrmlz_wasm_bg.wasm'))});
const english=await createEnglish({phonyModule:phony,metadataText:readFileSync(join(assets,'frontend.json'),'utf8'),
 weightsBytes:new Uint8Array(readFileSync(join(assets,'models.safetensors'))),englishDictionaryBytes:new Uint8Array(readFileSync(join(assets,'english.lex'))),
 quickjsWasmBytes:readFileSync(new URL(import.meta.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')))});
nrmlz.warmUp();
const out=[];
try{
 for(const line of readFileSync(0,'utf8').split('\n').filter(line=>line.trim())){
  const row=JSON.parse(line),normalized=nrmlz.normalize('en',row.text),plan=english.phonemize(normalized,{hyphenBoundaries});
  const chunks=JSON.parse(phony.sentencePlan(JSON.stringify(plan),128)).map(part=>({symbols:part.symbols,stress:part.stress,
   ...(vocabulary?{ids:Array.from(phony[mapping](JSON.stringify(part),vocabulary))}:{})}));
  out.push(JSON.stringify({id:row.id,text:row.text,normalized,chunks}));
 }
}finally{english.dispose();}
process.stdout.write(out.join('\n')+'\n');
