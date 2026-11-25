import {modelLoading} from './loading.mjs';
import {DEFAULT_LOCALE, createTranslator, hasMessage, isTrustedHtmlKey, normalizeLocale} from './i18n.mjs';
import {describeError, translateDetail} from './errors.mjs';
import {exampleText} from './examples.mjs';
import {RATE_ERROR, rateHundredths} from './rate.mjs';
import {metadata, readMetadata, wavBytes} from './wav.mjs';

const $=id=>document.getElementById(id);
const elements={};for(const id of ['text','model','language','voice','compare','rate','generate','cancel','status','audio','play','download','waveform','wave-empty','reading','outputs-list','outputs-clear','metrics-export','progress','model-loading','load-status','load-note'])elements[id]=$(id);

const STORAGE_KEY='engage-ki-tts-locale';
const LOCALE_TAGS={de:'de-DE',en:'en-US'};
const SAMPLE_KEYS={de:'sample.text.de',en:'sample.text.en'};
// Model families in the order of the model select. Which of them a build serves is in its
// manifest. `kale-fresh-en` is the English fit of the German Kale family type with our own four
// English voices; `kale-en` is the public upstream English model. A build has at most one of them.
const FAMILIES=['kale','kale-fresh-en','kale-en','voca64'];
const ENGLISH_KALE=['kale-fresh-en','kale-en'];
const PREFERRED_VOICE={kale:{de:'fresh-de-f01'},'kale-fresh-en':{en:'fresh-en-f03'},'kale-en':{en:'kale-en-f01'},voca64:{de:'fresh-de-f05',en:'fresh-en-f03'}};
const OUTPUT_LIMIT=8,EXCERPT_LENGTH=80;
const PLAY_PATH='m9 5 10 7-10 7Z',PAUSE_PATH='M7 5h4v14H7zM15 5h4v14h-4z';

// Everything the interface shows is derived from this state so a locale change
// can re-render copy without touching the draft, the selection or the audio.
// `outputs` is the session's list of generated audio, newest first. It lives in
// this object only: nothing here is written to storage or sent anywhere.
const state={manifest:null,worker:null,sequence:0,pending:null,audio:null,metrics:null,busy:false,readyProfile:null,loadedProfiles:new Set(),load:null,loadActive:false,loadError:null,cancelledLoad:false,loadNote:{key:'loading.note',params:{}},locale:DEFAULT_LOCALE,status:{key:'status.ready',params:{}},statusError:false,outputs:[],selected:null,outputSequence:0};
const rows=new Map();
let t=createTranslator(state.locale);

const MB=n=>(n/1e6).toFixed(1);
const families=()=>FAMILIES.filter(family=>state.manifest?.models[family]);
// Literal names. When an English Kale family is served, the speech language is part of the name.
function modelName(family){
 if(family==='voca64')return 'Voca64';
 if(ENGLISH_KALE.includes(family))return 'Kale Nano EN';
 return ENGLISH_KALE.some(english=>state.manifest?.models[english])?'Kale Nano DE':'Kale Nano';
}
const rateText=rate=>t('rate.value',{rate:rate.toFixed(2)});
const selectedOutput=()=>state.outputs.find(output=>output.id===state.selected)||null;
const ms=n=>Number.isFinite(n)?Math.round(n).toLocaleString(LOCALE_TAGS[state.locale]):'—';
const langName=lang=>t(lang==='en'?'lang.en':'lang.de');
const stageLabel=name=>hasMessage(state.locale,'stage.'+name)?t('stage.'+name):name;

function setStatus(key,params={},error=false){state.status={key,params};state.statusError=error;renderStatus();}
function progressText(params){
 const label=stageLabel(params.stage),detail=translateDetail(params.detail,t);
 return detail?t('progress.withDetail',{label,detail}):t('progress.label',{label});
}
function statusText(){
 const {key,params}=state.status,text=key==='progress'?progressText(params):t(key,params);
 return params.pair?t('progress.voice',{index:params.pair.index,total:params.pair.total,progress:text}):text;
}
function renderStatus(){elements.status.textContent=statusText();elements.status.classList.toggle('error',state.statusError);}
function loadingErrorText(){return t('status.modelFailed',{detail:t(state.loadError.key,state.loadError.params)});}

function voiceLabel(id){
 const [,lang,code]=id.split('-');
 return t(code?.[0]==='f'?'voice.female':'voice.male',{code:code?.slice(1)||id,language:langName(lang)});
}

