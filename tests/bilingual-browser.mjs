// Real Chrome check for the German/English interface: static copy, dynamic
// states, ARIA names and the promise that switching locale never disturbs the
// draft, the selection, the audio or the measurements.
//
// Needs the static preview server (bun tools/serve-preview.mjs) serving dist:
//   PREVIEW_URL=http://127.0.0.1:8894/ bun tests/bilingual-browser.mjs
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const out=process.env.PROOF_DIR||'artifacts/bilingual-ui-proof';
await mkdir(out,{recursive:true});
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const DRAFT='Die Besprechung beginnt um neun Uhr.';
const SLOGANS=/Alles lokal|Dein Browser ist das Studio|Platz für deine Stimme|Nicht nur hören|Kleine Modelle|Stimmwerkstatt|Unter die Haube/;

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);

 const readUi=()=>page.evaluate(()=>{
  const $=id=>document.getElementById(id);
  return {
   locale:window.tts.getLocale(),lang:document.documentElement.lang,title:document.title,
   stored:localStorage.getItem('engage-ki-tts-locale'),
   heading:document.querySelector('.intro h1').innerText.replace(/\n/g,' '),
   pressed:[...document.querySelectorAll('[data-locale]')].map(b=>b.dataset.locale+':'+b.getAttribute('aria-pressed')),
   groupLabel:$('locale-switch').getAttribute('aria-label'),
   draft:$('text').value,model:$('model').value,language:$('language').value,voice:$('voice').value,
   generate:document.querySelector('#generate span').textContent,
   loadStatus:$('load-status').textContent,loadState:$('model-loading').dataset.state,
   progressHidden:$('progress').hidden,progressLabel:$('progress').getAttribute('aria-label'),
   loadNote:$('load-note').textContent,voiceInfo:$('voice-info').textContent,
   status:window.tts.status().message,statusBusy:window.tts.status().busy,statusError:$('status').classList.contains('error'),
   audioTitle:$('audio-title').textContent,audioDetail:$('audio-detail').textContent,audioTime:$('audio-time').textContent,
   playLabel:$('play').getAttribute('aria-label'),waveLabel:$('waveform').getAttribute('aria-label'),
   voiceLabel:$('voice').getAttribute('aria-label'),textLabel:document.querySelector('label[for=text]').textContent,
   download:$('download').getAttribute('download'),exportName:$('metrics-export').textContent,
   metricLabels:[...document.querySelectorAll('.metric-grid>div>span')].map(n=>n.textContent),
   stageLabels:[...document.querySelectorAll('#stage-metrics dt')].map(n=>n.textContent),
   browserRows:[...document.querySelectorAll('#browser-metrics>div')].map(n=>n.querySelector('dt').textContent+'='+n.querySelector('dd').textContent),
   metricsNumbers:['metric-synth','metric-ready','metric-memory','metric-bytes'].map(id=>$(id).textContent.replace(/\D/g,'')),
   metricSnapshot:(()=>{const m=window.tts.metrics();return m?{synth:m.run?.stages?.synthesis?.ms??null,ready:m.uiReadyMs??m.run?.endToEndMs??null,memory:m.memory.wasmCapacityBytes,bytes:m.assets.loadedBodyBytes}:null;})(),
   sectionTitles:[...document.querySelectorAll('#messwerte h2,.method h2')].map(n=>n.textContent),
   footer:document.querySelector('footer p').textContent,
   body:document.body.innerText,
   audio:{src:$('audio').currentSrc,time:$('audio').currentTime,paused:$('audio').paused,duration:$('audio').duration}
  };
 });

 // 1. German default, plain task labels, no slogan copy.
 const initial=await readUi();
 assert(initial.locale==='de'&&initial.lang==='de','DE_DEFAULT_LOCALE');
 assert(initial.title.includes('Sprachsynthese'),'DE_TITLE');
 assert(initial.heading.includes('Sprachsynthese'),'DE_HEADING');
 assert(initial.draft==='Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.','DE_DEFAULT_DRAFT');
 assert(initial.pressed.join()==='de:true,en:false','DE_LOCALE_PRESSED');
 assert(initial.generate==='Erzeugen und abspielen','DE_GENERATE_LABEL');
 assert(initial.loadStatus.includes('Laden beim Erzeugen'),'DE_LOAD_IDLE');
 assert(initial.voiceInfo==='4 deutsche Stimmen','DE_VOICE_COUNT');
 assert(initial.playLabel==='Audio abspielen','DE_PLAY_ARIA');
 assert(initial.waveLabel.includes('Wellenform'),'DE_WAVE_ARIA');
 assert(initial.voiceLabel==='Stimme','DE_VOICE_ARIA');
 assert(initial.download==='engage-ki-sprachsynthese.wav','DE_DOWNLOAD_NAME');
 assert(initial.footer.includes('(BMFTR)')&&initial.footer.includes('(PTKA)')&&initial.footer.includes('ENGAGE-KI'),'DE_FUNDING');
 assert(!SLOGANS.test(initial.body),'DE_SLOGAN_PRESENT');
 await page.screenshot({path:out+'/desktop-de-start.png',fullPage:true});

 // 2. Separate interface locale: switch to English before generating anything.
 await page.fill('#text',DRAFT);
 await page.selectOption('#model','kale');await page.waitForTimeout(50);
 const beforeSwitch=await readUi();
 await page.click('#locale-en');
 const afterSwitch=await readUi();
 assert(afterSwitch.locale==='en'&&afterSwitch.lang==='en','EN_LOCALE_SET');
 assert(afterSwitch.title.includes('Text-to-speech'),'EN_TITLE');
 assert(afterSwitch.draft===beforeSwitch.draft,'EN_DRAFT_REPLACED');
 assert(afterSwitch.model===beforeSwitch.model&&afterSwitch.voice===beforeSwitch.voice,'EN_SELECTION_CHANGED');
 assert(afterSwitch.language==='de','EN_SPEECH_LANGUAGE_CHANGED');
 assert(afterSwitch.pressed.join()==='de:false,en:true','EN_LOCALE_PRESSED');
 assert(afterSwitch.generate==='Generate and play','EN_GENERATE_LABEL');
 assert(afterSwitch.loadStatus.includes('loads on generate'),'EN_LOAD_IDLE');
 assert(afterSwitch.loadNote.includes('All models and runtime'),'EN_LOAD_NOTE');
 assert(afterSwitch.voiceInfo==='4 German voices','EN_VOICE_COUNT');
 assert(afterSwitch.playLabel==='Play audio'&&afterSwitch.waveLabel.includes('Waveform')&&afterSwitch.voiceLabel==='Voice','EN_ARIA');
 assert(afterSwitch.textLabel==='Text to synthesize','EN_TEXT_LABEL');
 assert(afterSwitch.download==='engage-ki-speech.wav'&&afterSwitch.exportName==='Measurements as JSON','EN_FILENAMES');
 assert(afterSwitch.groupLabel==='Interface language','EN_LOCALE_GROUP_ARIA');
 assert(afterSwitch.metricLabels.includes('Synthesis')&&afterSwitch.metricLabels.includes('Text to audio ready'),'EN_METRIC_LABELS');
 assert(afterSwitch.stageLabels.length===0,'EN_STAGE_LABELS_BEFORE_RUN');
 assert(afterSwitch.footer.includes('Bundesministerium für Forschung, Technologie und Raumfahrt (BMFTR)')&&afterSwitch.footer.includes('Projektträger Karlsruhe (PTKA)'),'EN_FUNDING');
 assert(!/Alles lokal|Dein Browser ist das Studio|Platz für deine Stimme|Nicht nur hören|Kleine Modelle/.test(afterSwitch.body),'EN_SLOGAN_PRESENT');
 assert(afterSwitch.stored==='en','EN_NOT_PERSISTED');

 // 3. English loading state: hold the planner asset until the state is captured.
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/assets/kale/plan.onnx*',async route=>{await gate;await route.continue();});
 await page.click('#generate');
 await page.waitForFunction(()=>document.getElementById('model-loading').dataset.state==='loading',{timeout:30000});
 const loadingEn=await readUi();
 assert(!loadingEn.progressHidden,'EN_PROGRESS_HIDDEN');
 assert(loadingEn.progressLabel==='Checksum-verified files','EN_PROGRESS_ARIA');
 assert(/verified|loading files|Files verified/.test(loadingEn.loadStatus),'EN_LOADING_TEXT:'+loadingEn.loadStatus);
 assert(loadingEn.statusBusy===true,'EN_BUSY_FLAG');
 const busyEn=await page.evaluate(()=>({generate:document.querySelector('#generate span').textContent,cancelHidden:document.getElementById('cancel').hidden}));
 assert(busyEn.generate==='Generating…'&&busyEn.cancelHidden===false,'EN_BUSY_COPY');
 await page.screenshot({path:out+'/desktop-en-loading.png',fullPage:true});
 release();
 await page.waitForFunction(()=>!window.tts.status().busy&&window.__lastTtsResult,{timeout:120000});
 await page.unroute('**/assets/kale/plan.onnx*');
 await page.waitForFunction(()=>document.getElementById('audio').currentTime>0,{timeout:15000});

 // 4. Playback and measurements in English, then switch back and prove nothing moved.
 const readyEn=await readUi();
 assert(readyEn.audio.paused===false&&readyEn.audio.time>0,'EN_AUTOPLAY_MISSING');
 assert(readyEn.loadState==='ready','EN_LOAD_NOT_READY');
 assert(readyEn.status==='Audio ready.','EN_DONE_STATUS:'+readyEn.status);
 assert(readyEn.audioTitle.startsWith('Female voice'),'EN_AUDIO_TITLE:'+readyEn.audioTitle);
 assert(/segment/.test(readyEn.audioDetail),'EN_AUDIO_DETAIL:'+readyEn.audioDetail);
 assert(readyEn.stageLabels.includes('Synthesis')&&readyEn.stageLabels.includes('Loading files'),'EN_STAGE_LABELS:'+readyEn.stageLabels.join('|'));
 assert(readyEn.browserRows.includes('CPU utilization=Not measurable')&&readyEn.browserRows.includes('Process RAM (RSS)=Not measurable'),'EN_BROWSER_ROWS:'+readyEn.browserRows.join('|'));
 assert(['Pause audio','Replay audio'].includes(readyEn.playLabel),'EN_PAUSE_ARIA:'+readyEn.playLabel);
 assert(readyEn.metricsNumbers.every(value=>value.length>0),'EN_METRICS_EMPTY');
 await page.screenshot({path:out+'/desktop-en-ready.png',fullPage:true});

 await page.click('#locale-de');
 const backDe=await readUi();
 assert(backDe.locale==='de'&&backDe.lang==='de','DE_SWITCH_BACK');
 assert(backDe.draft===readyEn.draft,'DE_DRAFT_REPLACED');
 assert(backDe.model===readyEn.model&&backDe.language===readyEn.language&&backDe.voice===readyEn.voice,'DE_SELECTION_CHANGED');
 assert(backDe.audio.src===readyEn.audio.src,'DE_AUDIO_CHANGED');
 assert(backDe.audio.duration===readyEn.audio.duration,'DE_DURATION_CHANGED');
 assert(backDe.metricsNumbers.join()===readyEn.metricsNumbers.join(),'DE_METRICS_DISPLAY_CHANGED');
 assert(JSON.stringify(backDe.metricSnapshot)===JSON.stringify(readyEn.metricSnapshot),'DE_METRICS_VALUES_CHANGED');
 assert(backDe.status==='Audio bereit.','DE_STATUS_NOT_RELOCALIZED:'+backDe.status);
 assert(backDe.audioTitle.startsWith('Weibliche Stimme'),'DE_AUDIO_TITLE:'+backDe.audioTitle);
 assert(backDe.audioDetail.includes('Abschnitt'),'DE_AUDIO_DETAIL:'+backDe.audioDetail);
 assert(backDe.stageLabels.includes('Synthese')&&backDe.stageLabels.includes('Dateien laden'),'DE_STAGE_LABELS:'+backDe.stageLabels.join('|'));
 assert(backDe.loadState==='ready'&&backDe.loadStatus.includes('Modell bereit'),'DE_READY_STATE');
 assert(backDe.playLabel==='Audio pausieren','DE_PAUSE_ARIA');
 assert(backDe.download==='engage-ki-sprachsynthese.wav','DE_DOWNLOAD_AFTER_SWITCH');

 // 5. Cancel in English.
 await page.click('#locale-en');
 await page.fill('#text','Cancel this speech before it finishes. '.repeat(8));
 const cancelled=await page.evaluate(async()=>{const pending=window.tts.synthesize({text:document.getElementById('text').value}).then(()=>false,error=>error.name==='AbortError');await new Promise(r=>setTimeout(r,300));window.tts.cancel();return {cancelled:await pending,status:window.tts.status()};});
 assert(cancelled.cancelled&&!cancelled.status.busy,'EN_CANCEL_FAILED');
 const cancelUi=await readUi();
 assert(cancelUi.status.startsWith('Cancelled. You can change'),'EN_CANCEL_STATUS:'+cancelUi.status);
 assert(cancelUi.loadStatus.includes('prepared again on next generate'),'EN_CANCEL_LOAD:'+cancelUi.loadStatus);
 assert(cancelUi.audio.src===backDe.audio.src,'CANCEL_DROPPED_AUDIO');

 // 6. API synthesis stays silent by default, errors localize, autoplay falls back.
 const silent=await page.evaluate(async()=>{await window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text:'Noch ein kurzer Test.'});const audio=document.getElementById('audio');return {paused:audio.paused,status:window.tts.status()};});
 assert(silent.paused===true&&!silent.status.busy,'API_AUTOPLAYED_OR_BUSY');
 const invalid=await page.evaluate(async()=>{try{await window.tts.synthesize({voice:'no-such-voice',text:'Hello'});return null;}catch(error){return {name:error.name,message:error.message,status:window.tts.status()};}});
 assert(invalid,'EN_INVALID_SELECTION_NOT_REJECTED');
 const invalidUi=await readUi();
 assert(invalidUi.statusError&&invalidUi.status.includes('invalid'),'EN_ERROR_SUMMARY:'+invalidUi.status);
 const fallback=await page.evaluate(async()=>{const audio=document.getElementById('audio');audio.play=()=>Promise.reject(new DOMException('blocked','NotAllowedError'));await window.tts.synthesize({family:'kale',lang:'de',voice:'fresh-de-f01',text:'Ein weiterer Test.',autoplay:true});return {status:window.tts.status(),message:window.tts.status().message};});
 assert(fallback.message.includes('blocked'),'EN_AUTOPLAY_FALLBACK:'+fallback.message);

 // 7. The button's actions have API equivalents, and unknown locales fail closed.
 const beforeApi=await readUi();
 const api=await page.evaluate(()=>{
  const unknown=(()=>{try{window.tts.setLocale('fr');return 'accepted';}catch(error){return error.message;}})();
  const locale=window.tts.setLocale('de');
  return {unknown,locale};
 });
 const afterApi=await readUi();
 assert(api.unknown.startsWith('UNKNOWN_LOCALE'),'UNKNOWN_LOCALE_ACCEPTED:'+api.unknown);
 assert(api.locale==='de'&&afterApi.lang==='de'&&afterApi.title.includes('Sprachsynthese'),'API_SETLOCALE_FAILED');
 assert(afterApi.draft===beforeApi.draft&&afterApi.voice===beforeApi.voice&&afterApi.language===beforeApi.language,'API_SETLOCALE_RESET_STATE');
 assert(afterApi.audio.src===beforeApi.audio.src,'API_SETLOCALE_DROPPED_AUDIO');

 // 8. Phone viewport in English.
 await page.click('#locale-en');
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(150);
 const phone=await page.evaluate(()=>{
  const buttons=[...document.querySelectorAll('[data-locale]')].map(b=>{const r=b.getBoundingClientRect();return {locale:b.dataset.locale,width:Math.round(r.width),height:Math.round(r.height),visible:r.width>0&&r.height>0};});
  const header=document.querySelector('.site-header').getBoundingClientRect();
  return {overflow:document.documentElement.scrollWidth>innerWidth,buttons,headerHeight:Math.round(header.height),
   localeLabel:document.getElementById('locale-switch').getAttribute('aria-label'),
   headingWrap:document.querySelector('.intro h1').getBoundingClientRect().height};
 });
 assert(!phone.overflow,'PHONE_OVERFLOW');
 assert(phone.buttons.every(b=>b.visible&&b.width>=32&&b.height>=24),'PHONE_LOCALE_TARGET:'+JSON.stringify(phone.buttons));
 assert(phone.localeLabel==='Interface language','PHONE_LOCALE_ARIA');
 await page.screenshot({path:out+'/phone-en.png',fullPage:true});

 // 9. The stored preference survives a reload; unknown stored values fall back.
 await page.reload();
 await page.waitForFunction(()=>window.tts?.status().ready);
 const reloaded=await page.evaluate(()=>({locale:window.tts.getLocale(),lang:document.documentElement.lang,title:document.title,pressed:document.getElementById('locale-en').getAttribute('aria-pressed')}));
 assert(reloaded.locale==='en'&&reloaded.lang==='en'&&reloaded.pressed==='true','EN_PREFERENCE_LOST');
 const poison=await page.evaluate(()=>{localStorage.setItem('engage-ki-tts-locale','klingon');return true;});
 await page.reload();await page.waitForFunction(()=>window.tts?.status().ready);
 const recovered=await page.evaluate(()=>({locale:window.tts.getLocale(),lang:document.documentElement.lang}));
 assert(poison&&recovered.locale==='de'&&recovered.lang==='de','UNKNOWN_STORED_LOCALE_NOT_FALLBACK');

 assert(errors.length===0,'PAGE_ERRORS:'+errors.join('|'));
 const result={initial,afterSwitch,loadingEn,busyEn,readyEn,backDe,cancelled,cancelUi,silent,invalid:invalid.message,invalidStatus:invalidUi.status,fallback:fallback.message,api,afterApi,phone,reloaded,recovered,errors,browser:await browser.version(),scope:'Chrome with a real static preview server and real browser CPU-WASM synthesis; phone viewport is emulation, no naturalness claim'};
 await writeFile(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log('PASS: German/English copy, dynamic loading/error/cancel/playback/metrics/ARIA, draft-selection-audio preservation across locale switches');
}finally{await browser.close();}
