import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {LOCALES,TRUSTED_HTML_KEYS,createTranslator,hasMessage,isLocale,isTrustedHtmlKey,messageKeys,normalizeLocale,translate} from '../web/i18n.mjs';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const funding=readFileSync(new URL('../docs/funding.md',import.meta.url),'utf8');
const keys=locale=>messageKeys(locale);
const allKeys=[...new Set([...keys('de'),...keys('en')])];
const hrefs=attribute=>[...html.matchAll(new RegExp(attribute+'="([^"]+)"','g'))].map(match=>match[1]);

test('German and English are complete translations of the same messages',()=>{
 expect(keys('de').sort()).toEqual(keys('en').sort());
 for(const locale of LOCALES)for(const key of keys(locale)){
  const value=translate(locale,key,{count:1,code:'01',language:'x',label:'x',detail:'x',asset:'x',size:'1',verified:'1',total:'1',seconds:'1',rtf:'1',factor:'1',threads:1,index:1,limit:500,rate:'1.00',model:'x',voice:'x',progress:'x'});
  expect(typeof value).toBe('string');
  expect(value.trim()).toBe(value);
  expect(value.length).toBeGreaterThan(0);
  expect(value).not.toContain('  ');
 }
});

test('unknown locales and keys fail closed instead of falling back',()=>{
 expect(isLocale('fr')).toBe(false);
 expect(()=>normalizeLocale('fr')).toThrow('UNKNOWN_LOCALE');
 expect(()=>normalizeLocale(undefined)).toThrow('UNKNOWN_LOCALE');
 expect(()=>translate('fr','brand.subtitle')).toThrow('UNKNOWN_LOCALE');
 expect(()=>createTranslator('de-DE')).toThrow('UNKNOWN_LOCALE');
 expect(()=>translate('de','no.such.key')).toThrow('MISSING_MESSAGE');
});

test('named parameters are interpolated and never silently dropped',()=>{
 expect(translate('de','loading.stateDownload',{verified:'4.2',total:'95.0'})).toBe('4.2 / 95.0 MB geprüft · Dateien werden geladen …');
 expect(translate('en','loading.stateDownload',{verified:'4.2',total:'95.0'})).toBe('4.2 / 95.0 MB verified · loading files …');
 expect(translate('de','editor.count',{count:12,limit:500})).toBe('12 / 500');
 expect(()=>translate('de','loading.stateDownload',{verified:'4.2'})).toThrow('MISSING_PARAMETER:loading.stateDownload:total');
 expect(()=>translate('en','error.unknown',{})).toThrow('MISSING_PARAMETER');
});

test('counts and plurals follow each language',()=>{
 expect(translate('de','voice.count.german',{count:1})).toBe('1 deutsche Stimme');
 expect(translate('de','voice.count.german',{count:4})).toBe('4 deutsche Stimmen');
 expect(translate('de','voice.count.english',{count:4})).toBe('4 englische Stimmen');
 expect(translate('en','voice.count.german',{count:4})).toBe('4 German voices');
 const summary={model:'Voca64',rate:'0.85×',seconds:'1.25'};
 expect(translate('en','audio.summary',{...summary,count:1})).toBe('Voca64 · 0.85× · 1.25 s · 1 segment');
 expect(translate('en','audio.summary',{...summary,count:3})).toBe('Voca64 · 0.85× · 1.25 s · 3 segments');
 expect(translate('de','audio.summary',{...summary,count:3})).toBe('Voca64 · 0.85× · 1.25 s · 3 Abschnitte');
});

test('every i18n hook in the page resolves in both languages',()=>{
 for(const key of hrefs('data-i18n'))for(const locale of LOCALES)expect(hasMessage(locale,key)).toBe(true);
 for(const key of hrefs('data-i18n-aria-label'))for(const locale of LOCALES)expect(hasMessage(locale,key)).toBe(true);
 for(const key of hrefs('data-i18n-title'))for(const locale of LOCALES)expect(hasMessage(locale,key)).toBe(true);
 for(const key of hrefs('data-i18n-html')){
  expect(isTrustedHtmlKey(key)).toBe(true);
  for(const locale of LOCALES)expect(translate(locale,key)).toContain('<');
 }
 expect(hrefs('data-i18n').length).toBeGreaterThan(20);
});

test('the German funding acknowledgement stays the approved text',()=>{
 const approved=funding.split('\n').filter(line=>line.startsWith('>')).map(line=>line.replace(/^>\s?/,'')).join(' ').replace(/https:\/\/engage-ki\.de\/\s*$/,'').replace(/\s+/g,' ').trim();
 const rendered=translate('de','funding.text').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
 expect(rendered).toBe(approved);
 expect(rendered).toContain('Bundesministerium für Forschung, Technologie und Raumfahrt');
 expect(rendered).toContain('(BMFTR)');
 expect(rendered).toContain('ENGAGE-KI');
 expect(rendered).toContain('Projektträger Karlsruhe (PTKA)');
 expect(html).toContain('https://engage-ki.de/');
 const english=translate('en','funding.text').replace(/<[^>]+>/g,'');
 expect(english).toContain('Bundesministerium für Forschung, Technologie und Raumfahrt (BMFTR)');
 expect(english).toContain('ENGAGE-KI');
 expect(english).toContain('Projektträger Karlsruhe (PTKA)');
 expect(english).not.toContain('Gefördert');
});