function applyStatic(){
 document.documentElement.lang=state.locale;
 document.title=t('document.title');
 for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
 for(const node of document.querySelectorAll('[data-i18n-html]')){
  const key=node.dataset.i18nHtml;
  if(!isTrustedHtmlKey(key))throw Error('UNTRUSTED_HTML_MESSAGE:'+key);
  node.innerHTML=t(key);
 }
 for(const node of document.querySelectorAll('[data-i18n-aria-label]'))node.setAttribute('aria-label',t(node.dataset.i18nAriaLabel));
 for(const node of document.querySelectorAll('[data-i18n-title]'))node.title=t(node.dataset.i18nTitle);
 for(const button of document.querySelectorAll('[data-locale]'))button.setAttribute('aria-pressed',String(button.dataset.locale===state.locale));
}

function renderCounter(){$('char-count').textContent=t('editor.count',{count:elements.text.value.length,limit:elements.text.maxLength});}

function loadingStatusText(load){
 if(load.ready)return t('loading.stateReady');
 if(state.loadActive){
  if(load.verifiedBytes===load.totalBytes)return t('loading.stateVerify');
  return t('loading.stateDownload',{verified:MB(load.verifiedBytes),total:MB(load.totalBytes)});
 }
 if(load.loaded)return t('loading.stateLoaded');
 return state.cancelledLoad?t('status.cancelLoad'):t('loading.stateIdle',{size:MB(load.totalBytes)});
}
function renderLoading(){
 const load=state.load;
 elements['load-note'].textContent=t(state.loadNote.key,state.loadNote.params);
 if(!load){
  $('model-size').textContent=t('loading.sizePending');
  elements['load-status'].textContent=state.loadError?loadingErrorText():t('loading.idle');
  elements['model-loading'].dataset.state=state.loadError?'error':'idle';
  elements.progress.hidden=true;
  return;
 }
 $('model-size').textContent=MB(state.manifest.models[load.family].graphBytes)+' MB · ONNX';
 elements.progress.max=load.totalBytes;
 elements.progress.value=load.verifiedBytes;
 elements.progress.hidden=!(state.loadActive&&!load.ready);
 if(state.loadError){
  elements['model-loading'].dataset.state='error';
  elements['load-status'].textContent=loadingErrorText();
  return;
 }
 elements['model-loading'].dataset.state=load.ready?'ready':state.loadActive?'loading':'idle';
 elements['load-status'].textContent=loadingStatusText(load);
}

function setLoading(load,active=false){
 state.load=load;state.loadActive=active;
 if(load?.ready){state.readyProfile=load.family+':'+load.lang;state.loadedProfiles.add(state.readyProfile);}
 renderLoading();
}

// The model select lists the families of this build, with their literal names.
function renderModels(){
 const list=families(),old=elements.model.value;
 if(!list.length)throw Error('Runtime unvollständig');
 elements.model.replaceChildren(...list.map(family=>new Option(modelName(family),family)));
 elements.model.value=list.includes(old)?old:list[0];
}

// Which models this build has decides the description and the model links.
const METHOD_COPY={'kale+voca64':'method.body1','kale+kale-en':'method.body1.kalePair','kale+kale-fresh-en':'method.body1.kaleFresh','kale+kale-fresh-en+voca64':'method.body1.kaleFreshVoca'};
function renderMethod(){
 const list=families().join('+');
 $('method-models').textContent=t(!state.manifest?'method.body1':METHOD_COPY[list]||'method.body1.other');
 // The runtime sentence says how the build marks its outputs.
 $('method-runtime').dataset.i18n=watermarking()?'method.body2.marked':markingMode()==='metadata'?'method.body2.metadata':'method.body2';$('method-runtime').textContent=t($('method-runtime').dataset.i18n);
 for(const link of document.querySelectorAll('[data-family]'))link.hidden=state.manifest?!state.manifest.models[link.dataset.family]:ENGLISH_KALE.includes(link.dataset.family);
}

