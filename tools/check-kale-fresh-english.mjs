// Real Chrome check for the English fit of the German Kale family type with our own four English
// voices (kale-fresh-en). It is not the upstream English model: default English plans (no word break
// inside hyphenated words) and the German id mapping (toKale). A build without the family is skipped.
//
// Proves for the 200 held-out sentences of tests/fixtures/english-kale-held-out.jsonl (symbols,
// stress and token ids as the training code fed them) that the served frontend gives exactly the
// same: once with the served modules loaded in the page (ids and stress), once through the
// application itself (symbols and the number of tokens of every model call). Also: roster, labels
// and selectors in both interface languages at phone width, every English example with every voice,
// sentence split, speaking rate, the limits, and screenshots.
//
//   PREVIEW_URL=http://127.0.0.1:8895/ [PROOF_DIR=<dir>] bun tools/check-kale-fresh-english.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {EXAMPLES,EXAMPLE_KINDS} from '../web/examples.mjs';
import {previewProfile} from './preview-profile.mjs';

const FAMILY='kale-fresh-en';
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const P=await previewProfile(url);
if(!P.has(FAMILY)){console.log('SKIP: this build does not serve the English fit of German Kale ('+P.families.join(', ')+')');process.exit(0);}
const out=process.env.PROOF_DIR||'artifacts/kale-fresh-english-proof';await mkdir(out,{recursive:true});
const assert=(ok,code,detail)=>{if(!ok)throw Error(detail===undefined?code:code+':'+JSON.stringify(detail));};
const VOICES=P.voices(FAMILY,'en'),spec=P.manifest.models[FAMILY],german=P.manifest.models.kale;
// The fixture holds generated sentences that are not part of the public snapshot (publish.toml excludes it).
const fixtureFile=Bun.file(new URL('../tests/fixtures/english-kale-held-out.jsonl',import.meta.url));
if(!await fixtureFile.exists()){console.log('SKIP: tests/fixtures/english-kale-held-out.jsonl is not in this checkout (private working repository only)');process.exit(0);}
const fixture=(await fixtureFile.text()).trim().split('\n').map(line=>JSON.parse(line));
const NAMES=P.families.map(family=>family+'='+P.name(family)).join();

