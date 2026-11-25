import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const output=process.env.PROOF_DIR||'artifacts/umlaut-trace';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');
 await page.waitForFunction(()=>window.tts?.status().ready);
 const results=await page.evaluate(async()=>{
  const manifest=await (await fetch('/manifest.json')).json();
  const asset=async key=>new Uint8Array(await (await fetch(manifest.assets[key].url)).arrayBuffer());
  const [phony,nrmlz,meta,de,weights,pwasm,nwasm]=await Promise.all([
   import('/assets/phony/phony_wasm.js'),import('/assets/nrmlz/nrmlz_wasm.js'),
   ...['frontend.metadata','frontend.de','frontend.weights','phony.wasm','nrmlz.wasm'].map(asset)
  ]);
  await phony.default({module_or_path:pwasm});await nrmlz.default({module_or_path:nwasm});
  const frontend=phony.Phony.fromPacked(new TextDecoder().decode(meta),de);frontend.loadModels(weights);
  const ort=await import('/assets/ort/ort.wasm.min.mjs');ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/assets/ort/';ort.env.wasm.wasmBinary=await asset('ort.ort-wasm-simd-threaded.wasm');
  const planner=await ort.InferenceSession.create(await asset('kale.plan.onnx'),{executionProviders:['wasm']});
  const texts=['Grüße','schön','fünf','über','Gerät','Wertschöpfung','Fünf Schüler planen die Wertschöpfung.','Die Tür ist grün. Schöne Grüße für fünf Schüler.'];
  const traces=[];
  for(const text of texts)for(const form of ['NFC','NFD']){
   const input=text.normalize(form),normalized=nrmlz.normalize('de',input);
   const plan=JSON.parse(frontend.phonemize(normalized,'de','[]'));
   const vocabulary=manifest.models.kale.vocabulary;
   const kaleIds=Array.from(phony.toKale(JSON.stringify(plan),JSON.stringify(vocabulary)));
   const inverse=Object.fromEntries(Object.entries(vocabulary.vocab).map(([phone,id])=>[id,phone]));
   const prediction=await planner.run({tokens:new ort.Tensor('int64',BigInt64Array.from(kaleIds,BigInt),[1,kaleIds.length]),voice:new ort.Tensor('int64',BigInt64Array.of(0n),[1])});
   const durations=Array.from(prediction.durations.data,Number);
   const timedPhones=kaleIds.map((id,i)=>({phone:inverse[id],id,frames:durations[i],required:vocabulary.required_ids.includes(id)}));
   for(const tensor of Object.values(prediction))tensor.dispose?.();
   traces.push({timedPhones,text,form,input,codepoints:[...input].map(c=>c.codePointAt(0).toString(16)),normalized,plan,kaleIds,kalePhones:kaleIds.map(id=>inverse[id])});
  }
  return traces;
 });
 await writeFile(output+'/RESULT.json',JSON.stringify(results,null,2)+'\n');
 for(let i=0;i<results.length;i+=2){
  const a=results[i],b=results[i+1];
  if(a.normalized!==b.normalized||JSON.stringify(a.plan)!==JSON.stringify(b.plan)||JSON.stringify(a.timedPhones)!==JSON.stringify(b.timedPhones))throw Error('CANONICAL_UNICODE_MISMATCH:'+a.text);
  if(a.timedPhones.some(p=>['œ','øː','yː','ʏ'].includes(p.phone)&&p.frames<1))throw Error('UMLAUT_DURATION_MISSING:'+a.text);
 }
 for(const result of results)console.log(JSON.stringify({text:result.text,form:result.form,normalized:result.normalized,phones:result.plan.symbols,stress:result.plan.stress,kalePhones:result.kalePhones,timedVowels:result.timedPhones.filter(p=>['œ','øː','yː','ʏ'].includes(p.phone))}));
}finally{await browser.close();}