function updateVoices(resetLoading=true){
 if(!state.manifest)return;
 const family=elements.model.value,spoken=state.manifest.models[family].languages,old=elements.voice.value;
 // A model offers its own speech languages only; the others are disabled in the select.
 for(const option of elements.language.options)option.disabled=!spoken.includes(option.value);
 if(!spoken.includes(elements.language.value))elements.language.value=spoken[0];
 const language=elements.language.value,voices=state.manifest.models[family].voices.filter(v=>v.includes('-'+language+'-'));
 elements.voice.replaceChildren(...voices.map(id=>new Option(voiceLabel(id),id)));
 const preferred=PREFERRED_VOICE[family]?.[language];
 elements.voice.value=voices.includes(old)?old:voices.includes(preferred)?preferred:voices[0];
 $('voice-info').textContent=t(language==='en'?'voice.count.english':'voice.count.german',{count:voices.length});
 const load=modelLoading(state.manifest,family,language);
 const profile=family+':'+language;
 if(state.readyProfile===profile)load.ready=true;
 // The worker keeps verified files in memory while another model is active.
 else if(state.loadedProfiles.has(profile))load.loaded=true;
 if(load.ready||load.loaded){load.verifiedBytes=load.totalBytes;load.verifiedFiles=load.totalFiles;}
 if(resetLoading)setLoading(load,state.loadActive&&!load.ready);
 updateCompare();
}

// Voices of both models that speak the chosen language, without the main voice.
function updateCompare(){
 if(!state.manifest)return;
 const language=elements.language.value,main=elements.model.value+':'+elements.voice.value,old=elements.compare.value,values=[];
 const groups=families().filter(family=>state.manifest.models[family].languages.includes(language)).map(family=>{
  const group=document.createElement('optgroup');group.label=modelName(family);
  for(const voice of state.manifest.models[family].voices){
   const value=family+':'+voice;
   if(!voice.includes('-'+language+'-')||value===main)continue;
   const code=voice.split('-')[2];
   group.append(new Option(t(code[0]==='f'?'compare.female':'compare.male',{model:modelName(family),code:code.slice(1)}),value));values.push(value);
  }
  return group;
 }).filter(group=>group.children.length);
 elements.compare.replaceChildren(new Option(t('compare.none'),''),...groups);
 elements.compare.value=values.includes(old)?old:'';
 renderCompareInfo();
}
function renderCompareInfo(){$('compare-info').textContent=t(elements.compare.value?'compare.info.set':'compare.info.none');}
function renderRate(){const text=rateText(Number(elements.rate.value));$('rate-value').textContent=text;elements.rate.setAttribute('aria-valuetext',text);}

function renderBusy(){
 const busy=state.busy;
 elements.generate.disabled=busy||!state.manifest;
 elements.cancel.hidden=!busy;
 for(const id of ['model','language','voice','compare','rate'])elements[id].disabled=busy;
 elements['outputs-clear'].disabled=busy||!state.outputs.length;
 elements.generate.querySelector('span').textContent=t(busy?'action.generating':'action.generate');
 if(!busy)elements.progress.hidden=true;
}

function playIcon(){
 elements.play.querySelector('path').setAttribute('d',elements.audio.paused?PLAY_PATH:PAUSE_PATH);
 elements.play.setAttribute('aria-label',t(elements.audio.paused?(elements.audio.ended?'audio.replay':'audio.play'):'audio.pause'));
 renderOutputs();
}

// The listening area always shows the selected output.
function renderAudio(){
 const output=selectedOutput();
 elements.play.disabled=!output;elements['wave-empty'].hidden=Boolean(output);
 if(!output){
  elements.download.removeAttribute('href');elements.download.setAttribute('aria-disabled','true');
  $('audio-title').textContent=t('audio.none');
  $('audio-detail').textContent=t('audio.detail');
  $('audio-time').textContent='—';
  return;
 }
 elements.download.href=output.url;elements.download.removeAttribute('aria-disabled');
 $('audio-title').textContent=voiceLabel(output.voice);
 $('audio-detail').textContent=t('audio.summary',{model:modelName(output.family),rate:rateText(output.rate),seconds:output.seconds.toFixed(2),count:output.chunks});
 $('audio-time').textContent=t('audio.duration',{seconds:output.seconds.toFixed(1)});
}

// What the frontend actually read: the normalized text and its phonemes.
function renderReading(){
 const output=selectedOutput();
 elements.reading.hidden=!output;
 $('reading-text').textContent=output?.normalized??'';$('reading-phones').textContent=output?.phones??'';
 if(output)$('reading-text').lang=output.lang;
}

