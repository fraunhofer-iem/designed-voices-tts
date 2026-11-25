// English text with marks the models were never trained on (" ' ( ) dash ellipsis), in the served
// build in Chrome: no such symbol may be in the plan the model receives, the plan and the audio must
// equal those of the same words without the marks, and audio must be produced. The served English
// bundle must also reproduce the training plan of all 404 English training texts.
// PREVIEW_URL=<preview> [PROOF_DIR=<dir>] bun tools/check-english-marks.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';
const P=await previewProfile(process.env.PREVIEW_URL),EN=P.english;
const directory=process.env.PROOF_DIR||'artifacts/english-marks-proof';
const UNTRAINED=['"',"'",'(',')','—','…'];
// [text with untrained marks, same words with trained marks only]
const pairs=[
 ['“Wait (just a moment) -- it’s the dogs’ turn…” he said — ‘fine’.',"Wait just a moment it's the dogs turn. he said fine."],
 ['"Stop," she said, "right now."','Stop, she said, right now.'],
 ['The plan (the old one) failed.','The plan the old one failed.'],
 ['Yes, sir--about that.','Yes, sir about that.'],
 ['The answer — if there is one — is no.','The answer if there is one is no.'],
 ["The dogs' bowls are 'empty'.",'The dogs bowls are empty.'],
 ['Wait… what?','Wait. what?'],
];
const guards=[
 {text:'Wait... Really?! Yes.',chunks:3,phones:'<bos> w eɪ t . ɹ iə l i ? ! j ɛ s . <eos>'},
 {text:'I wonder… (well) — never mind.',chunks:2},
 {text:"Tell 'em it's nine o'clock at the café.",chunks:1,includes:['<sp> ə m <sp>','k ə f eɪ']},
 {text:'Yes, sir--about that.',chunks:1,includes:['s ɜː ɹ <sp> ɐ b aʊ t']},
];
const training=(await Bun.file(new URL('../tests/fixtures/english-training-plans.jsonl',import.meta.url)).text()).trim().split('\n').map(line=>JSON.parse(line));
const sha=text=>new Bun.CryptoHasher('sha256').update(Buffer.from(text,'base64')).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await mkdir(directory,{recursive:true});const page=await browser.newPage();
 await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:8894/');await page.waitForFunction(()=>window.tts?.status().ready);
 const runtime=await page.evaluate(async()=>{const m=await(await fetch('/manifest.json')).json();
  return {symbols:(await(await fetch(m.assets['frontend.metadata'].url)).json()).symbols,english:m.assets['app.english.js'],phony:m.assets['phony.wasm'],nrmlz:m.assets['nrmlz.wasm']};});
 if(runtime.symbols.length!==88||UNTRAINED.some((mark,i)=>runtime.symbols[11+i]!==mark))throw Error('SYMBOL_INVENTORY_CHANGED');
 const trained=new Set(runtime.symbols.filter((symbol,id)=>id!==0&&id!==4&&!UNTRAINED.includes(symbol)));
 const synthesize=input=>page.evaluate(async input=>{
  await window.tts.synthesize({lang:'en',...input});const r=window.__lastTtsResult;
  const bytes=new Uint8Array(r.audio.buffer,r.audio.byteOffset,r.audio.byteLength);let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {text:input.text,voice:input.voice,normalized:r.normalized,phones:r.phones,chunks:r.chunks,samples:r.audio.length,finite:r.audio.every(Number.isFinite),encoded:btoa(binary)};
 },{family:EN.family,...input});
 const check=result=>{
  const symbols=result.phones.split(' '),outside=symbols.filter(symbol=>!trained.has(symbol));
  if(outside.length)throw Error('UNTRAINED_SYMBOL_REACHES_MODEL:'+JSON.stringify({text:result.text,outside,phones:result.phones}));
  if(result.samples<2400||!result.finite)throw Error('ENGLISH_MARK_AUDIO_MISSING:'+JSON.stringify({text:result.text,samples:result.samples}));
  result.sha256=sha(result.encoded);delete result.encoded;return result;
 };
 const results=[];
 for(const voice of [P.english.voice,P.englishSecond.voice])for(const [text,plain] of pairs){
  const marked=check(await synthesize({voice,text})),same=check(await synthesize({voice,text:plain}));
  if(!UNTRAINED.some(mark=>marked.normalized.includes(mark))&&!/--| - |\.\.\./.test(marked.normalized))throw Error('MARK_LOST_BEFORE_FRONTEND:'+JSON.stringify(marked));
  if(marked.phones!==same.phones||marked.chunks!==same.chunks)throw Error('MARKED_PLAN_DIFFERS_FROM_PLAIN:'+JSON.stringify({marked,same}));
  if(marked.sha256!==same.sha256||marked.samples!==same.samples)throw Error('MARKED_AUDIO_DIFFERS_FROM_PLAIN:'+JSON.stringify({marked,same}));
  results.push({voice,marked,plain:same});
 }
 const guarded=[];
 for(const guard of guards){
  const result=check(await synthesize({voice:EN.voice,text:guard.text}));guarded.push({...guard,result});
  if(result.chunks!==guard.chunks)throw Error('ENGLISH_MARK_SEGMENTS:'+JSON.stringify({guard,result}));
  if(guard.phones&&result.phones!==guard.phones)throw Error('ENGLISH_MARK_PLAN:'+JSON.stringify({guard,result}));
  for(const part of guard.includes||[])if(!result.phones.includes(part))throw Error('ENGLISH_MARK_READING:'+JSON.stringify({guard,result}));
 }
 // German keeps its own path; it must not start to emit these symbols either.
 const german=await page.evaluate(async()=>{await window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text:'„Halt“, sagte sie (leise) – jetzt… wirklich?'});const r=window.__lastTtsResult;return {normalized:r.normalized,phones:r.phones,chunks:r.chunks,samples:r.audio.length};});
 if(german.phones.split(' ').some(symbol=>UNTRAINED.includes(symbol))||german.samples<2400)throw Error('GERMAN_MARKS:'+JSON.stringify(german));
 // The served English bundle, Phony and nrmlz, loaded in the page: training plans of all 404 texts.
 const parity=await page.evaluate(async rows=>{
  const manifest=await(await fetch('/manifest.json')).json(),bytes=async key=>new Uint8Array(await(await fetch(manifest.assets[key].url)).arrayBuffer());
  const phony=await import(manifest.assets['phony.module'].url),nrmlz=await import(manifest.assets['nrmlz.module'].url),{createEnglish}=await import(manifest.assets['app.english.js'].url);
  await phony.default({module_or_path:await bytes('phony.wasm')});await nrmlz.default({module_or_path:await bytes('nrmlz.wasm')});
  const english=await createEnglish({phonyModule:phony,metadataText:new TextDecoder().decode(await bytes('frontend.metadata')),weightsBytes:await bytes('frontend.weights'),englishDictionaryBytes:await bytes('frontend.en'),quickjsWasmBytes:await bytes('quickjs.wasm')});
  const different=[];let untrainedIds=0;
  try{for(const row of rows){
   const plan=english.phonemize(nrmlz.normalize('en',row.text));
   if(plan.ids.some(id=>id>=11&&id<=16))untrainedIds++;
   if(plan.symbols.join(' ')!==row.symbols||plan.stress.join('')!==row.stress)different.push({text:row.text,symbols:plan.symbols.join(' ')});
  }}finally{english.dispose();}
  return {texts:rows.length,identical:rows.length-different.length,untrainedIds,different};
 },training);
 await writeFile(directory+'/RESULT.json',JSON.stringify({family:EN.family,runtime:{english:runtime.english,phony:runtime.phony,nrmlz:runtime.nrmlz},pairs:results,guards:guarded,german,trainingPlans:parity},null,2)+'\n');
 if(parity.texts!==404||parity.identical!==404||parity.untrainedIds)throw Error('TRAINING_PLAN_PARITY:'+JSON.stringify({...parity,different:parity.different.slice(0,3)}));
 console.log('PASS: English marks outside , . ? ! ; : never reach the model ('+results.length+' marked/plain pairs with identical plan and audio, '+guarded.length+' guards); served bundle reproduces '+parity.identical+' of '+parity.texts+' training plans');
}finally{await browser.close();}
