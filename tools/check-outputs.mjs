// Real Chrome check for the outputs list, the comparison voice, the reading
// display, the example texts, Ctrl/Cmd+Enter, locale switching with all of
// that state, and the promise that entered text is neither stored nor sent.
//
//   PREVIEW_URL=http://127.0.0.1:8894/ bun tools/check-outputs.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {EXAMPLES,EXAMPLE_KINDS} from '../web/examples.mjs';
import {previewProfile} from './preview-profile.mjs';

const out=process.env.PROOF_DIR||'artifacts/outputs-proof';await mkdir(out,{recursive:true});
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const origin=new URL(url).origin;
const assert=(ok,code,detail)=>{if(!ok)throw Error(detail===undefined?code:code+':'+JSON.stringify(detail));};
const LIMIT=8;
// A word that occurs nowhere in the application, to trace entered text.
const MARKER='Quittenbaum';
const MARKED='Der Quittenbaum trägt 17 Früchte.';
const LONG='Der Quittenbaum steht im Garten hinter dem Haus. '.repeat(8).trim();
// The models of this build: German Kale with Voca64 (published), German Kale with an English
// Kale family, or Voca64 with German Kale and our English Kale.
const P=await previewProfile(url);
const DE={family:'kale',lang:'de',voice:'fresh-de-f01'};
// A second German voice for the rows and one as the comparison voice: Voca64 voices where Voca64
// is served, otherwise other voices of German Kale.
const OTHER=P.germanOther,COMPARE=P.germanCompare;
const VOICES={kale:{de:'fresh-de-f01'},voca64:{de:'fresh-de-f05',en:'fresh-en-f03'},'kale-en':{en:'kale-en-f01'},'kale-fresh-en':{en:'fresh-en-f03'}};
const KALE=P.name('kale'),OTHER_NAME=P.name(OTHER.family),COMPARE_NAME=P.name(COMPARE.family),COMPARE_VALUE=COMPARE.family+':'+COMPARE.voice;
const de=voice=>P.voiceText(voice,'de'),en=voice=>P.voiceText(voice,'en');

const requests=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const open=async(viewport={width:1280,height:900})=>{
 const context=await browser.newContext({viewport});
 context.on('request',request=>requests.push({url:request.url(),method:request.method(),body:request.postData(),redirectedFrom:request.redirectedFrom()?.url()??null}));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
 return {context,page,errors};
};
// Everything a locale switch must leave alone.
const snapshot=page=>page.evaluate(()=>{
 const $=id=>document.getElementById(id),audio=$('audio');
 return {draft:$('text').value,model:$('model').value,language:$('language').value,voice:$('voice').value,compare:$('compare').value,rate:$('rate').value,
  outputs:window.tts.outputs().map(o=>[o.id,o.family,o.voice,o.lang,o.speed,o.samples,o.comparison,o.excerpt,o.normalized,o.phones].join('|')),
  selected:window.tts.status().selected,audioSrc:audio.getAttribute('src'),metrics:JSON.stringify(window.tts.metrics()),
  reading:$('reading-text').textContent,phones:$('reading-phones').textContent,busy:window.tts.status().busy};
});
const rows=page=>page.evaluate(()=>[...document.querySelectorAll('#outputs-list>li')].map(row=>{
 const [play,select,link]=row.children,[voice,meta,text]=select.children,box=row.getBoundingClientRect(),button=play.getBoundingClientRect();
 return {id:row.dataset.output,selected:row.dataset.selected==='true',current:select.getAttribute('aria-current'),voice:voice.textContent,meta:meta.textContent,text:text.textContent,textLang:text.lang,
  playLabel:play.getAttribute('aria-label'),download:link.download,downloadLabel:link.getAttribute('aria-label'),href:link.href,right:box.right,playSize:[button.width,button.height]};
}));
const listening=page=>page.evaluate(()=>{
 const $=id=>document.getElementById(id),audio=$('audio');
 return {title:$('audio-title').textContent,detail:$('audio-detail').textContent,time:$('audio-time').textContent,src:audio.getAttribute('src'),paused:audio.paused,
  playDisabled:$('play').disabled,downloadHref:$('download').getAttribute('href'),downloadDisabled:$('download').getAttribute('aria-disabled'),waveEmptyHidden:$('wave-empty').hidden,
  readingHidden:$('reading').hidden,readingLabel:$('reading-label').textContent,reading:$('reading-text').textContent,readingLang:$('reading-text').lang,
  phones:$('reading-phones').textContent,phonesOpen:$('reading').querySelector('details').open,phonesSummary:$('reading').querySelector('summary').textContent,
  status:window.tts.status().message,runId:window.tts.metrics()?.run?.id??null,count:$('outputs-count').textContent,emptyHidden:$('outputs-empty').hidden,
  empty:$('outputs-empty').textContent,listHidden:$('outputs-list').hidden,clearDisabled:$('outputs-clear').disabled};
});
const idle=(page,outputs)=>page.waitForFunction(count=>!window.tts.status().busy&&window.tts.status().outputs===count,outputs,{timeout:120000});
const synth=(page,input)=>page.evaluate(async input=>{const r=await window.tts.synthesize(input);return {...r,metrics:undefined,runId:r.metrics.run.id,comparison:r.comparison?{...r.comparison,metrics:undefined,runId:r.comparison.metrics.run.id}:undefined};},input);