function outputRow(output){
 const row=document.createElement('li'),play=document.createElement('button'),select=document.createElement('button'),link=document.createElement('a');
 row.className='output';row.dataset.output=output.id;
 play.type='button';play.className='output-play';
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.append(path);play.append(icon);
 select.type='button';select.className='output-select';
 for(const name of ['voice','meta','text'])select.append(Object.assign(document.createElement('span'),{className:'output-'+name}));
 link.className='output-download';link.href=output.url;
 const arrow=Object.assign(document.createElement('span'),{textContent:' ↗'});arrow.setAttribute('aria-hidden','true');
 link.append(document.createElement('span'),arrow);
 play.onclick=()=>togglePlay(output.id);select.onclick=()=>selectOutput(output.id);
 row.append(play,select,link);
 return row;
}

// Rows are kept per output and updated in place, so focus survives selection,
// playback and locale changes; the list is only rebuilt when its order changes.
function renderOutputs(){
 const list=elements['outputs-list'],ids=state.outputs.map(output=>output.id);
 for(const id of [...rows.keys()])if(!ids.includes(id))rows.delete(id);
 for(const output of state.outputs)if(!rows.has(output.id))rows.set(output.id,outputRow(output));
 if([...list.children].map(row=>row.dataset.output).join()!==ids.join())list.replaceChildren(...ids.map(id=>rows.get(id)));
 for(const output of state.outputs){
  const row=rows.get(output.id),[play,select,link]=row.children,[voice,meta,text]=select.children;
  const selected=output.id===state.selected,playing=selected&&!elements.audio.paused;
  const names={voice:voiceLabel(output.voice),model:modelName(output.family)};
  row.dataset.selected=String(selected);
  if(selected)select.setAttribute('aria-current','true');else select.removeAttribute('aria-current');
  const code=output.voice.split('-')[2];
  voice.textContent=t(code[0]==='f'?'outputs.female':'outputs.male',{code:code.slice(1)});
  meta.textContent=t(output.comparison?'outputs.metaComparison':'outputs.meta',{model:names.model,language:langName(output.lang),rate:rateText(output.rate),seconds:output.seconds.toFixed(1)});
  text.textContent=output.excerpt;text.lang=output.lang;
  play.querySelector('path').setAttribute('d',playing?PAUSE_PATH:PLAY_PATH);
  play.setAttribute('aria-label',t(playing?'outputs.pause':'outputs.play',names));
  link.download=t('outputs.filename',{model:output.family,voice:output.voice,rate:output.rate.toFixed(2)});
  link.setAttribute('aria-label',t('outputs.downloadLabel',names));link.firstChild.textContent=t('outputs.download');
 }
 list.hidden=!ids.length;
 $('outputs-empty').hidden=Boolean(ids.length);$('outputs-empty').textContent=t('outputs.empty',{limit:OUTPUT_LIMIT});
 $('outputs-count').textContent=t('outputs.count',{count:ids.length,limit:OUTPUT_LIMIT});
 elements['outputs-clear'].disabled=state.busy||!ids.length;
}

function renderSelection(){
 const output=selectedOutput();
 renderAudio();renderReading();
 if(output)showMetrics(output.metrics);
 draw();playIcon();
}

function selectOutput(id){
 const output=state.outputs.find(item=>item.id===id);
 if(!output)throw Error('UNKNOWN_OUTPUT:'+id);
 if(state.selected!==id){
  elements.audio.pause();
  state.selected=id;state.audio=output.audio;elements.audio.src=output.url;
 }
 renderSelection();
 return id;
}

// One audio element plays the selected output; choosing another row moves it.
async function togglePlay(id=state.selected){
 if(id!==state.selected)selectOutput(id);
 else if(!elements.audio.paused){elements.audio.pause();playIcon();return;}
 try{await elements.audio.play();playIcon();}catch{setStatus('status.playFailed',{},true);}
}