const browser=await chromium.launch({channel:'chrome',headless:true});
// Closing Chrome after the 200-sentence run once did not return inside just check-preview (the
// process idled after PASS until it was killed). The close is bounded: the outcome of the checks
// decides the exit status, a close that does not return in 20 s is reported on stderr, and the
// process exits explicitly; Playwright ends the browser it launched when the process exits.
let failure=null;
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 // A same-origin GET the static host redirects to its own file storage (the Space's CDN) is not a request of the page.
 const rootOf=request=>{let at=request;while(at.redirectedFrom())at=at.redirectedFrom();return at;};
 page.on('request',request=>{const own=r=>r.url().startsWith(new URL(url).origin+'/')||/^(data|blob):/.test(r.url());
  if(!own(request)&&!(request.redirectedFrom()&&request.method()==='GET'&&request.postData()===null&&own(rootOf(request))))external.push(request.url());});
 await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);

 // The family: four voices, English only, the vocabulary block of German Kale (same table and lists).
 assert(VOICES.join()==='fresh-en-f03,fresh-en-f14,fresh-en-m03,fresh-en-m08'&&spec.voices.length===4,'ROSTER',spec.voices);
 assert(spec.languages.join()==='en'&&spec.vocabulary.version==='phony-atomic-v1'&&spec.hop===600&&spec.maxFrames===1800,'FAMILY_SPEC',{languages:spec.languages,version:spec.vocabulary.version});
 const block=vocabulary=>JSON.stringify({...vocabulary,voices:null});
 assert(block(spec.vocabulary)===block(german.vocabulary),'VOCABULARY_DIFFERS_FROM_GERMAN_KALE');
 assert(fixture.length===200,'FIXTURE_SIZE',fixture.length);

 // 1. The served nrmlz, English bundle and Phony, loaded in the page, in the call order of the engine.
 const mapped=await page.evaluate(async({rows,family})=>{
  const manifest=await(await fetch('/manifest.json')).json(),bytes=async key=>new Uint8Array(await(await fetch(manifest.assets[key].url)).arrayBuffer());
  const phony=await import(manifest.assets['phony.module'].url),nrmlz=await import(manifest.assets['nrmlz.module'].url),{createEnglish}=await import(manifest.assets['app.english.js'].url);
  await phony.default({module_or_path:await bytes('phony.wasm')});await nrmlz.default({module_or_path:await bytes('nrmlz.wasm')});
  const english=await createEnglish({phonyModule:phony,metadataText:new TextDecoder().decode(await bytes('frontend.metadata')),weightsBytes:await bytes('frontend.weights'),englishDictionaryBytes:await bytes('frontend.en'),quickjsWasmBytes:await bytes('quickjs.wasm')});
  const vocabulary=JSON.stringify(manifest.models[family].vocabulary),different=[],chunkTokens={};let symbols=0,stress=0,ids=0,chunked=0,multi=0,longest=0,hyphenBreaks=0;
  try{for(const row of rows){
   const plan=english.phonemize(nrmlz.normalize('en',row.text)),whole=Array.from(phony.toKale(JSON.stringify(plan),vocabulary));
   // What the engine sends: one model call per sentence. Joined without the inner pads it is the fixture again.
   const chunks=JSON.parse(phony.sentencePlan(JSON.stringify(plan),128)).map(part=>Array.from(phony.toKale(JSON.stringify(part),vocabulary)));
   const joined=[0,...chunks.flatMap(part=>part.slice(1,-1)),0];
   const same={symbols:plan.symbols.join(' ')===row.symbols,stress:plan.stress.join('')===row.stress,ids:whole.join()===row.ids.join(),chunks:joined.join()===row.ids.join()};
   symbols+=same.symbols;stress+=same.stress;ids+=same.ids;chunked+=same.chunks;multi+=chunks.length>1;longest=Math.max(longest,...chunks.map(part=>part.length));
   // With the upstream family's option the same text would have a word break after a hyphen.
   if(row.text.includes('-')&&english.phonemize(nrmlz.normalize('en',row.text),{hyphenBoundaries:true}).symbols.join(' ')!==row.symbols)hyphenBreaks++;
   chunkTokens[row.id]=chunks.map(part=>part.length);
   if(!same.symbols||!same.stress||!same.ids||!same.chunks)different.push({id:row.id,text:row.text,same,symbols:plan.symbols.join(' ')});
  }}finally{english.dispose();}
  return {sentences:rows.length,symbols,stress,ids,chunked,multi,longest,hyphenBreaks,different,chunkTokens,hasUpstreamMapping:typeof phony.toKaleEnglish==='function'};
 },{rows:fixture,family:FAMILY});
 assert(mapped.sentences===200&&mapped.symbols===200&&mapped.stress===200&&mapped.ids===200&&mapped.chunked===200&&mapped.longest<=512,'FIXTURE_NOT_REPRODUCED',{...mapped,chunkTokens:undefined,different:mapped.different.slice(0,3)});

 // 2. The application itself: every fixture sentence, the four voices in turn. The result has the
 // plan symbols and the planned durations of every model call, one duration per token id.
 const spoken=await page.evaluate(async({rows,voices,family})=>{
  const results=[];
  for(const [index,row] of rows.entries()){
   await window.tts.synthesize({family,lang:'en',voice:voices[index%voices.length],text:row.text});const r=window.__lastTtsResult;
   results.push({id:row.id,normalized:r.normalized,phones:r.phones,tokens:r.timing.planned.map(list=>list.length),untimed:r.timing.planned.flat().filter(frames=>frames===0).length,
    frames:r.timing.planned.flat().reduce((a,b)=>a+b,0),samples:r.audio.length,finite:r.audio.every(Number.isFinite),rtf:r.metrics.run.synthesisRtf});
  }
  window.tts.clearOutputs();return results;
 },{rows:fixture,voices:VOICES,family:FAMILY});
 const engineDifferent=spoken.filter((result,index)=>result.phones!==fixture[index].symbols||result.tokens.join()!==mapped.chunkTokens[result.id].join()||result.samples!==result.frames*600||!result.finite);
 assert(spoken.length===200&&engineDifferent.length===0,'ENGINE_PLAN_DIFFERS_FROM_FIXTURE',engineDifferent.slice(0,3));
 // German family type: a stress mark is a token without time, so a stressed sentence has untimed tokens.
 assert(spoken.every((result,index)=>result.untimed>=(fixture[index].stress.match(/[12]/g)||[]).length),'STRESS_MARK_TIMED',spoken.find((result,index)=>result.untimed<(fixture[index].stress.match(/[12]/g)||[]).length));

 const synth=input=>page.evaluate(async input=>{
  const summary=await window.tts.synthesize(input),r=window.__lastTtsResult,planned=r.timing.planned;
  return {voice:input.voice,samples:r.audio.length,finite:r.audio.every(Number.isFinite),normalized:r.normalized,phones:r.phones,chunks:r.chunks,speed:summary.speed,
   tokens:planned.map(list=>list.length),frames:planned.flat().reduce((a,b)=>a+b,0),rendered:r.timing.rendered.flat().reduce((a,b)=>a+b,0),hop:r.timing.hop,
   synthesisMs:r.metrics.run.stages.synthesis.ms,rtf:r.metrics.run.synthesisRtf,title:document.getElementById('audio-title').textContent,detail:document.getElementById('audio-detail').textContent};
 },{family:FAMILY,lang:'en',...input});

 // 3. Hyphenated words stay one word (training convention of this family), unlike the upstream family.
 const hyphen=await synth({voice:'fresh-en-f03',text:'Exactly twenty-nine turkeys crossed the road this morning.'});
 assert(hyphen.phones.includes('t w ɛ n t i n aɪ n')&&!hyphen.phones.includes('t w ɛ n t i <sp> n aɪ n'),'HYPHEN_WORD_BREAK',hyphen.phones);

 // 4. Every English example with every voice.
 await page.evaluate(()=>window.tts.setLocale('de'));
 const examples=[];
 for(const voice of VOICES)for(const kind of EXAMPLE_KINDS){
  const text=EXAMPLES.en[kind],result=await synth({voice,text});
  assert(result.samples>12000&&result.finite&&result.phones.startsWith('<bos>')&&result.speed===1&&result.samples===result.frames*result.hop,'EXAMPLE_NOT_SYNTHESIZED',{voice,kind,samples:result.samples});
  if(['plain','question'].includes(kind))assert(result.normalized===text,'EXAMPLE_PLAIN_TEXT_REWRITTEN',{kind,normalized:result.normalized});
  else assert(result.normalized!==text&&!/\d|[€$]/.test(result.normalized),'EXAMPLE_NOT_READ_OUT',{kind,normalized:result.normalized});
  assert(result.title===P.voiceText(voice,'de')+' · English'&&result.detail.startsWith('Kale Nano EN · 1.00× · '),'EXAMPLE_LISTENING_COPY',{title:result.title,detail:result.detail});
  examples.push({voice,kind,text,normalized:result.normalized,phones:result.phones,chunks:result.chunks,seconds:result.samples/24000,synthesisMs:result.synthesisMs,rtf:result.rtf});
 }
 for(const kind of EXAMPLE_KINDS)assert(new Set(examples.filter(e=>e.kind===kind).map(e=>e.phones)).size===1,'PLAN_DEPENDS_ON_VOICE',kind);

 // 5. Sentence split, limits and speaking rate as for the other Kale families.
 const split=await synth({voice:'fresh-en-m03',text:'Wait... Really?! Yes.'});
 assert(split.chunks===3&&split.tokens.length===3,'SENTENCE_SPLIT',split);
 const refuse=async input=>page.evaluate(async input=>{const before=window.tts.status().outputs;
  try{await window.tts.synthesize(input);return {rejected:false};}catch(error){return {rejected:true,message:error.message,status:window.tts.status().message,busy:window.tts.status().busy,added:window.tts.status().outputs-before};}},{family:FAMILY,lang:'en',voice:'fresh-en-f03',...input});
 const limits={
  characters:await refuse({text:'a'.repeat(501)}),
  // More than 512 plan tokens in 479 characters (1,439 after normalization): the bound of the English frontend.
  tokens:await refuse({text:'19 '.repeat(160).trim()}),
  germanVoice:await refuse({voice:'fresh-de-f01',text:'Good morning.'}),
 };
 assert(Object.values(limits).every(item=>item.rejected&&!item.busy&&item.added===0),'LIMIT_NOT_ENFORCED',limits);
 assert(/ENGLISH_TOKEN_BOUND/.test(limits.tokens.message)&&limits.germanVoice.message==='Ungültige Modell-/Sprachauswahl.'&&limits.characters.message==='Bitte 1 bis 500 Zeichen eingeben.','LIMIT_MESSAGES',limits);

 // A valid synthesis at the default rate comes last, so the screenshots show no error state.
 const rate={};
 for(const speed of [0.75,1.5,1]){rate[speed]=await synth({voice:'fresh-en-f14',text:EXAMPLES.en.plain,speed});assert(rate[speed].speed===speed&&rate[speed].samples===rate[speed].rendered*600,'RATE_SAMPLES',rate[speed]);}
 assert(rate[0.75].frames===rate[1].frames&&rate[1.5].frames===rate[1].frames&&rate[1].rendered===rate[1].frames&&rate[0.75].samples>rate[1].samples&&rate[1.5].samples<rate[1].samples,'RATE_RULE',{planned:[rate[1].frames,rate[0.75].frames,rate[1.5].frames],samples:[rate[1].samples,rate[0.75].samples,rate[1.5].samples]});
 // 6. Selectors at phone width, both interface languages: interface language switch, model select,
 // speech-language select and voice list of every served family, each with a screenshot.
 const read=()=>page.evaluate(()=>{const $=id=>document.getElementById(id);return {
  locale:[...document.querySelectorAll('[data-locale]')].map(b=>b.dataset.locale+':'+b.getAttribute('aria-pressed')),
  models:[...$('model').options].map(o=>o.value+'='+o.text),model:$('model').value,language:$('language').value,
  languages:[...$('language').options].map(o=>o.value+'='+o.text+(o.disabled?' (disabled)':'')),
  voices:[...$('voice').options].map(o=>o.value+'='+o.text),info:$('voice-info').textContent,size:$('model-size').textContent,
  method:$('method-models').textContent,links:[...document.querySelectorAll('.source-links a')].filter(a=>!a.hidden).map(a=>a.textContent+' '+a.href),
  compare:[...$('compare').children].map(node=>node.tagName==='OPTGROUP'?node.label+':'+node.children.length:node.text),
  overflow:document.documentElement.scrollWidth>innerWidth,
  fit:['model','language','voice'].map(id=>{const e=$(id),s=getComputedStyle(e),ctx=document.createElement('canvas').getContext('2d');ctx.font=s.font;
   return {id,label:e.selectedOptions[0].text,width:e.clientWidth,needed:ctx.measureText(e.selectedOptions[0].text).width+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)};})};});
 const WORDS={de:{de:'Deutsch',en:'English',count:{de:n=>n+' deutsche Stimmen',en:n=>n+' englische Stimmen'},none:'Keine'},en:{de:'German',en:'English',count:{de:n=>n+' German voices',en:n=>n+' English voices'},none:'None'}};
 // The two qualified configurations with this family: the Kale pair, and Voca64 with both Kale families.
 const METHOD={'kale+kale-fresh-en':{de:'Kale Nano DE bietet vier deutsche Stimmen, Kale Nano EN vier englische Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',en:'Kale Nano DE provides four German voices, Kale Nano EN four English voices. Each voice belongs to exactly one model.'},
  'kale+kale-fresh-en+voca64':{de:'Kale Nano DE bietet vier deutsche Stimmen, Kale Nano EN vier englische Stimmen; Voca64 bietet deutsche und englische Stimmen. Jede Stimme ist genau einem Modell zugeordnet.',en:'Kale Nano DE provides four German voices, Kale Nano EN four English voices; Voca64 provides German and English voices. Each voice belongs to exactly one model.'}}[P.families.join('+')];
 assert(METHOD,'UNQUALIFIED_CONFIGURATION',P.families);
 await page.setViewportSize({width:390,height:844});
 const ui={};
 for(const locale of ['de','en'])for(const family of P.families)for(const lang of P.manifest.models[family].languages){
  await page.evaluate(({locale,family,lang})=>{window.tts.setLocale(locale);const change=(id,value)=>{const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change'));};change('model',family);change('language',lang);},{locale,family,lang});
  await page.waitForTimeout(150);
  const view=await read(),W=WORDS[locale],name=locale+'-'+family+'-'+lang,spoken=P.manifest.models[family].languages,list=P.voices(family,lang);
  assert(view.locale.join()===(locale==='de'?'de:true,en:false':'de:false,en:true'),'INTERFACE_LANGUAGE_SWITCH',{name,locale:view.locale});
  assert(view.models.join()===NAMES&&view.model===family,'MODEL_SELECT',{name,models:view.models});
  assert(view.languages.join()===['de','en'].map(code=>code+'='+W[code]+(spoken.includes(code)?'':' (disabled)')).join()&&view.language===lang,'SPEECH_LANGUAGE_SELECT',{name,languages:view.languages});
  assert(view.voices.join()===list.map(voice=>voice+'='+P.voiceText(voice,locale)+' · '+W[lang]).join()&&view.info===W.count[lang](list.length),'VOICE_LIST',{name,voices:view.voices,info:view.info});
  assert(view.size===P.graphSize(family)&&view.method===METHOD[locale],'MODEL_PANEL',{name,size:view.size,method:view.method});
  assert(view.compare.join()===[W.none,...P.speaking(lang).map(other=>P.name(other)+':'+(P.voices(other,lang).length-(other===family?1:0)))].join(),'COMPARISON_VOICES',{name,compare:view.compare});
  assert(view.links.length===P.families.length+1&&view.links.some(link=>link.endsWith('/Fraunhofer-IEM/kale-nano-en'))&&view.links.some(link=>link.endsWith('/Fraunhofer-IEM/kale-nano-de'))&&!view.links.some(link=>/KaleComputer/.test(link)),'MODEL_LINKS',view.links);
  assert(!view.overflow&&view.fit.every(item=>item.needed<=item.width),'PHONE_LAYOUT',{name,fit:view.fit,overflow:view.overflow});
  await page.screenshot({path:`${out}/phone-${name}.png`,fullPage:true});
  ui[name]=view;
 }
 // The four voices carry the numbers of their ids, in both interface languages.
 assert(ui['de-'+FAMILY+'-en'].voices.join()==='fresh-en-f03=Weibliche Stimme 03 · English,fresh-en-f14=Weibliche Stimme 14 · English,fresh-en-m03=Männliche Stimme 03 · English,fresh-en-m08=Männliche Stimme 08 · English','VOICE_LABELS_DE',ui['de-'+FAMILY+'-en'].voices);
 assert(ui['en-'+FAMILY+'-en'].voices.join()==='fresh-en-f03=Female voice 03 · English,fresh-en-f14=Female voice 14 · English,fresh-en-m03=Male voice 03 · English,fresh-en-m08=Male voice 08 · English','VOICE_LABELS_EN',ui['en-'+FAMILY+'-en'].voices);
 // Desktop width with outputs of this family in the list.
 await page.setViewportSize({width:1280,height:900});
 for(const locale of ['de','en']){
  await page.evaluate(({locale,family})=>{window.tts.setLocale(locale);const m=document.getElementById('model');m.value=family;m.dispatchEvent(new Event('change'));},{locale,family:FAMILY});await page.waitForTimeout(150);
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'DESKTOP_OVERFLOW',locale);
  await page.screenshot({path:`${out}/desktop-${locale}.png`,fullPage:true});
 }
 await page.evaluate(()=>window.tts.setLocale('de'));
 assert(errors.length===0,'PAGE_ERRORS',errors);assert(external.length===0,'EXTERNAL_REQUEST',external);

 const rtf=[...spoken.map(result=>result.rtf)].sort((a,b)=>a-b),seconds=spoken.reduce((sum,result)=>sum+result.samples/24000,0);
 const result={families:P.families,voices:VOICES,
  fixture:{file:'tests/fixtures/english-kale-held-out.jsonl',sentences:mapped.sentences,symbolsIdentical:mapped.symbols,stressIdentical:mapped.stress,idsIdentical:mapped.ids,idsOfModelCallsIdentical:mapped.chunked,
   sentencesWithSeveralModelCalls:mapped.multi,longestModelCallTokens:mapped.longest,hyphenatedSentencesThatWouldDifferWithWordBreaks:mapped.hyphenBreaks,servedPhonyHasUpstreamMapping:mapped.hasUpstreamMapping,
   throughApplication:{sentences:spoken.length,symbolsAndTokenCountsIdentical:spoken.length-engineDifferent.length,audioSeconds:seconds,rtfMedian:rtf[Math.floor(rtf.length/2)],rtfMax:rtf.at(-1)}},
  hyphen:{text:'Exactly twenty-nine turkeys crossed the road this morning.',phones:hyphen.phones},examples,split:{chunks:split.chunks,tokens:split.tokens},
  rate:Object.fromEntries(Object.entries(rate).map(([speed,r])=>[speed,{plannedFrames:r.frames,renderedFrames:r.rendered,samples:r.samples}])),limits,ui,
  graphBytes:spec.graphBytes,manifestBytes:P.manifest.totalBytes,browser:await browser.version(),
  scope:'Real Chrome against the static preview, real browser CPU-WASM synthesis, one thread. Token ids, plans, labels and timings are compared by software; nobody listened, and nothing here judges pronunciation or how the voices sound. Phone width is viewport emulation.'};
 await writeFile(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log('PASS: English fit of German Kale: '+mapped.ids+' of '+mapped.sentences+' held-out sentences with the symbols, stress and token ids of the training fixture (served frontend), '+(spoken.length-engineDifferent.length)+' of '+spoken.length+' through the application; '+VOICES.length+' voices labelled in both interface languages, '+examples.length+' example syntheses, hyphenated words unbroken, sentence split, speaking rate, limits, selectors at phone width for '+P.families.join(', '));
}catch(error){failure=error;}
finally{
 const closed=await Promise.race([browser.close().then(()=>true,()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),20000))]);
 if(!closed)console.error('WARNING: Chrome did not close within 20 s; exiting with the result of the checks.');
}
if(failure){console.error(failure);process.exit(1);}
process.exit(0);
