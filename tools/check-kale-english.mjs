// Real Chrome check for the English Kale family (the public Kale TTS 1 Nano with this project's
// English frontend): literal model names, its eight voices, every English example with every
// voice, word boundaries inside hyphenated words, the served token-id mapping, and screenshots
// of both interface languages at desktop and phone width. A build without the family is skipped.
//
//   PREVIEW_URL=http://127.0.0.1:8895/ [PROOF_DIR=<dir>] bun tools/check-kale-english.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {EXAMPLES,EXAMPLE_KINDS} from '../web/examples.mjs';
import {previewProfile} from './preview-profile.mjs';

const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const P=await previewProfile(url);
if(!P.has('kale-en')){console.log('SKIP: this build does not serve the English Kale family ('+P.families.join(', ')+')');process.exit(0);}
const out=process.env.PROOF_DIR||'artifacts/kale-english-proof';await mkdir(out,{recursive:true});
const assert=(ok,code,detail)=>{if(!ok)throw Error(detail===undefined?code:code+':'+JSON.stringify(detail));};
const VOICES=P.voices('kale-en','en');
// [text, part of the plan that must be present]: the parts of a hyphenated word are separate words.
const HYPHENS=[
 ['Exactly twenty-nine turkeys crossed the road this morning.','t w ɛ n t i <sp> n aɪ n'],
 ['It is thirty-one.','θ ɜː ɾ i <sp> w ʌ n'],
 ['A well-known story.','w ɛ l <sp> n oʊ n'],
 ['The ticket costs $18.40.','eɪ t iː n <sp> d ɑː l ɚ z'],
];
// Token ids of the first sentence from the reference mapping: pad, one id per upstream character, pad.
const TWENTY_NINE=[0,86,92,68,156,72,53,62,54,51,16,62,65,156,86,56,62,51,16,56,156,25,56,16,62,156,87,53,51,68,16,53,123,156,76,61,62,16,81,83,16,123,156,31,46,16,81,102,61,16,55,156,76,123,56,102,112,4,0];

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 // A same-origin GET the static host redirects to its own file storage (the Space's CDN) is not a request of the page.
 const rootOf=request=>{let at=request;while(at.redirectedFrom())at=at.redirectedFrom();return at;};
 page.on('request',request=>{const own=r=>r.url().startsWith(new URL(url).origin+'/')||/^(data|blob):/.test(r.url());
  if(!own(request)&&!(request.redirectedFrom()&&request.method()==='GET'&&request.postData()===null&&own(rootOf(request))))external.push(request.url());});
 await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
 assert(VOICES.length===8&&VOICES.join()==='kale-en-f01,kale-en-f02,kale-en-f03,kale-en-f04,kale-en-m01,kale-en-m02,kale-en-m03,kale-en-m04','ENGLISH_KALE_ROSTER',VOICES);
 assert(P.manifest.models['kale-en'].languages.join()==='en'&&P.manifest.models['kale-en'].vocabulary.version==='kokoro-native-en-us','ENGLISH_KALE_SPEC',P.manifest.models['kale-en'].languages);

 // Selection: literal names, own speech language only, numbered voice labels in both interface languages.
 const read=()=>page.evaluate(()=>{const $=id=>document.getElementById(id);return {
  models:[...$('model').options].map(o=>o.value+'='+o.text),model:$('model').value,language:$('language').value,
  languages:[...$('language').options].map(o=>o.value+'='+o.text+(o.disabled?' (disabled)':'')),
  voices:[...$('voice').options].map(o=>o.value+'='+o.text),info:$('voice-info').textContent,size:$('model-size').textContent,
  method:$('method-models').textContent,links:[...document.querySelectorAll('.source-links a')].filter(a=>!a.hidden).map(a=>a.textContent+' '+a.href),
  compare:[...$('compare').children].map(node=>node.tagName==='OPTGROUP'?node.label+':'+node.children.length:node.text)};});
 const ui={};
 for(const locale of ['de','en']){
  await page.evaluate(locale=>{window.tts.setLocale(locale);const m=document.getElementById('model');m.value='kale-en';m.dispatchEvent(new Event('change'));},locale);
  ui[locale]=await read();
  await page.evaluate(()=>{const m=document.getElementById('model');m.value='kale';m.dispatchEvent(new Event('change'));});
  ui[locale+'German']=await read();
 }
 for(const locale of ['de','en']){
  const view=ui[locale],german=ui[locale+'German'];
  assert(view.models.join()==='kale=Kale Nano DE,kale-en=Kale Nano EN'&&view.model==='kale-en'&&view.language==='en','MODEL_NAMES',view.models);
  assert(view.languages.join()===(locale==='de'?'de=Deutsch (disabled),en=English':'de=German (disabled),en=English'),'ENGLISH_KALE_LANGUAGES',view.languages);
  assert(german.languages.join()===(locale==='de'?'de=Deutsch,en=English (disabled)':'de=German,en=English (disabled)')&&german.language==='de','GERMAN_KALE_LANGUAGES',german.languages);
  assert(view.voices.join()===VOICES.map(voice=>voice+'='+P.voiceText(voice,locale)+' · English').join(),'VOICE_LABELS',view.voices);
  assert(view.info===(locale==='de'?'8 englische Stimmen':'8 English voices')&&view.size===P.graphSize('kale-en')&&view.compare.join()===(locale==='de'?'Keine':'None')+',Kale Nano EN:7','ENGLISH_KALE_PANEL',view);
  assert(view.method.includes('Kale TTS 1 Nano')&&!view.method.includes('Voca')&&view.method===german.method,'METHOD_COPY',view.method);
  assert(view.links.length===3&&view.links.some(link=>link.endsWith('https://huggingface.co/KaleComputer/kale-tts-1-nano'))&&!view.links.some(link=>/voca/i.test(link)),'MODEL_LINKS',view.links);
 }
 await page.evaluate(()=>window.tts.setLocale('de'));

 // The served Phony build maps a plan to the upstream ids (same case as its unit test).
 const mapping=await page.evaluate(async()=>{
  const manifest=await(await fetch('/manifest.json')).json(),phony=await import(manifest.assets['phony.module'].url);
  await phony.default({module_or_path:new Uint8Array(await(await fetch(manifest.assets['phony.wasm'].url)).arrayBuffer())});
  const symbols=['<bos>','t','w','ɛ','n','t','i','<sp>','n','aɪ','n','<eos>'],stress=[0,0,0,1,0,0,0,0,0,1,0,0];
  const plan={vocabulary:'phony-shared-v1',symbols,stress,ids:symbols.map(()=>0),details:[]},vocabulary=JSON.stringify(manifest.models['kale-en'].vocabulary);
  let german;try{phony.toKaleEnglish(JSON.stringify({...plan,symbols:['<bos>','ʁ','<eos>'],stress:[0,0,0],ids:[0,0,0]}),vocabulary);german='accepted';}catch(error){german=String(error.message||error);}
  return {ids:Array.from(phony.toKaleEnglish(JSON.stringify(plan),vocabulary)),german};
 });
 assert(mapping.ids.join()==='0,62,65,156,86,56,62,51,16,56,156,25,56,0'&&mapping.german.startsWith('UNMAPPED_KALE_PHONE'),'SERVED_ID_MAPPING',mapping);

 const synth=input=>page.evaluate(async input=>{
  const summary=await window.tts.synthesize({family:'kale-en',lang:'en',...input}),r=window.__lastTtsResult,planned=r.timing.planned;
  return {voice:input.voice,samples:r.audio.length,finite:r.audio.every(Number.isFinite),normalized:r.normalized,phones:r.phones,chunks:r.chunks,speed:summary.speed,
   tokens:planned.map(list=>list.length),untimed:planned.flat().filter(frames=>frames<1).length,frames:planned.flat().reduce((a,b)=>a+b,0),hop:r.timing.hop,
   synthesisMs:r.metrics.run.stages.synthesis.ms,rtf:r.metrics.run.synthesisRtf,title:document.getElementById('audio-title').textContent,detail:document.getElementById('audio-detail').textContent};
 },input);

 // Hyphenated words: a word boundary between the parts, and the token count of the reference ids.
 const hyphens=[];
 for(const [text,part] of HYPHENS){
  const result=await synth({voice:'kale-en-f01',text});
  assert(result.phones.includes(part)&&result.samples>12000&&result.finite,'HYPHEN_BOUNDARY_MISSING',{text,phones:result.phones});
  hyphens.push({text,normalized:result.normalized,phones:result.phones,tokens:result.tokens});
 }
 assert(hyphens[0].tokens.join()===String(TWENTY_NINE.length),'TOKEN_COUNT_DIFFERS_FROM_REFERENCE_IDS',{tokens:hyphens[0].tokens,expected:TWENTY_NINE.length});

 // Every English example with every English Kale voice.
 const examples=[];
 for(const voice of VOICES)for(const kind of EXAMPLE_KINDS){
  const text=EXAMPLES.en[kind],result=await synth({voice,text});
  assert(result.samples>12000&&result.finite&&result.phones.startsWith('<bos>')&&result.speed===1,'EXAMPLE_NOT_SYNTHESIZED',{voice,kind,samples:result.samples});
  assert(result.untimed===0&&result.samples===result.frames*result.hop,'EXAMPLE_TIMING',{voice,kind,untimed:result.untimed,samples:result.samples,frames:result.frames});
  if(['plain','question'].includes(kind))assert(result.normalized===text,'EXAMPLE_PLAIN_TEXT_REWRITTEN',{kind,normalized:result.normalized});
  else assert(result.normalized!==text&&!/\d|[€$]/.test(result.normalized),'EXAMPLE_NOT_READ_OUT',{kind,normalized:result.normalized});
  assert(result.title===P.voiceText(voice,'de')+' · English'&&result.detail.startsWith('Kale Nano EN · 1.00× · '),'EXAMPLE_LISTENING_COPY',{title:result.title,detail:result.detail});
  examples.push({voice,kind,text,normalized:result.normalized,phones:result.phones,chunks:result.chunks,seconds:result.samples/24000,synthesisMs:result.synthesisMs,rtf:result.rtf});
 }
 assert(examples.length===VOICES.length*EXAMPLE_KINDS.length,'EXAMPLES_INCOMPLETE',examples.length);
 // The plan of an example does not depend on the voice.
 for(const kind of EXAMPLE_KINDS)assert(new Set(examples.filter(e=>e.kind===kind).map(e=>e.phones)).size===1,'PLAN_DEPENDS_ON_VOICE',kind);

 // Comparison voice inside the family, a second rate, then both interface languages at two widths.
 const pair=await page.evaluate(async text=>{const r=await window.tts.synthesize({family:'kale-en',lang:'en',voice:'kale-en-f02',text,speed:0.9,compare:{family:'kale-en',voice:'kale-en-m03'}});
  return {family:r.family,voice:r.voice,speed:r.speed,comparison:{family:r.comparison.family,voice:r.comparison.voice,speed:r.comparison.speed},samePlan:r.phones===r.comparison.phones,outputs:window.tts.status().outputs};},EXAMPLES.en.time);
 assert(pair.comparison.family==='kale-en'&&pair.comparison.voice==='kale-en-m03'&&pair.speed===0.9&&pair.comparison.speed===0.9&&pair.samePlan&&pair.outputs===8,'ENGLISH_COMPARISON',pair);
 const shots={};
 for(const locale of ['de','en'])for(const [name,width,height] of [['desktop',1280,900],['phone',390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(locale=>window.tts.setLocale(locale),locale);await page.waitForTimeout(250);
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,model:(()=>{const e=document.getElementById('model'),s=getComputedStyle(e),ctx=document.createElement('canvas').getContext('2d');ctx.font=s.font;
   return {label:e.selectedOptions[0].text,width:e.clientWidth,needed:ctx.measureText(e.selectedOptions[0].text).width+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)};})(),
   rows:[...document.querySelectorAll('#outputs-list>li')].map(row=>row.querySelector('.output-meta').textContent)}));
  assert(!layout.overflow&&layout.model.label==='Kale Nano EN'&&layout.model.needed<=layout.model.width,'LAYOUT',{locale,name,layout});
  assert(layout.rows.length===8&&layout.rows.every(meta=>meta.startsWith('Kale Nano EN · English · ')),'OUTPUT_ROWS',layout.rows);
  await page.screenshot({path:`${out}/${name}-${locale}.png`,fullPage:true});
  shots[name+'-'+locale]=layout;
 }
 assert(errors.length===0,'PAGE_ERRORS',errors);assert(external.length===0,'EXTERNAL_REQUEST',external);
 const seconds=examples.map(e=>e.seconds),rtf=examples.map(e=>e.rtf).sort((a,b)=>a-b);
 const result={families:P.families,voices:VOICES,ui,mapping,hyphens,examples,pair,shots,graphBytes:P.manifest.models['kale-en'].graphBytes,manifestBytes:P.manifest.totalBytes,
  summary:{syntheses:examples.length,audioSeconds:seconds.reduce((a,b)=>a+b,0),rtfMedian:rtf[Math.floor(rtf.length/2)],rtfMax:rtf.at(-1)},browser:await browser.version(),
  scope:'Real Chrome against the static preview, real browser CPU-WASM synthesis, one thread. Functional checks and measured timings on this machine; nobody listened, and nothing here judges pronunciation or how the voices sound. Phone width is viewport emulation.'};
 await writeFile(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log('PASS: English Kale family: literal model names, 8 voices labelled in both interface languages, '+examples.length+' example syntheses (5 examples x 8 voices), word boundaries in '+hyphens.length+' hyphenated texts, served id mapping, comparison voice, desktop and phone layout in DE and EN');
}finally{await browser.close();}