// Marking is a property of the build (docs/output-marking.md). "metadata" (default): every exported WAV
// carries the AI-generation metadata; the audio is the model output. "watermark": the listed output is
// the watermarked audio, played, drawn and exported; a result without it is an error, never unmarked
// audio. "off": nothing.
const markingMode=()=>state.manifest?.marking?.mode??(state.manifest?.marking?.enabled?'watermark':'off');
const watermarking=()=>state.manifest?.marking?.watermark===true;
const MARKING_ERROR='Das Wasserzeichen konnte nicht eingefügt werden.';
function addOutput(input,result,{comparison=false,after=null}={}){
 const flat=input.text.trim().replace(/\s+/g,' ');
 if(watermarking()&&!(result.marked instanceof Float32Array&&result.marked.length===result.audio.length))throw Error(MARKING_ERROR);
 const audio=watermarking()?result.marked:result.audio;
 const output={id:'output-'+(++state.outputSequence),comparison,family:input.family,voice:input.voice,lang:input.lang,rate:result.speed,
  excerpt:flat.length>EXCERPT_LENGTH?flat.slice(0,EXCERPT_LENGTH).trimEnd()+'…':flat,normalized:result.normalized,phones:result.phones,chunks:result.chunks,
  audio,marking:markingMode(),sampleRate:result.sampleRate,seconds:audio.length/result.sampleRate,metrics:result.metrics,url:URL.createObjectURL(wav(audio,result.sampleRate,input))};
 state.outputs.splice(after?state.outputs.findIndex(item=>item.id===after)+1:0,0,output);
 for(const dropped of state.outputs.splice(OUTPUT_LIMIT)){URL.revokeObjectURL(dropped.url);if(dropped.id===state.selected)state.selected=null;}
 return output;
}

function clearOutputs(){
 if(state.busy)throw Error(t('status.busy'));
 elements.audio.pause();
 for(const output of state.outputs)URL.revokeObjectURL(output.url);
 state.outputs=[];state.selected=null;state.audio=null;window.__lastTtsResult=null;
 elements.audio.removeAttribute('src');elements.audio.load();
 renderSelection();setStatus('status.cleared');
}

const outputSummary=output=>({id:output.id,marking:output.marking,family:output.family,voice:output.voice,lang:output.lang,speed:output.rate,samples:output.audio.length,sampleRate:output.sampleRate,seconds:output.seconds,chunks:output.chunks,comparison:output.comparison,selected:output.id===state.selected,excerpt:output.excerpt,normalized:output.normalized,phones:output.phones});

function setNumber(id,value,unit){$(id).replaceChildren(document.createTextNode(value),Object.assign(document.createElement('small'),{textContent:' '+unit}));}
function row(label,value){const div=document.createElement('div');div.append(Object.assign(document.createElement('dt'),{textContent:label}),Object.assign(document.createElement('dd'),{textContent:value}));return div;}

function showMetrics(m){
 if(!m)return;state.metrics=m;
 setNumber('metric-synth',ms(m.run?.stages?.synthesis?.ms),'ms');
 setNumber('metric-ready',ms(m.uiReadyMs??m.run?.endToEndMs),'ms');
 setNumber('metric-memory',m.memory.wasmCapacityBytes===null?'—':MB(m.memory.wasmCapacityBytes),'MB');
 setNumber('metric-bytes',MB(m.assets.loadedBodyBytes),'MB');
 const rtf=m.run?.synthesisRtf;
 $('metric-rtf').textContent=rtf!=null?t('metrics.rtf',{rtf:rtf.toFixed(3),factor:(1/Math.max(rtf,.0001)).toFixed(1)}):t('metrics.synthNote');
 $('metric-cache').textContent=t('metrics.cache',{size:MB(m.assets.cachedArtifactBytes)});
 $('engine-label').textContent=m.inference.backend?t('engine.runtime',{threads:m.inference.threads,count:m.inference.threads}):t('engine.fallback');
 $('stage-metrics').replaceChildren(...Object.entries(m.run?.stages||{}).map(([name,v])=>row(stageLabel(name),ms(v.ms)+' ms')));
 const storage=m.storage?.available?t('metrics.storageRemaining',{size:MB(m.storage.remainingQuotaBytes)}):t('metrics.unavailable');
 $('browser-metrics').replaceChildren(row(t('metrics.cpuUtil'),t('metrics.notMeasurable')),row(t('metrics.processRss'),t('metrics.notMeasurable')),row(t('metrics.storageQuota'),storage),row(t('metrics.jsHeap'),m.memory.jsHeapEstimate.available?MB(m.memory.jsHeapEstimate.value)+' MB':t('metrics.unavailable')));
 elements['metrics-export'].disabled=false;
}

function renderMetrics(){if(state.metrics)showMetrics(state.metrics);}

function renderAll(){
 applyStatic();
 renderMethod();
 renderCounter();
 updateVoices(false);
 renderLoading();
 renderRate();
 renderStatus();
 renderAudio();
 renderReading();
 renderMetrics();
 renderBusy();
 playIcon();
 elements.download.download=t('download.filename');
}

