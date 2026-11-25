// Real Chrome check for the speaking rate: the default rate is bit-identical to
// an unscaled run, slower and faster rates change the sample count in the
// expected direction for both model families, silent tokens stay silent, the
// measurements use the actual audio length and capacity limits fail with a
// localized error instead of truncating.
//
//   PREVIEW_URL=http://127.0.0.1:8894/ bun tools/check-speaking-rate.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {previewProfile} from './preview-profile.mjs';

const out=process.env.PROOF_DIR||'artifacts/speaking-rate-proof';await mkdir(out,{recursive:true});
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const assert=(ok,code,detail)=>{if(!ok)throw Error(detail===undefined?code:code+':'+JSON.stringify(detail));};
const P=await previewProfile(url);
// Every served family in each of its speech languages.
const cases=[
 {family:'kale',lang:'de',voice:'fresh-de-f01',text:'Das Fenster ist offen, und der Wind ist kühl. Schließen wir es?'},
 ...(P.has('voca64')?[{family:'voca64',lang:'de',voice:'fresh-de-f05',text:'Das Fenster ist offen, und der Wind ist kühl. Schließen wir es?'}]:[]),
 ...P.englishEach.map(english=>({...english,lang:'en',text:'The window is open, and the wind is cool. Shall we close it?'})),
];
// Long enough that 0.75 passes one minute while the default rate does not. The English frontend
// takes at most 512 symbols, so the English Kale fixture is many short sentences.
const capacity=[
 {family:'kale',lang:'de',voice:'fresh-de-f01',text:'Die Nummer lautet 987654321. '.repeat(12).trim()},
 ...(P.has('voca64')?[{family:'voca64',lang:'de',voice:'fresh-de-f05',text:'Die Nummer lautet 987654321. '.repeat(16).trim()}]:[]),
 ...(P.has('kale-en')?[{family:'kale-en',lang:'en',voice:'kale-en-f01',text:'Yes, we can. '.repeat(30).trim()}]:[]),
 // The English fit of German Kale speaks faster; sixty one-word sentences stay inside 500 characters.
 ...(P.has('kale-fresh-en')?[{family:'kale-fresh-en',lang:'en',voice:'fresh-en-f03',text:'9. '.repeat(60).trim()}]:[]),
];
const expected=(frames,hundredths)=>frames===0?0:Math.max(1,Number((200n*BigInt(frames)+BigInt(hundredths))/(2n*BigInt(hundredths))));

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
 // Runs one synthesis and keeps the raw floats in the page for bitwise comparison.
 const run=(input,slot)=>page.evaluate(async({input,slot})=>{
  const summary=await window.tts.synthesize(input),r=window.__lastTtsResult;
  (window.__rateAudio??={})[slot]=new Uint32Array(r.audio.buffer.slice(r.audio.byteOffset,r.audio.byteOffset+r.audio.byteLength));
  return {samples:r.audio.length,speed:r.speed,summarySpeed:summary.speed,normalized:r.normalized,phones:r.phones,chunks:r.chunks,timing:r.timing,
   run:{speakingRate:r.metrics.run.speakingRate,audioSeconds:r.metrics.run.audioSeconds,synthesisMs:r.metrics.run.stages.synthesis.ms,synthesisRtf:r.metrics.run.synthesisRtf},
   shown:{value:document.getElementById('rate').value,text:document.getElementById('rate-value').textContent,aria:document.getElementById('rate').getAttribute('aria-valuetext')}};
 },{input,slot});
 const same=(a,b)=>page.evaluate(({a,b})=>{const x=window.__rateAudio[a],y=window.__rateAudio[b];return x.length===y.length&&x.every((value,index)=>value===y[index]);},{a,b});
 const frames=list=>list.flat().reduce((sum,value)=>sum+value,0);

 const results=[];
 for(const input of cases){
  const name=input.family+'/'+input.lang;
  if(!P.manifest.models[input.family].voices.includes(input.voice))throw Error('RATE_FIXTURE_VOICE:'+name);
  const base=await run(input,'base');                       // no speed argument: today's path
  const one=await run({...input,speed:1},'one');
  assert(base.speed===1&&one.speed===1&&one.summarySpeed===1,'RATE_DEFAULT_NOT_RECORDED',{name,base:base.speed,one:one.speed});
  assert(await same('base','one'),'RATE_ONE_NOT_IDENTICAL',name);
  assert(JSON.stringify(one.timing.planned)===JSON.stringify(one.timing.rendered),'RATE_ONE_CHANGED_DURATIONS',name);
  // The English Kale model times every token; the other models leave some tokens silent.
  if(P.everyTokenTimed(input.family))assert(!base.timing.planned.flat().includes(0),'RATE_ENGLISH_KALE_UNTIMED_TOKEN',name);
  else assert(base.timing.planned.flat().includes(0),'RATE_FIXTURE_HAS_NO_SILENT_TOKEN',name);
  assert(base.samples===frames(base.timing.rendered)*base.timing.hop,'RATE_SAMPLES_MISMATCH',{name,rate:1});
  const row={input,base:{samples:base.samples,frames:frames(base.timing.planned),silentTokens:base.timing.planned.flat().filter(value=>value===0).length},rates:{}};
  for(const speed of [0.75,1.5]){
   const scaled=await run({...input,speed},'scaled'),hundredths=Math.round(speed*100);
   assert(scaled.speed===speed&&scaled.run.speakingRate===speed,'RATE_NOT_RECORDED',{name,speed,got:scaled.speed,run:scaled.run.speakingRate});
   assert(scaled.normalized===base.normalized&&scaled.phones===base.phones&&scaled.chunks===base.chunks,'RATE_CHANGED_TEXT',{name,speed});
   assert(JSON.stringify(scaled.timing.planned)===JSON.stringify(base.timing.planned),'RATE_CHANGED_PLANNER',{name,speed});
   const planned=scaled.timing.planned.flat(),rendered=scaled.timing.rendered.flat();
   assert(planned.length===rendered.length,'RATE_TOKEN_COUNT_CHANGED',{name,speed});
   planned.forEach((value,index)=>{
    if(value===0)assert(rendered[index]===0,'RATE_ZERO_FRAME_SPOKEN',{name,speed,index,rendered:rendered[index]});
    else assert(rendered[index]>=1,'RATE_SPOKEN_TOKEN_DROPPED',{name,speed,index});
    assert(rendered[index]===expected(value,hundredths),'RATE_RULE_VIOLATED',{name,speed,index,planned:value,rendered:rendered[index]});
   });
   assert(scaled.samples===frames(scaled.timing.rendered)*scaled.timing.hop,'RATE_SAMPLES_MISMATCH',{name,speed,samples:scaled.samples});
   if(speed<1)assert(scaled.samples>base.samples,'RATE_SLOW_NOT_LONGER',{name,base:base.samples,scaled:scaled.samples});
   else assert(scaled.samples<base.samples,'RATE_FAST_NOT_SHORTER',{name,base:base.samples,scaled:scaled.samples});
   // Real-time factor is measured against the samples that were produced.
   assert(scaled.run.audioSeconds===scaled.samples/24000,'RATE_RTF_NOT_ACTUAL_LENGTH',{name,speed,audioSeconds:scaled.run.audioSeconds,samples:scaled.samples});
   assert(Math.abs(scaled.run.synthesisRtf-scaled.run.synthesisMs/1000/(scaled.samples/24000))<1e-12,'RATE_RTF_NOT_ACTUAL_LENGTH',{name,speed,rtf:scaled.run.synthesisRtf});
   assert(scaled.shown.value===String(speed)&&scaled.shown.text===speed.toFixed(2)+'×'&&scaled.shown.aria===scaled.shown.text,'RATE_CONTROL_NOT_UPDATED',{name,speed,shown:scaled.shown});
   row.rates[speed]={samples:scaled.samples,frames:frames(scaled.timing.rendered),ratio:scaled.samples/base.samples};
  }
  const again=await run({...input,speed:1},'again');
  assert(await same('base','again'),'RATE_STATE_LEAKED',name);
  results.push(row);
 }

 // The control itself: a labelled range input that the keyboard can drive.
 const control=await page.evaluate(()=>{const e=document.getElementById('rate');return {type:e.type,min:e.min,max:e.max,step:e.step,label:e.labels[0]?.textContent};});
 assert(control.type==='range'&&control.min==='0.75'&&control.max==='1.5'&&control.step==='0.05'&&control.label==='Sprechtempo','RATE_CONTROL_SHAPE',control);
 await page.focus('#rate');
 const keys=[];
 for(const key of ['ArrowRight','ArrowRight','Home','End','ArrowLeft']){
  await page.keyboard.press(key);
  keys.push(await page.evaluate(()=>document.getElementById('rate').value+'|'+document.getElementById('rate-value').textContent));
 }
 assert(keys.join()==='1.05|1.05×,1.1|1.10×,0.75|0.75×,1.5|1.50×,1.45|1.45×','RATE_KEYBOARD',keys);
 await page.locator('#rate').fill('0.85');
 await page.fill('#text','Das Fenster ist offen.');
 await page.click('#generate');
 await page.waitForFunction(()=>!window.tts.status().busy&&window.tts.status().outputs>0&&window.__lastTtsResult?.speed===0.85,{timeout:60000});
 const ui=await page.evaluate(()=>({speed:window.__lastTtsResult.speed,newest:window.tts.outputs()[0],detail:document.getElementById('audio-detail').textContent,exported:window.tts.metrics().run.speakingRate}));
 assert(ui.speed===0.85&&ui.newest.speed===0.85&&ui.detail.includes('0.85×')&&ui.exported===0.85,'RATE_UI_PATH',ui);

 // Values outside the grid are rejected before anything runs.
 const before=await page.evaluate(()=>({outputs:window.tts.status().outputs,rate:document.getElementById('rate').value}));
 const invalid=[];
 for(const speed of [2,0.5,1.33,'1',NaN]){
  invalid.push(await page.evaluate(async speed=>{
   try{await window.tts.synthesize({text:'Ein Test.',speed});return {speed:String(speed),accepted:true};}
   catch(error){return {speed:String(speed),accepted:false,message:error.message,status:window.tts.status().message,error:document.getElementById('status').classList.contains('error'),busy:window.tts.status().busy};}
  },speed));
 }
 assert(invalid.every(item=>!item.accepted&&item.message==='Ungültiges Sprechtempo.'&&item.status==='Das Sprechtempo liegt außerhalb des zulässigen Bereichs.'&&item.error&&!item.busy),'RATE_INVALID_ACCEPTED',invalid);
 const after=await page.evaluate(()=>({outputs:window.tts.status().outputs,rate:document.getElementById('rate').value}));
 assert(JSON.stringify(before)===JSON.stringify(after),'RATE_INVALID_CHANGED_STATE',{before,after});

 // Capacity: one minute of audio is the limit. The default rate fits, 0.75 does
 // not, and the failure adds no shortened output.
 const limits=[];
 for(const input of capacity){
  const fits=await page.evaluate(async input=>{const r=await window.tts.synthesize({...input,speed:1});return {seconds:r.samples/r.sampleRate,outputs:window.tts.status().outputs,newest:window.tts.outputs()[0].id};},input);
  assert(fits.seconds>45.5&&fits.seconds<59,'CAPACITY_FIXTURE_NOT_NEAR_LIMIT',{family:input.family,seconds:fits.seconds});
  const slow=await page.evaluate(async input=>{
   try{await window.tts.synthesize({...input,speed:0.75});return {rejected:false};}
   catch(error){
    const de=window.tts.status().message,isError=document.getElementById('status').classList.contains('error');
    window.tts.setLocale('en');const en=window.tts.status().message;window.tts.setLocale('de');
    return {rejected:true,message:error.message,de,en,isError,busy:window.tts.status().busy,outputs:window.tts.status().outputs,newest:window.tts.outputs()[0].id,selected:window.tts.status().selected,
     shownRun:window.tts.metrics().run.id,loadState:document.getElementById('model-loading').dataset.state};
   }
  },input);
  assert(slow.rejected,'CAPACITY_NOT_REJECTED',input.family);
  assert(slow.message==='Bei diesem Sprechtempo wird das Audio länger als eine Minute.','CAPACITY_WRONG_ERROR',slow);
  assert(slow.isError&&slow.de.startsWith('Bei diesem Sprechtempo wird das Audio länger als eine Minute.')&&slow.en.startsWith('At this speaking rate the audio would be longer than one minute.'),'CAPACITY_ERROR_NOT_LOCALIZED',slow);
  assert(!slow.busy&&slow.outputs===fits.outputs&&slow.newest===fits.newest&&slow.selected===fits.newest,'CAPACITY_ADDED_TRUNCATED_OUTPUT',{fits,slow});
  assert(slow.loadState!=='error','CAPACITY_REPORTED_AS_LOADING_FAILURE',slow);
  const recovered=await page.evaluate(async input=>{const r=await window.tts.synthesize({...input,speed:1.25});return {seconds:r.samples/r.sampleRate,error:document.getElementById('status').classList.contains('error')};},input);
  assert(recovered.seconds<fits.seconds&&!recovered.error,'CAPACITY_NO_RECOVERY',recovered);
  limits.push({family:input.family,characters:input.text.length,defaultSeconds:fits.seconds,slow:{message:slow.message,de:slow.de,en:slow.en},fasterSeconds:recovered.seconds});
 }

 assert(errors.length===0,'PAGE_ERRORS',errors);
 await writeFile(out+'/RESULT.json',JSON.stringify({families:P.families,results,keys,ui,invalid,limits,browser:await browser.version(),
  scope:'Real Chrome, real browser CPU-WASM synthesis. Sample counts and frame rules are measured; how the rates sound is not judged here. The per-segment frame limit cannot be reached with 128-phone segments and is covered by the same check order in the engine, not by a browser fixture.'},null,2)+'\n');
 console.log('PASS: speaking rate 1.0 bit-identical, 0.75 longer and 1.5 shorter in '+cases.map(c=>c.family+'/'+c.lang).join(', ')+', silent tokens kept, RTF on actual length, keyboard control, invalid rates and one-minute capacity rejected without truncation');
}finally{await browser.close();}