const result={};
try{
 // ------------------------------------------------------------ first page
 const {page,errors}=await open();
 const start=await listening(page);
 assert(start.emptyHidden===false&&start.listHidden&&start.count==='0 / 8'&&start.clearDisabled&&start.readingHidden&&start.playDisabled,'OUTPUTS_EMPTY_STATE',start);
 assert(start.empty==='Noch keine Ausgaben. Die letzten 8 Ausgaben dieser Sitzung erscheinen hier.','OUTPUTS_EMPTY_COPY',start.empty);
 const controls=await page.evaluate(()=>({compare:document.getElementById('compare').value,compareText:document.getElementById('compare').selectedOptions[0].text,compareInfo:document.getElementById('compare-info').textContent,rate:document.getElementById('rate').value,
  examples:[...document.querySelectorAll('[data-example]')].map(b=>b.dataset.example+'='+b.textContent),oldButtons:Boolean(document.getElementById('example-de')||document.getElementById('example-en')),
  examplesGroup:document.querySelector('.examples').getAttribute('role')+'|'+document.getElementById(document.querySelector('.examples').getAttribute('aria-labelledby')).textContent}));
 assert(controls.compare===''&&controls.compareText==='Keine'&&controls.compareInfo==='optional'&&controls.rate==='1','DEFAULT_CONTROLS',controls);
 assert(controls.examples.join()==='plain=Aussage,question=Frage,time=Datum und Uhrzeit,amount=Betrag,abbreviation=Abkürzung'&&!controls.oldButtons&&controls.examplesGroup==='group|Beispieltexte','EXAMPLE_BUTTONS',controls);

 // Every example of both speech languages goes through the real frontend and
 // every model family that speaks the language.
 const examples=[];
 for(const lang of ['de','en']){
  await page.selectOption('#model',P.speaking(lang).at(-1));await page.selectOption('#language',lang);
  for(const kind of EXAMPLE_KINDS){
   await page.fill('#text','');
   await page.click(`[data-example=${kind}]`);
   const draft=await page.inputValue('#text');
   assert(draft===EXAMPLES[lang][kind],'EXAMPLE_TEXT_NOT_APPLIED',{lang,kind,draft});
   assert(await page.inputValue('#language')===lang&&await page.textContent('#char-count')===draft.length+' / 500','EXAMPLE_CHANGED_SELECTION',{lang,kind});
   for(const family of P.speaking(lang)){
    const spoken=await synth(page,{family,lang,voice:VOICES[family][lang]});
    assert(spoken.samples>12000&&spoken.normalized&&spoken.phones.startsWith('<bos>'),'EXAMPLE_NOT_SYNTHESIZED',{lang,kind,family,samples:spoken.samples});
    if(['plain','question'].includes(kind))assert(spoken.normalized===draft,'EXAMPLE_PLAIN_TEXT_REWRITTEN',{lang,kind,normalized:spoken.normalized});
    else assert(spoken.normalized!==draft&&!/\d|[€$]/.test(spoken.normalized),'EXAMPLE_NOT_READ_OUT',{lang,kind,normalized:spoken.normalized});
    assert(await page.inputValue('#text')===draft,'EXAMPLE_DRAFT_LOST',{lang,kind,family});
    examples.push({lang,kind,family,text:draft,normalized:spoken.normalized,phones:spoken.phones,seconds:spoken.samples/spoken.sampleRate});
   }
  }
  {
   // The list keeps the newest eight: after ten German outputs with two German families, or
   // after the English examples when one family speaks each language.
   const list=await page.evaluate(()=>window.tts.outputs()),kept=Math.min(LIMIT,examples.length);
   assert(list.length===kept&&(await rows(page)).length===kept&&(await listening(page)).count===kept+' / 8','OUTPUTS_LIMIT',list.length);
   const expected=examples.slice(-LIMIT).reverse().map(item=>item.family+'|'+item.text);
   assert(list.map(o=>o.family+'|'+o.excerpt).join('\n')===expected.join('\n'),'OUTPUTS_ORDER',list.map(o=>o.family+'|'+o.excerpt));
   assert(list[0].selected&&list.filter(o=>o.selected).length===1,'OUTPUTS_NEWEST_NOT_SELECTED',list.map(o=>o.selected));
   assert(new Set(list.map(o=>o.id)).size===kept,'OUTPUTS_DUPLICATE_ID');
  }
 }
 assert(examples.length>LIMIT&&examples.length===EXAMPLE_KINDS.length*(P.speaking('de').length+P.speaking('en').length),'EXAMPLES_INCOMPLETE',examples.length);
 const kaleEnglish=await page.evaluate(()=>{document.getElementById('model').value='kale';document.getElementById('model').dispatchEvent(new Event('change'));return document.querySelector('#language [value=en]').disabled;});
 assert(kaleEnglish,'KALE_OFFERS_ENGLISH');
 result.examples=examples;

 // Rows: content, selection, playback, download.
 await page.evaluate(()=>window.tts.clearOutputs());
 const made=[];
 made.push(await synth(page,{...DE,text:'Der Kurs beginnt am 3. Februar 2027 um 14:30 Uhr.',speed:1,compare:null}));
 made.push(await synth(page,{...OTHER,lang:'de',text:MARKED,speed:1.2,compare:null}));
 made.push(await synth(page,{...DE,text:LONG,speed:0.9,compare:null}));
 let list=await rows(page);
 assert(list.length===3&&list[0].id===made[2].output&&list[2].id===made[0].output,'OUTPUTS_ORDER',list.map(r=>r.id));
 assert(list[0].voice==='Weibliche Stimme 01'&&list[0].meta===KALE+' · Deutsch · 0.90× · '+(made[2].samples/24000).toFixed(1)+' s','OUTPUT_ROW_COPY',list[0]);
 assert(list[1].voice===de(OTHER.voice)&&list[1].meta.startsWith(OTHER_NAME+' · Deutsch · 1.20× · ')&&list[1].text===MARKED&&list[1].textLang==='de','OUTPUT_ROW_COPY',list[1]);
 assert(list[0].text.endsWith('…')&&list[0].text.length===81&&LONG.startsWith(list[0].text.slice(0,-1)),'OUTPUT_EXCERPT',list[0].text);
 assert(list[0].playLabel==='Ausgabe abspielen: Weibliche Stimme 01 · Deutsch, '+KALE&&list[1].downloadLabel==='WAV herunterladen: '+de(OTHER.voice)+' · Deutsch, '+OTHER_NAME,'OUTPUT_ROW_ARIA',list[0]);
 assert(list[1].download==='engage-ki-sprachsynthese-'+OTHER.family+'-'+OTHER.voice+'-1.20.wav','OUTPUT_DOWNLOAD_NAME',list[1].download);
 assert(list[0].selected&&list[0].current==='true'&&!list[1].selected&&list[1].current===null,'OUTPUT_SELECTED_MARK',list.map(r=>r.current));

 await page.click(`[data-output="${made[0].output}"] .output-select`);
 let view=await listening(page);list=await rows(page);
 assert(list[2].selected&&list[2].current==='true'&&list.filter(r=>r.selected).length===1,'OUTPUT_SELECT',list.map(r=>r.selected));
 assert(view.src===list[2].href&&view.downloadHref===list[2].href&&view.paused,'OUTPUT_SELECT_AUDIO',view);
 assert(view.reading===made[0].normalized&&view.phones===made[0].phones&&view.title==='Weibliche Stimme 01 · Deutsch'&&view.detail.startsWith(KALE+' · 1.00× · '),'OUTPUT_SELECT_READING',view);
 assert(view.runId===made[0].runId,'OUTPUT_SELECT_METRICS',{shown:view.runId,expected:made[0].runId});
 assert(await page.evaluate(id=>document.activeElement===document.querySelector(`[data-output="${id}"] .output-select`),made[0].output),'OUTPUT_FOCUS_LOST');
 // Keyboard: Shift+Tab reaches the play button of the same row, Space plays it.
 await page.keyboard.press('Shift+Tab');
 const focus=await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return {cls:e.className,outline:s.outlineStyle,width:s.outlineWidth};});
 assert(focus.cls==='output-play'&&focus.outline==='solid'&&focus.width==='3px','FOCUS_NOT_VISIBLE',focus);
 await page.keyboard.press('Space');
 await page.waitForFunction(()=>!document.getElementById('audio').paused&&document.getElementById('audio').currentTime>0,null,{timeout:15000});
 list=await rows(page);
 assert(list[2].playLabel==='Ausgabe pausieren: Weibliche Stimme 01 · Deutsch, '+KALE+''&&list[0].playLabel.startsWith('Ausgabe abspielen'),'OUTPUT_PLAY_LABEL',list.map(r=>r.playLabel));
 // Playing another row moves the single audio element to it.
 await page.click(`[data-output="${made[1].output}"] .output-play`);
 await page.waitForFunction(()=>!document.getElementById('audio').paused&&document.getElementById('audio').currentTime>0,null,{timeout:15000});
 view=await listening(page);list=await rows(page);
 assert(list[1].selected&&view.src===list[1].href&&view.runId===made[1].runId&&view.reading===made[1].normalized&&list[1].playLabel.startsWith('Ausgabe pausieren')&&list[2].playLabel.startsWith('Ausgabe abspielen'),'OUTPUT_PLAY_OTHER_ROW',view);
 assert(await page.evaluate(()=>document.querySelectorAll('audio').length)===1,'OUTPUT_SECOND_AUDIO_ELEMENT');
 await page.click(`[data-output="${made[1].output}"] .output-play`);
 await page.waitForFunction(()=>document.getElementById('audio').paused);
 assert((await rows(page))[1].playLabel.startsWith('Ausgabe abspielen'),'OUTPUT_PAUSE_LABEL');
 // The API has the same selection.
 const api=await page.evaluate(id=>{window.tts.selectOutput(id);let unknown;try{window.tts.selectOutput('nope');}catch(error){unknown=error.message;}return {selected:window.tts.status().selected,unknown};},made[2].output);
 assert(api.selected===made[2].output&&api.unknown==='UNKNOWN_OUTPUT:nope','OUTPUT_API_SELECT',api);

 // Download: the row link is a 16-bit mono 24 kHz WAV of exactly that output.
 const wav=await page.evaluate(async id=>{
  const link=document.querySelector(`[data-output="${id}"] .output-download`),bytes=new Uint8Array(await(await fetch(link.href)).arrayBuffer()),view=new DataView(bytes.buffer);
  const tag=at=>String.fromCharCode(...bytes.subarray(at,at+4));
  return {length:bytes.length,riff:tag(0),riffSize:view.getUint32(4,true),wave:tag(8),fmt:tag(12),fmtSize:view.getUint32(16,true),format:view.getUint16(20,true),channels:view.getUint16(22,true),
   rate:view.getUint32(24,true),byteRate:view.getUint32(28,true),align:view.getUint16(32,true),bits:view.getUint16(34,true),data:tag(36),dataSize:view.getUint32(40,true),
   nonSilent:new Int16Array(bytes.buffer,44,view.getUint32(40,true)/2).some(value=>Math.abs(value)>1000),
   // With output marking on, the metadata chunks follow the data chunk (tools/check-marking.mjs checks their content).
   after:bytes.length>44+view.getUint32(40,true)?tag(44+view.getUint32(40,true)):null};
 },made[1].output);
 const samples=made[1].samples,marked=P.manifest.marking?.enabled===true,extra=wav.length-44-samples*2;
 assert(wav.riff==='RIFF'&&wav.wave==='WAVE'&&wav.fmt==='fmt '&&wav.data==='data'&&wav.fmtSize===16&&wav.format===1&&wav.channels===1&&wav.rate===24000&&wav.byteRate===48000&&wav.align===2&&wav.bits===16
  &&wav.dataSize===samples*2&&wav.riffSize===36+samples*2+extra&&(marked?extra>0&&wav.after==='LIST':extra===0)&&wav.nonSilent,'OUTPUT_WAV_INVALID',{wav,samples,marked});
 const [download]=await Promise.all([page.waitForEvent('download'),page.click(`[data-output="${made[1].output}"] .output-download`)]);
 const saved=(await stat(await download.path())).size;
 assert(download.suggestedFilename()==='engage-ki-sprachsynthese-'+OTHER.family+'-'+OTHER.voice+'-1.20.wav'&&saved===wav.length,'OUTPUT_DOWNLOAD_FAILED',{name:download.suggestedFilename(),saved});
 result.wav={...wav,savedBytes:saved,filename:download.suggestedFilename()};

 // Clear: nothing is left to play, show or fetch.
 const hrefs=(await rows(page)).map(row=>row.href);
 await page.click('#outputs-clear');
 view=await listening(page);
 const cleared=await page.evaluate(async hrefs=>({focus:document.activeElement.id,last:window.__lastTtsResult,outputs:window.tts.outputs().length,rows:document.querySelectorAll('#outputs-list>li').length,
  audioSrc:document.getElementById('audio').getAttribute('src'),alive:(await Promise.all(hrefs.map(href=>fetch(href).then(()=>true,()=>false)))).filter(Boolean).length}),hrefs);
 assert(cleared.outputs===0&&cleared.rows===0&&view.count==='0 / 8'&&!view.emptyHidden&&view.listHidden&&view.clearDisabled,'OUTPUTS_NOT_CLEARED',{cleared,view});
 assert(view.readingHidden&&view.reading===''&&view.phones===''&&view.playDisabled&&view.downloadDisabled==='true'&&view.downloadHref===null&&!view.waveEmptyHidden&&cleared.audioSrc===null&&cleared.last===null,'CLEAR_LEFT_AUDIO',{cleared,view});
 assert(cleared.alive===0,'OUTPUT_URL_NOT_REVOKED',cleared.alive);
 assert(cleared.focus==='outputs-title'&&view.status==='Liste geleert.','CLEAR_FEEDBACK',{focus:cleared.focus,status:view.status});

 // Comparison voice: options, one Generate, two outputs, the first plays.
 await page.selectOption('#model','kale');await page.selectOption('#language','de');await page.selectOption('#voice','fresh-de-f01');
 // A comparison voice that stays valid when the main voice changes: of the other family, or a
 // Kale voice other than the two main voices used here.
 const KEPT=P.crossFamilyGerman?COMPARE_VALUE:'kale:fresh-de-m08';
 const options=await page.evaluate(({KEPT,englishFamily})=>{
  const read=()=>[...document.getElementById('compare').children].map(node=>node.tagName==='OPTGROUP'?node.label+':'+node.children.length:node.value+'='+node.text);
  const german=read(),values=[...document.querySelectorAll('#compare option')].map(o=>o.value),label=document.getElementById('compare').labels[0].textContent;
  const first=document.querySelector('#compare optgroup option').text;
  const model=document.getElementById('model'),language=document.getElementById('language'),voice=document.getElementById('voice'),compare=document.getElementById('compare');
  const change=(element,value)=>{element.value=value;element.dispatchEvent(new Event('change'));};
  change(compare,'kale:fresh-de-m07');change(voice,'fresh-de-m07');const self=compare.value;
  change(compare,KEPT);change(voice,'fresh-de-f14');const kept=compare.value;
  change(model,englishFamily);change(language,'en');const english=read(),dropped=compare.value;
  change(model,'kale');change(voice,'fresh-de-f01');
  return {german,english,label,first,self,kept,dropped,hasMain:values.includes('kale:fresh-de-f01'),sample:values.slice(0,3)};
 },{KEPT,englishFamily:P.englishFamily});
 // Every voice of the speech language except the main voice, grouped by model.
 const groups=lang=>['=Keine',...P.speaking(lang).map(family=>P.name(family)+':'+(P.voices(family,lang).length-(family===(lang==='de'?'kale':P.englishFamily)?1:0)))].join();
 assert(options.label==='Vergleichsstimme'&&options.german.join()===groups('de')&&!options.hasMain&&options.first===KALE+' · Weibliche Stimme 14','COMPARE_OPTIONS',options);
 assert(options.english.join()===groups('en'),'COMPARE_OPTIONS_LANGUAGE',options.english);
 assert(options.self===''&&options.kept===KEPT&&options.dropped==='','COMPARE_SELECTION_RULES',options);
 // The literal groups of every qualified configuration.
 const GROUPS={'kale+voca64':['=Keine,Kale Nano:3,Voca64:32','=Keine,Voca64:31'],'kale+kale-en':['=Keine,Kale Nano DE:3','=Keine,Kale Nano EN:7'],
  'kale+kale-fresh-en':['=Keine,Kale Nano DE:3','=Keine,Kale Nano EN:3'],'kale+kale-fresh-en+voca64':['=Keine,Kale Nano DE:3,Voca64:32','=Keine,Kale Nano EN:4,Voca64:31']}[P.families.join('+')];
 assert(GROUPS&&groups('de')===GROUPS[0]&&groups('en')===GROUPS[1],'COMPARE_OPTIONS_OF_CONFIGURATION',{families:P.families,de:groups('de'),en:groups('en')});

 await page.selectOption('#compare',COMPARE_VALUE);await page.locator('#rate').fill('1');
 assert(await page.textContent('#compare-info')==='zwei Ausgaben','COMPARE_INFO');
 await page.fill('#text','Der Kurs beginnt am 3. Februar 2027 um 14:30 Uhr.');
 await page.click('#generate');await idle(page,2);
 await page.waitForFunction(()=>document.getElementById('audio').currentTime>0,null,{timeout:15000});
 list=await rows(page);view=await listening(page);
 const pair=await page.evaluate(()=>({outputs:window.tts.outputs(),size:document.getElementById('model-size').textContent,loadStatus:document.getElementById('load-status').textContent,loadState:document.getElementById('model-loading').dataset.state,loadFamily:window.tts.status().load.family}));
 assert(pair.outputs.length===2&&pair.outputs[0].family==='kale'&&pair.outputs[0].voice==='fresh-de-f01'&&!pair.outputs[0].comparison&&pair.outputs[1].family===COMPARE.family&&pair.outputs[1].voice===COMPARE.voice&&pair.outputs[1].comparison,'COMPARE_OUTPUTS',pair.outputs.map(o=>o.family+':'+o.voice+':'+o.comparison));
 assert(pair.outputs[0].normalized===pair.outputs[1].normalized&&pair.outputs[0].phones===pair.outputs[1].phones&&pair.outputs[0].excerpt===pair.outputs[1].excerpt&&pair.outputs[0].speed===pair.outputs[1].speed,'COMPARE_TEXT_DIFFERS',pair.outputs.map(o=>o.normalized));
 assert(list[0].selected&&!list[1].selected&&view.src===list[0].href&&!view.paused,'COMPARE_FIRST_NOT_PLAYING',{view,list});
 assert(list[1].meta.endsWith(' · Vergleichsstimme')&&!list[0].meta.includes('Vergleichsstimme')&&view.status==='Beide Ausgaben bereit.','COMPARE_COPY',{meta:list.map(r=>r.meta),status:view.status});
 // After a voice of another family the selected model has to start again; within one family it is still ready.
 const RESTORED=P.crossFamilyGerman?{status:'Dateien geladen · Modell startet beim Erzeugen',state:'idle'}:{status:'Modell bereit · Erzeugung startet ohne erneuten Download',state:'ready'};
 assert(pair.loadFamily==='kale'&&pair.size===P.graphSize('kale')&&pair.loadStatus===RESTORED.status&&pair.loadState===RESTORED.state,'COMPARE_PANEL_NOT_RESTORED',pair);
 result.comparison={pair:pair.outputs.map(o=>({family:o.family,voice:o.voice,comparison:o.comparison,normalized:o.normalized,seconds:o.seconds})),options};

 // Reading display.
 await page.evaluate(id=>window.tts.selectOutput(id),pair.outputs[0].id);
 view=await listening(page);
 assert(!view.readingHidden&&view.readingLabel==='Gelesen als'&&view.reading==='Der Kurs beginnt am dritten Februar zweitausendsiebenundzwanzig um vierzehn Uhr dreißig.'&&view.readingLang==='de','READING_TEXT',view);
 assert(view.phonesSummary==='Lautschrift'&&!view.phonesOpen&&view.phones===pair.outputs[0].phones&&view.phones.startsWith('<bos> d eː ʁ'),'READING_PHONES',view);
 assert(!await page.isVisible('#reading-phones'),'READING_PHONES_NOT_COLLAPSED');
 await page.focus('#reading summary');await page.keyboard.press('Enter');
 assert(await page.isVisible('#reading-phones')&&(await listening(page)).phonesOpen,'READING_PHONES_NOT_OPENED');
 await page.screenshot({path:out+'/desktop-de-phonemes.png',fullPage:true});
 await page.keyboard.press('Enter');
 result.reading={normalized:view.reading,phones:view.phones};

 // The same through the API, and a comparison voice of another language is refused.
 const pairApi=await synth(page,{...DE,text:MARKED,speed:1.1,compare:COMPARE});
 assert(pairApi.comparison&&pairApi.normalized===pairApi.comparison.normalized&&pairApi.comparison.family===COMPARE.family&&pairApi.comparison.voice===COMPARE.voice&&pairApi.comparison.speed===1.1&&pairApi.speed===1.1&&pairApi.runId!==pairApi.comparison.runId,'COMPARE_API',pairApi);
 const badCompare=await page.evaluate(async english=>{try{await window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text:'Ein Test.',compare:english});return null;}catch(error){return {message:error.message,status:window.tts.status().message,outputs:window.tts.status().outputs,compare:document.getElementById('compare').value};}},P.english);
 assert(badCompare&&badCompare.message==='Ungültige Vergleichsstimme.'&&badCompare.status==='Die Vergleichsstimme passt nicht zur gewählten Sprache.'&&badCompare.outputs===4&&badCompare.compare==='','COMPARE_INVALID_ACCEPTED',badCompare);

 // Ctrl+Enter and Cmd+Enter generate; plain Enter stays a line break.
 await page.selectOption('#compare','');
 const shortcut=[];
 for(const [keys,text,count] of [['Control+Enter','Die Lampe ist an.',5],['Meta+Enter','Die Lampe ist aus.',6]]){
  await page.fill('#text',text);await page.focus('#text');await page.keyboard.press(keys);
  await idle(page,count);
  await page.waitForFunction(()=>document.getElementById('audio').currentTime>0,null,{timeout:15000});
  const state=await page.evaluate(()=>({newest:window.tts.outputs()[0],paused:document.getElementById('audio').paused,ended:document.getElementById('audio').ended,draft:document.getElementById('text').value}));
  assert(state.newest.excerpt===text&&state.newest.selected&&(!state.paused||state.ended)&&state.draft===text,'SHORTCUT_DID_NOT_GENERATE',{keys,state});
  shortcut.push({keys,excerpt:state.newest.excerpt});
 }
 await page.fill('#text','Zeile');await page.focus('#text');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForTimeout(300);
 const plain=await page.evaluate(()=>({draft:document.getElementById('text').value,busy:window.tts.status().busy,outputs:window.tts.status().outputs}));
 assert(plain.draft==='Zeile\n'&&!plain.busy&&plain.outputs===6,'PLAIN_ENTER_GENERATED',plain);
 const hint=await page.evaluate(()=>{const text=document.getElementById('text'),node=document.getElementById(text.getAttribute('aria-describedby')),box=node.getBoundingClientRect();
  return {text:node.textContent,width:box.width,height:box.height,keys:document.getElementById('generate').getAttribute('aria-keyshortcuts'),button:document.getElementById('generate').innerText};});
 assert(hint.text==='Strg+Eingabetaste oder Cmd+Eingabetaste erzeugt das Audio.'&&hint.keys==='Control+Enter Meta+Enter','SHORTCUT_NOT_DESCRIBED',hint);
 assert(hint.width<=1&&hint.height<=1&&!/Strg|Ctrl|Cmd|Enter/.test(hint.button),'SHORTCUT_VISIBLE_DECORATION',hint);
 result.shortcut={shortcut,hint};

 // Locale switch with everything in place: a draft, a rate, a comparison
 // voice, six outputs, an older one selected and playing.
 await page.fill('#text',MARKED);await page.locator('#rate').fill('1.2');await page.selectOption('#compare',COMPARE_VALUE);
 await page.click(`[data-output="${pair.outputs[1].id}"] .output-play`);
 await page.waitForFunction(()=>!document.getElementById('audio').paused&&document.getElementById('audio').currentTime>0,null,{timeout:15000});
 const beforeLocale=await snapshot(page);
 await page.click('#locale-en');
 const afterLocale=await snapshot(page),english=await rows(page),englishView=await listening(page);
 const playing=await page.evaluate(()=>!document.getElementById('audio').paused||document.getElementById('audio').ended);
 assert(JSON.stringify(beforeLocale)===JSON.stringify(afterLocale),'LOCALE_CHANGED_STATE',{beforeLocale,afterLocale});
 assert(playing,'LOCALE_STOPPED_PLAYBACK');
 assert(afterLocale.rate==='1.2'&&afterLocale.compare===COMPARE_VALUE&&afterLocale.outputs.length===6&&afterLocale.selected===pair.outputs[1].id&&afterLocale.draft===MARKED,'LOCALE_FIXTURE',afterLocale);
 const englishCopy=await page.evaluate(()=>({title:document.getElementById('outputs-title').textContent,clear:document.getElementById('outputs-clear').textContent,list:document.getElementById('outputs-list').getAttribute('aria-label'),
  rate:document.getElementById('rate').labels[0].textContent,rateValue:document.getElementById('rate-value').textContent,compare:document.getElementById('compare').labels[0].textContent,compareOption:document.getElementById('compare').selectedOptions[0].text,
  compareInfo:document.getElementById('compare-info').textContent,none:document.querySelector('#compare option').text,examples:[...document.querySelectorAll('[data-example]')].map(b=>b.textContent).join(),hint:document.getElementById('text-hint').textContent}));
 assert(englishCopy.title==='Outputs'&&englishCopy.clear==='Clear list'&&englishCopy.list==='Outputs of this session'&&englishCopy.rate==='Speaking rate'&&englishCopy.rateValue==='1.20×'&&englishCopy.compare==='Comparison voice'
  &&englishCopy.compareOption===COMPARE_NAME+' · '+en(COMPARE.voice)&&englishCopy.compareInfo==='two outputs'&&englishCopy.none==='None'&&englishCopy.examples==='Statement,Question,Date and time,Amount,Abbreviation'&&englishCopy.hint==='Ctrl+Enter or Cmd+Enter generates the audio.','EN_COPY',englishCopy);
 assert(englishView.readingLabel==='Read as'&&englishView.phonesSummary==='Phonemes'&&englishView.count==='6 / 8'&&englishView.title===en(COMPARE.voice)+' · German','EN_LISTENING_COPY',englishView);
 const comparisonRow=english.find(row=>row.id===pair.outputs[1].id);
 assert(comparisonRow.selected&&comparisonRow.meta.startsWith(COMPARE_NAME+' · German · 1.00× · ')&&comparisonRow.meta.endsWith(' · comparison voice')&&comparisonRow.voice===en(COMPARE.voice)&&['Pause','Play'].some(verb=>comparisonRow.playLabel===verb+' output: '+en(COMPARE.voice)+' · German, '+COMPARE_NAME)
  &&comparisonRow.downloadLabel==='Download WAV: '+en(COMPARE.voice)+' · German, '+COMPARE_NAME&&comparisonRow.download==='engage-ki-speech-'+COMPARE.family+'-'+COMPARE.voice+'-1.00.wav','EN_ROW_COPY',comparisonRow);
 assert(!/Ausgabe|Vergleichsstimme|Gelesen|Lautschrift|Sprechtempo|Liste leeren/.test(await page.evaluate(()=>document.body.innerText)),'EN_CONTAINS_GERMAN_COPY');
 await page.evaluate(()=>document.getElementById('audio').pause());
 result.locale={beforeLocale:{...beforeLocale,metrics:undefined},englishCopy};

 // Desktop and phone width: eight outputs, both locales, no horizontal scrolling.
 await page.selectOption('#compare','');
 await synth(page,{...DE,text:EXAMPLES.de.abbreviation,speed:1,compare:COMPARE});
 assert(await page.evaluate(()=>window.tts.status().outputs)===LIMIT,'PHONE_FIXTURE');
 const phone={};
 for(const locale of ['de','en']){
  await page.setViewportSize({width:1280,height:900});await page.evaluate(locale=>window.tts.setLocale(locale),locale);await page.waitForTimeout(200);
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'DESKTOP_OVERFLOW',locale);
  await page.screenshot({path:out+`/desktop-${locale}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,
   controls:['rate','compare','voice','generate','outputs-clear'].map(id=>{const box=document.getElementById(id).getBoundingClientRect();return {id,left:box.left,right:box.right,height:box.height};})}));
  const phoneRows=await rows(page);
  assert(!layout.overflow&&layout.controls.every(c=>c.left>=0&&c.right<=390)&&phoneRows.every(row=>row.right<=390),'PHONE_OVERFLOW',{locale,layout});
  assert(phoneRows.length===LIMIT&&phoneRows.every(row=>row.playSize[0]>=36&&row.playSize[1]>=36),'PHONE_TOUCH_TARGET',phoneRows.map(row=>row.playSize));
  await page.screenshot({path:out+`/phone-${locale}.png`,fullPage:true});
  phone[locale]=layout;
 }
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.tts.setLocale('de'));
 result.phone=phone;

 // Nothing entered is stored: only the locale preference exists, and a reload
 // starts with an empty list.
 const storage=page=>page.evaluate(async({marker,origin})=>{
  const manifest=await(await fetch('/manifest.json')).json(),known=new Set(Object.values(manifest.assets).map(asset=>{const url=new URL(asset.url,origin);url.searchParams.set('sha256',asset.sha256);return url.href;}));
  const local=Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]));
  const session=Object.keys(sessionStorage);
  const databases=indexedDB.databases?(await indexedDB.databases()).map(db=>db.name):null;
  let cached=null,foreign=[];
  if(globalThis.caches){cached=0;for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys()){cached++;if(!known.has(request.url))foreign.push(request.url);}}
  const dump=JSON.stringify({local,session,databases,foreign,cookie:document.cookie}).toLowerCase();
  return {local,session,databases,cached,foreign,cookie:document.cookie,containsText:dump.includes(marker.toLowerCase())||dump.includes('früchte')||dump.includes('siebzehn')};
 },{marker:MARKER,origin});
 const stored=await storage(page);
 assert(Object.keys(stored.local).join()==='engage-ki-tts-locale'&&['de','en'].includes(stored.local['engage-ki-tts-locale'])&&stored.session.length===0&&stored.cookie==='','STORAGE_NOT_EMPTY',stored);
 assert((stored.databases===null||stored.databases.length===0)&&stored.foreign.length===0&&!stored.containsText,'ENTERED_TEXT_PERSISTED',stored);
 await page.reload();await page.waitForFunction(()=>window.tts?.status().ready);
 const reloaded=await page.evaluate(()=>({outputs:window.tts.outputs().length,rows:document.querySelectorAll('#outputs-list>li').length,draft:document.getElementById('text').value,rate:document.getElementById('rate').value,compare:document.getElementById('compare').value,readingHidden:document.getElementById('reading').hidden}));
 assert(reloaded.outputs===0&&reloaded.rows===0&&reloaded.readingHidden&&!reloaded.draft.includes(MARKER)&&reloaded.compare==='','OUTPUTS_SURVIVED_RELOAD',reloaded);
 result.storage={stored,reloaded};
 assert(errors.length===0,'PAGE_ERRORS',errors);

 // ------------------------------------------- second page: loading, cancel
 const second=await open();
 const p=second.page;
 const hold=async pattern=>{let release;const gate=new Promise(resolve=>release=resolve);await p.route(pattern,async route=>{await gate;await route.continue();});return release;};
 const startPair=text=>p.evaluate(({text,DE,COMPARE})=>{window.__pair=window.tts.synthesize({...DE,text,compare:COMPARE}).then(()=>'done',error=>error.name);},{text,DE,COMPARE});
 // Cancel while the first voice is still loading: no output, and the second never starts.
 const releaseKale=await hold('**/assets/kale/plan.onnx*');
 await startPair(MARKED);
 await p.waitForFunction(()=>document.getElementById('model-loading').dataset.state==='loading');
 await p.evaluate(()=>window.tts.cancel());releaseKale();
 const cancelFirst={outcome:await p.evaluate(()=>window.__pair)};
 await p.waitForTimeout(2500);
 Object.assign(cancelFirst,await p.evaluate(()=>({outputs:window.tts.status().outputs,busy:window.tts.status().busy,status:window.tts.status().message,cancelHidden:document.getElementById('cancel').hidden})));
 assert(cancelFirst.outcome==='AbortError'&&cancelFirst.outputs===0&&!cancelFirst.busy&&cancelFirst.cancelHidden&&cancelFirst.status.startsWith('Abgebrochen.'),'COMPARE_CANCEL_FIRST',cancelFirst);

 // With a comparison voice of another family, that family loads in the existing panel while
 // the first output is already listed; a locale switch during that load changes copy only.
 let loadingDe=null,loadingEn=null;
 if(P.crossFamilyGerman){
 const releaseOther=await hold('**/assets/'+COMPARE.family+'/plan.onnx*');
 await startPair(MARKED);
 await p.waitForFunction(family=>window.tts.status().outputs===1&&window.tts.status().load?.family===family&&document.getElementById('model-loading').dataset.state==='loading',COMPARE.family,{timeout:120000});
 const manifest=await p.evaluate(async()=>(await(await fetch('/manifest.json')).json()).models);
 const size=family=>(manifest[family].graphBytes/1e6).toFixed(1)+' MB · ONNX';
 loadingDe=await p.evaluate(()=>({size:document.getElementById('model-size').textContent,progressHidden:document.getElementById('progress').hidden,loadStatus:document.getElementById('load-status').textContent,status:window.tts.status().message,
  busy:window.tts.status().busy,ready:window.tts.status().load.ready,cancelHidden:document.getElementById('cancel').hidden,selected:window.tts.outputs()[0].selected,controls:['model','language','voice','compare','rate','outputs-clear'].map(id=>document.getElementById(id).disabled)}));
 assert(loadingDe.size===size(COMPARE.family)&&!loadingDe.progressHidden&&loadingDe.busy&&!loadingDe.ready&&!loadingDe.cancelHidden&&loadingDe.selected&&/geprüft/.test(loadingDe.loadStatus),'COMPARE_LOADING_PANEL',loadingDe);
 assert(loadingDe.status==='Stimme 2 von 2 · Das Modell wird vorbereitet.'&&loadingDe.controls.every(Boolean),'COMPARE_LOADING_STATUS',loadingDe);
 // Other files of the model keep verifying meanwhile, so the load state is read
 // in the same task as the click on the locale button.
 const loadBefore=await snapshot(p);
 const loadSwitch=await p.evaluate(()=>{const before=JSON.stringify(window.tts.status().load);document.getElementById('locale-en').click();return {before,after:JSON.stringify(window.tts.status().load),locale:window.tts.getLocale()};});
 const loadAfter=await snapshot(p);loadingEn=await p.evaluate(()=>({status:window.tts.status().message,loadStatus:document.getElementById('load-status').textContent,row:document.querySelector('#outputs-list .output-voice').textContent,meta:document.querySelector('#outputs-list .output-meta').textContent,generate:document.querySelector('#generate span').textContent}));
 // Live measurements of the running job keep arriving; everything else must hold still.
 const steady=({metrics,...rest})=>JSON.stringify(rest);
 assert(steady(loadBefore)===steady(loadAfter)&&loadSwitch.before===loadSwitch.after&&loadSwitch.locale==='en'&&loadAfter.busy&&loadAfter.outputs.length===1,'LOCALE_CHANGED_LOADING_STATE',{before:steady(loadBefore),after:steady(loadAfter)});
 assert(loadingEn.status==='Voice 2 of 2 · Preparing the model.'&&/verified/.test(loadingEn.loadStatus)&&loadingEn.row==='Female voice 01'&&loadingEn.meta.startsWith(KALE+' · German · 1.00× · ')&&loadingEn.generate==='Generating…','LOCALE_LOADING_COPY',loadingEn);
 await p.click('#locale-de');releaseOther();
 const loadedOutcome=await p.evaluate(()=>window.__pair);
 const loaded=await p.evaluate(()=>({outputs:window.tts.outputs(),size:document.getElementById('model-size').textContent,loadStatus:document.getElementById('load-status').textContent,status:window.tts.status().message,busy:window.tts.status().busy,draft:document.getElementById('text').value}));
 assert(loadedOutcome==='done'&&loaded.outputs.length===2&&loaded.outputs[0].family==='kale'&&loaded.outputs[1].family===COMPARE.family&&loaded.outputs[1].comparison&&loaded.outputs[0].selected&&loaded.outputs[0].normalized===loaded.outputs[1].normalized,'COMPARE_AFTER_LOADING',loaded);
 assert(loaded.size===size('kale')&&loaded.loadStatus==='Dateien geladen · Modell startet beim Erzeugen'&&loaded.status==='Beide Ausgaben bereit.'&&!loaded.busy&&loaded.draft===MARKED,'COMPARE_PANEL_NOT_RESTORED',loaded);
 await p.unroute('**/assets/'+COMPARE.family+'/plan.onnx*');
 }else{
  // Both voices belong to the one German family: the second voice needs no loading at all.
  await startPair(MARKED);
  const outcome=await p.evaluate(()=>window.__pair);
  const same=await p.evaluate(()=>({outputs:window.tts.outputs(),size:document.getElementById('model-size').textContent,loadStatus:document.getElementById('load-status').textContent,loadState:document.getElementById('model-loading').dataset.state,status:window.tts.status().message,busy:window.tts.status().busy,draft:document.getElementById('text').value}));
  assert(outcome==='done'&&same.outputs.length===2&&same.outputs.every(o=>o.family==='kale')&&same.outputs[1].voice===COMPARE.voice&&same.outputs[1].comparison&&same.outputs[0].selected&&same.outputs[0].normalized===same.outputs[1].normalized,'COMPARE_SAME_FAMILY',same);
  assert(same.size===P.graphSize('kale')&&same.loadState==='ready'&&same.loadStatus==='Modell bereit · Erzeugung startet ohne erneuten Download'&&same.status==='Beide Ausgaben bereit.'&&!same.busy&&same.draft===MARKED,'COMPARE_PANEL_NOT_RESTORED',same);
 }
 await p.unroute('**/assets/kale/plan.onnx*');

 // Cancel while the second voice is rendering: the first stays, the second never arrives.
 const cancelSecond=await p.evaluate(async({text,DE,COMPARE})=>{
  const before=window.tts.status().outputs;
  const pending=window.tts.synthesize({...DE,text,compare:COMPARE}).then(()=>'done',error=>error.name);
  await new Promise(resolve=>{const timer=setInterval(()=>{if(window.tts.status().outputs===before+1||!window.tts.status().busy){clearInterval(timer);resolve();}},2);});
  const busyAtCancel=window.tts.status().busy,message=window.tts.status().message;window.tts.cancel();
  return {before,outcome:await pending,busyAtCancel,message,after:window.tts.status().outputs,newest:window.tts.outputs()[0]};
 },{text:LONG,DE,COMPARE});
 await p.waitForTimeout(3000);
 const settled=await p.evaluate(()=>({outputs:window.tts.status().outputs,busy:window.tts.status().busy,paused:document.getElementById('audio').paused,status:window.tts.status().message,comparisons:window.tts.outputs().filter(o=>o.comparison).length}));
 assert(cancelSecond.busyAtCancel&&cancelSecond.outcome==='AbortError'&&cancelSecond.after===cancelSecond.before+1&&cancelSecond.newest.family==='kale'&&!cancelSecond.newest.comparison,'COMPARE_CANCEL_SECOND',cancelSecond);
 assert(settled.outputs===cancelSecond.before+1&&!settled.busy&&settled.paused&&settled.comparisons===1&&settled.status.startsWith('Abgebrochen.'),'COMPARE_CANCEL_SECOND_CONTINUED',settled);

 // Locale switch while a synthesis is running, started from the button.
 await p.selectOption('#compare','');await p.fill('#text',LONG);
 const runBefore=await snapshot(p);
 await p.click('#generate');
 const running=await p.evaluate(()=>new Promise(resolve=>{const timer=setInterval(()=>{
  const status=window.tts.status();
  if(status.busy&&/^Synthese · Abschnitt \d+ \/ \d+$/.test(status.message)){clearInterval(timer);window.tts.setLocale('en');const after=window.tts.status();resolve({seen:true,de:status.message,en:after.message,busy:after.busy,outputs:after.outputs,draft:document.getElementById('text').value,generate:document.querySelector('#generate span').textContent,cancel:document.getElementById('cancel').textContent});}
  else if(!status.busy){clearInterval(timer);resolve({seen:false,message:status.message});}
 },2);}));
 assert(running.seen&&running.busy&&/^Synthesis · Segment \d+ \/ \d+$/.test(running.en)&&running.outputs===runBefore.outputs.length&&running.draft===LONG&&running.generate==='Generating…'&&running.cancel==='Cancel','LOCALE_RUNNING_SYNTHESIS',running);
 await idle(p,runBefore.outputs.length+1);
 await p.waitForFunction(()=>document.getElementById('audio').currentTime>0,null,{timeout:15000});
 const runAfter=await snapshot(p),finished=await p.evaluate(()=>({status:window.tts.status().message,paused:document.getElementById('audio').paused,locale:window.tts.getLocale()}));
 assert(runAfter.outputs.slice(1).join('\n')===runBefore.outputs.join('\n')&&runAfter.selected===runAfter.outputs[0].split('|')[0]&&runAfter.draft===LONG&&runAfter.rate===runBefore.rate&&runAfter.compare==='','LOCALE_RUNNING_LOST_STATE',{runBefore,runAfter});
 assert(finished.status==='Audio ready.'&&!finished.paused&&finished.locale==='en','LOCALE_RUNNING_RESULT',finished);
 const storedSecond=await storage(p);
 assert(Object.keys(storedSecond.local).join()==='engage-ki-tts-locale'&&storedSecond.session.length===0&&(storedSecond.databases===null||storedSecond.databases.length===0)&&storedSecond.foreign.length===0&&!storedSecond.containsText,'ENTERED_TEXT_PERSISTED',storedSecond);
 assert(second.errors.length===0,'PAGE_ERRORS',second.errors);
 result.loading={cancelFirst,loadingDe,loadingEn,cancelSecond:{...cancelSecond,newest:undefined},settled,running};

 // No request carried entered text: every request is a GET for a static file
 // of this origin, and none contains the marker in any encoding.
 const needles=[MARKER,encodeURIComponent('Früchte'),'Fr%FCchte',Buffer.from(MARKER).toString('base64').replace(/=+$/,''),Buffer.from(MARKED).toString('base64').slice(0,24),'siebzehn','Garten'].map(needle=>needle.toLowerCase());
 const leaked=requests.filter(request=>needles.some(needle=>request.url.toLowerCase().includes(needle)||(request.body||'').toLowerCase().includes(needle)));
 // A static host may answer a same-origin asset GET with a redirect to its own file storage (the Hugging
 // Face Space serves large files from its CDN). Such a hop is not a request the page made: it is allowed
 // only as a body-less GET whose redirect chain starts at a same-origin request.
 const byUrl=new Map(requests.map(request=>[request.url,request]));
 const firstOf=request=>{let at=request;for(let i=0;i<8&&at?.redirectedFrom;i++)at=byUrl.get(at.redirectedFrom)??{url:at.redirectedFrom};return at;};
 const own=request=>request.url.startsWith(origin+'/')||request.url.startsWith('blob:'+origin+'/');
 const foreign=requests.filter(request=>request.method!=='GET'||request.body!==null||!(own(request)||(request.redirectedFrom&&own(firstOf(request)))));
 const fetched=path=>requests.some(request=>request.url.startsWith(origin+path));
 assert(requests.length>20&&fetched('/worker.js')&&fetched('/assets/kale/plan.onnx')&&fetched('/assets/'+P.englishFamily+'/wave.onnx')&&fetched('/assets/nrmlz/'),'PRIVACY_LOG_INCOMPLETE',requests.length);
 assert(leaked.length===0,'REQUEST_CARRIED_ENTERED_TEXT',leaked);
 assert(foreign.length===0,'UNEXPECTED_REQUEST',foreign.slice(0,5));
 result.requests={count:requests.length,methods:[...new Set(requests.map(request=>request.method))],origins:[...new Set(requests.map(request=>request.url.startsWith('blob:')?'blob':new URL(request.url).origin===origin?'preview origin':request.redirectedFrom?'host storage redirect':'other'))],leaked:0};

 result.families=P.families;result.browser=await browser.version();
 result.scope='Real Chrome against the static preview with real browser CPU-WASM synthesis. Phone width is viewport emulation. Request and storage checks cover this session; nothing here judges how the audio sounds.';
 await writeFile(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log('PASS: outputs list (limit, rows, select, play, WAV download, clear), comparison voice (two outputs, loading panel, cancel in both phases), reading display, all examples in both speech languages and families, Ctrl/Cmd+Enter, locale switch idle/loading/running, phone width, no stored or transmitted text');
}finally{await browser.close();}