test('promotional copy is gone from both languages and the page',()=>{
 const banned=['Alles lokal','Dein Browser ist das Studio','Platz für deine Stimme','Nicht nur hören','Kleine Modelle','Unter die Haube','Stimmwerkstatt','Guten Morgen! Heute lassen','Hello! A small model','Was soll die Stimme sagen','All in your browser','Everything local'];
 const params={count:2,code:'01',language:'x',label:'x',detail:'x',asset:'x',size:'1',verified:'1',total:'1',seconds:'1',rtf:'1',factor:'1',threads:1,index:1,limit:500,rate:'1.00',model:'x',voice:'x',progress:'x'};
 const copy=[...LOCALES.flatMap(locale=>keys(locale).map(key=>translate(locale,key,params))),html].join('\n');
 for(const phrase of banned)expect(copy).not.toContain(phrase);
});

test('default sample copy is neutral in both languages',()=>{
 expect(translate('de','sample.text.de')).toBe('Die Besprechung beginnt um neun Uhr. Bitte schließen Sie die Tür.');
 expect(translate('en','sample.text.en')).toBe('The meeting starts at nine. Please close the door.');
});

test('document language and title are localized, and the locale switch is separate from the speech language',()=>{
 expect(translate('de','document.title')).toContain('Sprachsynthese');
 expect(translate('en','document.title')).toContain('Text-to-speech');
 expect(html).toContain('lang="de"');
 expect(html).toContain('id="locale-de"');
 expect(html).toContain('id="locale-en"');
 expect(html).toContain('aria-pressed="true"');
 expect(html).toMatch(/<header class="site-header">[\s\S]*locale-switch[\s\S]*<\/header>/);
 const header=html.match(/<header class="site-header">([\s\S]*?)<\/header>/)[1];
 expect(header).not.toMatch(/ENGAGE|engage-ki/);
 expect(header).toContain('data-i18n="brand.subtitle"');
 const footer=html.match(/<footer>([\s\S]*?)<\/footer>/)[1];
 expect(footer).toContain('ENGAGE-KI');
 expect(footer).toContain('class="institute-logo" href="https://www.iem.fraunhofer.de/"');
 expect(footer).toContain('src="/brand/fraunhofer-iem.png" alt="Fraunhofer IEM"');
 expect(translate('en','intro.body')).toContain('Speech is generated locally in your browser.');
 expect(translate('de','intro.body')).toContain('Die Sprache wird lokal im Browser erzeugt.');
 for(const locale of LOCALES)for(const key of ['intro.body','method.body2'])expect(translate(locale,key)).not.toMatch(/browser CPU|CPU des Browsers/);
 expect(html).toMatch(/<select id="language">\s*<option value="de"[^>]*>Deutsch<\/option>\s*<option value="en"[^>]*>English<\/option>/);
 expect(TRUSTED_HTML_KEYS).toEqual(['intro.title','funding.text']);
 for(const key of hrefs('data-i18n-html'))expect(TRUSTED_HTML_KEYS).toContain(key);
});

test('the new controls and the outputs list are named literally in both languages',()=>{
 const labels={
  'rate.label':['Sprechtempo','Speaking rate'],
  'compare.label':['Vergleichsstimme','Comparison voice'],
  'compare.none':['Keine','None'],
  'reading.label':['Gelesen als','Read as'],
  'reading.phones':['Lautschrift','Phonemes'],
  'outputs.title':['Ausgaben','Outputs'],
  'outputs.clear':['Liste leeren','Clear list']
 };
 for(const [key,[german,english]] of Object.entries(labels)){
  expect(translate('de',key)).toBe(german);
  expect(translate('en',key)).toBe(english);
 }
 expect(translate('de','rate.value',{rate:'0.75'})).toBe('0.75×');
 expect(translate('de','outputs.empty',{limit:8})).toBe('Noch keine Ausgaben. Die letzten 8 Ausgaben dieser Sitzung erscheinen hier.');
 expect(translate('en','outputs.empty',{limit:8})).toBe('No outputs yet. The last 8 outputs of this session appear here.');
 expect(translate('de','outputs.metaComparison',{model:'Voca64',language:'Deutsch',rate:'1.00×',seconds:'2.4'})).toBe('Voca64 · Deutsch · 1.00× · 2.4 s · Vergleichsstimme');
 expect(translate('en','outputs.meta',{model:'Kale Nano',language:'German',rate:'1.20×',seconds:'2.4'})).toBe('Kale Nano · German · 1.20× · 2.4 s');
 expect(translate('de','outputs.male',{code:'07'})).toBe('Männliche Stimme 07');
 expect(translate('de','progress.voice',{index:2,total:2,progress:'Synthese'})).toBe('Stimme 2 von 2 · Synthese');
 expect(translate('en','compare.female',{model:'Voca64',code:'05'})).toBe('Voca64 · Female voice 05');
 // The shortcut is described for assistive technology, not printed on the page.
 expect(html).toMatch(/<p class="sr-only" id="text-hint" data-i18n="editor.shortcut">/);
 expect(html).toContain('aria-describedby="text-hint"');
 expect(html).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
 expect(translate('en','editor.shortcut')).toBe('Ctrl+Enter or Cmd+Enter generates the audio.');
 expect(html).toMatch(/<input id="rate" type="range" min="0.75" max="1.5" step="0.05" value="1"/);
 expect(html).toMatch(/<label for="rate"/);
 expect(html).toMatch(/<label for="compare"/);
});
