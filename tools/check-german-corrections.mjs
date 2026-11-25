// German dictionary corrections in the served Phony assets, through the real WASM frontend in Chrome and
// through the application with German Kale. It asserts phones, stress and planned durations.
// It is not a listening result: nobody hears the audio in this check.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
// One result per preview, so that checking both configurations keeps both.
const output=process.env.CORRECTIONS_PROOF_DIR||'artifacts/german-corrections/'+(new URL(url).port||'default');
// Plans of single words: corrected entries, a word added to the dictionary, and words that must stay as they are
// (Latin -äum/-eum, prefix boundary, French -eur, a correct inflected form).
const words=[
 {text:'räum',plan:'ʁ ˈɔɪ m',source:'lexicon',corrected:true},
 {text:'träum',plan:'t ʁ ˈɔɪ m',source:'lexicon',corrected:true},
 {text:'Fräulein',plan:'f ʁ ˈɔɪ l aɪ n',source:'lexicon',corrected:true},
 {text:'Ingenieure',plan:'ˈɪ n j ɡ ɛ n iː øː ʁ ə',source:'lexicon',corrected:true},
 {text:'Linoleum',plan:'l ˈɪ n oː l eː ʊ m',source:'lexicon',corrected:true},
 {text:'aufräumen',plan:'ˈaʊ f ʁ ɔɪ m n̩',source:'lexicon'},
 {text:'Jubiläum',plan:'j ˈʊ b ɪ l eː ʊ m',source:'lexicon'},
 {text:'Museum',plan:'m ˈʊ z eː ʊ m',source:'lexicon'},
 {text:'beurteilen',plan:'b ə ʊ ʁ t ˈaɪ l n̩',source:'lexicon'},
 {text:'geübt',plan:'ɡ ə ˈyː p t',source:'lexicon'},
 {text:'Friseur',plan:'f ʁ ˈɪ z øː ɐ',source:'lexicon'},
 {text:'Räume',plan:'ʁ ˈɔɪ m ə',source:'lexicon'},
];
// Sentences through the application: normalizer, frontend, planner and waveform of German Kale.
const sentences=[
 {text:'Räum das jetzt auf.',has:['ʁ ɔɪ m <sp> d aː s'],lacks:['eː ʊ m']},
 {text:'Träum weiter, Fräulein.',has:['t ʁ ɔɪ m <sp>','f ʁ ɔɪ l aɪ n'],lacks:['eː ʊ m','f ʁ ɔ l']},
 {text:'Wir müssen heute aufräumen.',has:['aʊ f ʁ ɔɪ m n̩'],lacks:[]},
 {text:'Das Museum feiert ein Jubiläum.',has:['m ʊ z eː ʊ m','j ʊ b ɪ l eː ʊ m'],lacks:['ɔɪ']},
];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await mkdir(output,{recursive:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.waitForFunction(()=>window.tts?.status().ready);
 const traced=await page.evaluate(async words=>{
  const manifest=await (await fetch('/manifest.json')).json();
  const asset=async key=>new Uint8Array(await (await fetch(manifest.assets[key].url)).arrayBuffer());
  const [phony,nrmlz,meta,de,weights,pwasm,nwasm]=await Promise.all([
   import('/assets/phony/phony_wasm.js'),import('/assets/nrmlz/nrmlz_wasm.js'),
   ...['frontend.metadata','frontend.de','frontend.weights','phony.wasm','nrmlz.wasm'].map(asset)
  ]);
  await phony.default({module_or_path:pwasm});await nrmlz.default({module_or_path:nwasm});
  const metadata=JSON.parse(new TextDecoder().decode(meta));
  const frontend=phony.Phony.fromPacked(JSON.stringify(metadata),de);frontend.loadModels(weights);
  const ort=await import('/assets/ort/ort.wasm.min.mjs');ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='/assets/ort/';ort.env.wasm.wasmBinary=await asset('ort.ort-wasm-simd-threaded.wasm');
  const planner=await ort.InferenceSession.create(await asset('kale.plan.onnx'),{executionProviders:['wasm']});
  const vocabulary=manifest.models.kale.vocabulary,inverse=Object.fromEntries(Object.entries(vocabulary.vocab).map(([phone,id])=>[id,phone]));
  const rows=[];
  for(const word of words)for(const form of ['NFC','NFD']){
   // The frontend takes normalized text; the trailing period the normalizer adds to a bare word is left out here.
   const normalized=nrmlz.normalize('de',word.text.normalize(form)).replace(/\.$/,'');
   const plan=JSON.parse(frontend.phonemize(normalized,'de','[]'));
   const marked=plan.symbols.slice(1,-1).map((phone,i)=>(plan.stress[i+1]===1?'ˈ':'')+phone).join(' ');
   const ids=Array.from(phony.toKale(JSON.stringify(plan),JSON.stringify(vocabulary)));
   const prediction=await planner.run({tokens:new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),voice:new ort.Tensor('int64',BigInt64Array.of(0n),[1])});
   const durations=Array.from(prediction.durations.data,Number);
   for(const tensor of Object.values(prediction))tensor.dispose?.();
   rows.push({text:word.text,form,normalized,marked,sources:plan.details.map(d=>d.source),
    timed:ids.map((id,i)=>({phone:inverse[id],frames:durations[i],required:vocabulary.required_ids.includes(id)}))});
  }
  return {rows,corrections:metadata.german_corrections||null,frontend:{metadata:manifest.assets['frontend.metadata'].sha256,
   dictionary:manifest.assets['frontend.de'].sha256,weights:manifest.assets['frontend.weights'].sha256,wasm:manifest.assets['phony.wasm'].sha256}};
 },words);
 const failures=[];
 if(!traced.corrections||!(traced.corrections.count>0)||!/^[0-9a-f]{64}$/.test(traced.corrections.sha256))failures.push('NO_CORRECTIONS_RECORDED_IN_SERVED_DICTIONARY');
 for(const row of traced.rows){
  const expected=words.find(word=>word.text===row.text);
  if(row.marked!==expected.plan)failures.push(`PLAN:${row.text}/${row.form}: ${row.marked} (expected ${expected.plan})`);
  if(row.sources.length!==1||row.sources[0]!==expected.source)failures.push(`SOURCE:${row.text}/${row.form}: ${row.sources}`);
  if(row.timed.some(p=>p.required&&p.frames<1))failures.push(`PHONE_WITHOUT_DURATION:${row.text}/${row.form}`);
 }
 const spoken=[];
 for(const sentence of sentences){
  const result=await page.evaluate(async text=>{
   await window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text});const r=window.__lastTtsResult;
   let peak=0;for(const sample of r.audio)peak=Math.max(peak,Math.abs(sample));
   return {normalized:r.normalized,phones:r.phones,chunks:r.chunks,samples:r.audio.length,peak,finite:r.audio.every(Number.isFinite)};
  },sentence.text);
  spoken.push({text:sentence.text,...result});
  for(const part of sentence.has)if(!result.phones.includes(part))failures.push(`SPOKEN_PLAN_LACKS:${sentence.text}: ${part} in ${result.phones}`);
  for(const part of sentence.lacks)if(result.phones.includes(part))failures.push(`SPOKEN_PLAN_HAS:${sentence.text}: ${part} in ${result.phones}`);
  if(!(result.samples>12000)||!result.finite||!(result.peak>0.01))failures.push(`NO_AUDIO:${sentence.text}`);
 }
 if(errors.length)failures.push('PAGE_ERRORS:'+errors.join('|'));
 const result={url,browser:await browser.version(),...traced,spoken,failures,
  scope:'Phones, stress, sources and planned durations through the served WASM frontend, and generated audio of German Kale. Nobody listened.'};
 await writeFile(output+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 for(const row of traced.rows.filter(row=>row.form==='NFC'))console.log(JSON.stringify({text:row.text,plan:row.marked,source:row.sources[0]}));
 for(const row of spoken)console.log(JSON.stringify({text:row.text,phones:row.phones,samples:row.samples}));
 console.log(JSON.stringify({corrections:traced.corrections,frontend:traced.frontend}));
 if(failures.length)throw Error('GERMAN_CORRECTIONS_FAILED:\n'+failures.join('\n'));
 console.log('PASS');
}finally{await browser.close();}