function setLocale(value){
 const locale=normalizeLocale(value);
 state.locale=locale;t=createTranslator(locale);
 // Storage may be blocked (private mode, quota); the locale still applies now.
 try{localStorage.setItem(STORAGE_KEY,locale);}catch{}
 renderAll();
 return locale;
}

function storedLocale(){
 // An unavailable or unreadable preference falls back to the default locale.
 try{const stored=localStorage.getItem(STORAGE_KEY);if(stored)return normalizeLocale(stored);}catch{}
 return DEFAULT_LOCALE;
}

function draw(){
 const canvas=elements.waveform;const rect=canvas.getBoundingClientRect();const scale=devicePixelRatio||1;
 canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);
 const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.clearRect(0,0,rect.width,rect.height);if(!state.audio)return;
 const samples=state.audio,center=rect.height/2,peak=samples.reduce((a,b)=>Math.max(a,Math.abs(b)),.00001);
 ctx.strokeStyle='#f24535';ctx.lineWidth=1.5;ctx.beginPath();
 const steps=Math.floor(rect.width/3);for(let x=0;x<steps;x++){let low=0,high=0;const from=Math.floor(x*samples.length/steps),to=Math.floor((x+1)*samples.length/steps);
  for(let i=from;i<to;i++){low=Math.min(low,samples[i]);high=Math.max(high,samples[i]);}
  ctx.moveTo(x*3,center+low/peak*center*.76);ctx.lineTo(x*3,center+high/peak*center*.76);
 }ctx.stroke();
 if(elements.audio.duration>0&&elements.audio.currentTime>0){const x=elements.audio.currentTime/elements.audio.duration*rect.width;ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,rect.height-20);ctx.stroke();}
}
function wav(samples,sampleRate,{family,voice}={}){
 return new Blob([wavBytes(samples,sampleRate,markingMode()==='off'?undefined:metadata({family,voice,watermark:watermarking()}))],{type:'audio/wav'});
}
function worker(){
 if(state.worker)return state.worker;
 const w=new Worker('/worker.js',{type:'module'});state.worker=w;
 w.onmessage=({data})=>{
  if(state.detecting?.id===data.id){if(data.type==='error')state.detecting.reject(Error(data.error));else if(data.type==='result')state.detecting.resolve(data);return;}
  const pending=state.pending;if(!pending||data.id!==pending.id)return;
  if(data.type==='progress'){
   showMetrics(data.metrics);setLoading(data.load,data.state==='loading');
   if(data.state!=='loading')setStatus('progress',{stage:data.state,detail:data.detail,pair:pending.pair});
   return;
  }
  if(data.type==='error'){pending.reject(Error(data.error));return;}
  if(data.type==='result')pending.resolve(data);
 };
 w.onerror=error=>{state.pending?.reject(Error(error.message||t('error.worker')));state.detecting?.reject(Error(error.message||t('error.worker')));};
 return w;
}
function inputError(message){
 const described=describeError(message,t);
 setStatus(described.key,described.params,true);
 return Error(message);
}
function speechInput(request={}){
 // A family this build does not serve is an invalid selection, not a crash.
 if(request.family&&!state.manifest.models[request.family])throw inputError('Ungültige Modell-/Sprachauswahl.');
 if(request.family)elements.model.value=request.family;if(request.lang)elements.language.value=request.lang;updateVoices();
 if(request.voice)elements.voice.value=request.voice;if(typeof request.text==='string')elements.text.value=request.text;
 if(request.speed!==undefined){
  try{rateHundredths(request.speed);}catch{throw inputError(RATE_ERROR);}
  elements.rate.value=String(request.speed);
 }
 updateCompare();
 if('compare' in request){
  const value=request.compare?request.compare.family+':'+request.compare.voice:'';
  elements.compare.value=value;
  if(elements.compare.value!==value){elements.compare.value='';renderCompareInfo();throw inputError('Ungültige Vergleichsstimme.');}
 }
 renderCompareInfo();renderRate();
 elements.text.oninput();
 const [family,voice]=elements.compare.value.split(':');
 const input={text:elements.text.value,lang:elements.language.value,family:elements.model.value,voice:elements.voice.value,speed:Number(elements.rate.value),compare:elements.compare.value?{family,voice}:null};
 if(!input.text.trim()){setStatus('status.emptyText',{},true);elements.text.focus();throw Error(t('status.emptyText'));}
 return input;
}
async function autoplayResult(result,token,started){
 let playing=true;
 try{await elements.audio.play();result.metrics.playbackSchedulingMs=performance.now()-started;showMetrics(result.metrics);}
 catch{playing=false;if(token===state.sequence)setStatus('status.autoplayBlocked');}
 if(token!==state.sequence)throw new DOMException(t('status.aborted'),'AbortError');
 return playing;
}
function reportFailure(error){
 if(error.name==='AbortError')return;
 const described=describeError(error.message||String(error),t);
 setStatus(described.key,described.params,true);
 if(!state.load?.ready){state.loadError=described;renderLoading();}
}
// One Generate renders the text with the main voice and, when a comparison
// voice is chosen, once more with that voice. Each output joins the list as
// soon as it is ready; the main voice is selected and played.
async function generate(request){
 if(state.busy)throw Error(t('status.busy'));
 if(!state.manifest)throw Error(t('status.notLoaded'));
 const input=speechInput(request);
 const token=++state.sequence,started=performance.now();
 const jobs=[{text:input.text,lang:input.lang,family:input.family,voice:input.voice,speed:input.speed}];
 if(input.compare)jobs.push({...jobs[0],family:input.compare.family,voice:input.compare.voice});
 state.cancelledLoad=false;state.loadError=null;
 state.busy=true;renderBusy();setStatus('status.preparing');
 elements.audio.pause();
 const summaries=[];let first=null,blocked=false;
 try{
  for(let index=0;index<jobs.length;index++){
   const pair=jobs.length>1?{index:index+1,total:jobs.length}:null;
   if(index>0)setStatus('status.preparing',{pair});
   const result=await new Promise((resolve,reject)=>{
    state.pending={id:token+'-'+index,pair,resolve,reject};
    worker().postMessage({id:state.pending.id,request:jobs[index],manifest:state.manifest});
   });
   if(token!==state.sequence)throw new DOMException(t('status.aborted'),'AbortError');
   result.metrics.uiReadyMs=performance.now()-started;
   const output=addOutput(jobs[index],result,{comparison:index>0,after:first?.id});
   summaries.push({samples:result.audio.length,sampleRate:result.sampleRate,metrics:result.metrics,normalized:result.normalized,phones:result.phones,speed:result.speed,output:output.id,family:output.family,voice:output.voice});
   if(index===0){
    first=output;selectOutput(output.id);window.__lastTtsResult=result;
    if(!pair)setStatus('status.done');
    if(request?.autoplay)blocked=!await autoplayResult(result,token,started);
   }else if(selectedOutput())renderOutputs();
   else selectOutput(state.outputs.some(item=>item.id===first.id)?first.id:output.id);
  }
  if(jobs.length>1)setStatus(blocked?'status.autoplayBlocked':'status.donePair');
  return jobs.length>1?{...summaries[0],comparison:summaries[1]}:summaries[0];
 }catch(error){reportFailure(error);throw error;}
 finally{
  if(token===state.sequence){
   state.pending=null;state.busy=false;renderBusy();
   // The loading panel and the measurements return to the current selection.
   if(jobs.length>1)updateVoices();
   const output=selectedOutput();if(output)showMetrics(output.metrics);
  }
 }
}
// The check anyone can run on a file: an ArrayBuffer of WAV, MP3 or any format the browser decodes.
// `metadata` is what the WAV metadata says (null when the file has none). `watermark` is null unless
// the build has the watermark model: then the browser decodes and resamples the file to 16 kHz mono
// and the worker runs AudioSeal's detector (score, decision, matching message bits).
async function detect(buffer){
 if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength)throw Error('INVALID_AUDIO_FILE');
 const found=readMetadata(buffer);
 if(!watermarking())return {metadata:found,watermark:null};
 if(state.busy||state.detecting)throw Error(t('status.busy'));
 const rate=state.manifest.marking.watermarkRate;
 let decoded;
 try{decoded=await new OfflineAudioContext(1,1,rate).decodeAudioData(buffer.slice(0));}catch{throw Error('UNDECODABLE_AUDIO_FILE');}
 const samples=new Float32Array(decoded.length);
 for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]+=channel[i]/decoded.numberOfChannels;}
 const id='detect-'+(state.detections=(state.detections||0)+1);
 try{
  const result=await new Promise((resolve,reject)=>{state.detecting={id,resolve,reject};worker().postMessage({id,detect:samples,manifest:state.manifest},[samples.buffer]);});
  return {metadata:found,watermark:{score:result.score,threshold:result.threshold,marked:result.marked,messageBitsMatching:result.messageBitsMatching,seconds:result.seconds,decodedSampleRate:rate}};
 }finally{state.detecting=null;}
}
function cancel(){
 state.detecting?.reject(new DOMException(t('status.aborted'),'AbortError'));state.detecting=null;
 state.sequence++;state.worker?.terminate();state.worker=null;state.readyProfile=null;state.loadedProfiles.clear();
 elements.audio.pause();state.pending?.reject(new DOMException(t('status.aborted'),'AbortError'));state.pending=null;
 state.busy=false;state.cancelledLoad=true;state.loadError=null;state.loadActive=false;
 renderBusy();updateVoices();
 const output=selectedOutput();if(output)showMetrics(output.metrics);
 setStatus('status.cancelled');
}
elements.generate.onclick=()=>generate({autoplay:true}).catch(()=>{});elements.cancel.onclick=cancel;
elements.play.onclick=()=>togglePlay();
elements.audio.onplay=playIcon;elements.audio.onpause=playIcon;
elements.audio.ontimeupdate=draw;elements.audio.onended=()=>{playIcon();draw();};
elements.model.onchange=updateVoices;elements.language.onchange=updateVoices;
elements.voice.onchange=updateCompare;elements.compare.onchange=renderCompareInfo;elements.rate.oninput=renderRate;
elements.text.oninput=renderCounter;
// Ctrl+Enter or Cmd+Enter in the text field is the keyboard path to Generate.
elements.text.onkeydown=event=>{
 if(event.key!=='Enter'||!(event.ctrlKey||event.metaKey)||event.shiftKey||event.altKey||event.isComposing)return;
 event.preventDefault();
 if(!state.busy&&state.manifest)generate({autoplay:true}).catch(()=>{});
};
// Examples follow the chosen speech language and replace the draft only.
for(const button of document.querySelectorAll('[data-example]'))button.onclick=()=>{elements.text.value=exampleText(elements.language.value,button.dataset.example);renderCounter();};
elements['outputs-clear'].onclick=()=>{clearOutputs();$('outputs-title').focus();};
for(const button of document.querySelectorAll('[data-locale]'))button.onclick=()=>setLocale(button.dataset.locale);
elements['metrics-export'].onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state.metrics,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=t('metrics.exportFilename');a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
new ResizeObserver(draw).observe(elements.waveform);

state.locale=storedLocale();t=createTranslator(state.locale);
elements.text.value=t(SAMPLE_KEYS[state.locale]);
renderAll();
// The exported WAV file of a listed output, as the download link gives it.
async function wavOf(id=state.selected){
 const output=state.outputs.find(item=>item.id===id);if(!output)throw Error('UNKNOWN_OUTPUT:'+id);
 return await(await fetch(output.url)).arrayBuffer();
}
window.tts={synthesize:generate,cancel,detect,wav:wavOf,status:()=>({busy:state.busy,ready:Boolean(state.manifest),locale:state.locale,message:elements.status.textContent,load:state.load,outputs:state.outputs.length,selected:state.selected,
 marking:{mode:markingMode(),...(watermarking()?{method:state.manifest.marking.method,error:state.statusError&&['error.marking','error.markingLoad'].includes(state.status.key)?elements.status.textContent:null}:{})}}),metrics:()=>state.metrics,setLocale,getLocale:()=>state.locale,outputs:()=>state.outputs.map(outputSummary),selectOutput,clearOutputs};

try{
 const response=await fetch('/manifest.json');
 if(!response.ok)throw Error('Die Runtime wird noch vorbereitet. Bitte gleich neu laden.');
 state.manifest=await response.json();
 if(!state.manifest.models)throw Error(state.manifest.error||'Runtime unvollständig');
 renderModels();renderMethod();
 // An English interface starts with the first model that speaks English.
 const english=families().find(family=>state.manifest.models[family].languages.includes('en'));
 if(state.locale==='en'&&english){elements.model.value=english;elements.language.value='en';}
 state.loadNote={key:'loading.noteBudget',params:{size:MB(state.manifest.totalBytes)}};
 updateVoices();renderBusy();
}catch(error){
 const described=describeError(error.message,t);
 state.loadError=described;renderLoading();
 setStatus(described.key,described.params,true);
}
