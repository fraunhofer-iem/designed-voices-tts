import {test,expect} from 'bun:test';
import {profileOf} from '../tools/preview-profile.mjs';

// Manifests of the two qualified configurations, reduced to what the checks read.
const voices=(prefix,lang,codes)=>codes.map(code=>prefix+'-'+lang+'-'+code);
const kale={languages:['de'],voices:voices('fresh','de',['f01','f14','m07','m08']),graphBytes:31890780,vocabulary:{version:'phony-atomic-v1'}};
const voca={languages:['de','en'],voices:[...voices('fresh','de',Array.from({length:32},(_,i)=>(i<16?'f':'m')+String(i%16+1).padStart(2,'0'))),...voices('fresh','en',Array.from({length:32},(_,i)=>(i<16?'f':'m')+String(i%16+1).padStart(2,'0')))],graphBytes:21485411};
const english={languages:['en'],voices:voices('kale','en',['f01','f02','f03','f04','m01','m02','m03','m04']),graphBytes:14617279,vocabulary:{version:'kokoro-native-en-us'}};

test('the published build keeps its models, voices and names',()=>{
 const P=profileOf({models:{voca64:voca,kale}});
 expect(P.families).toEqual(['kale','voca64']);
 expect([P.name('kale'),P.name('voca64')]).toEqual(['Kale Nano','Voca64']);
 expect(P.english).toEqual({family:'voca64',voice:'fresh-en-f03'});
 expect(P.englishSecond).toEqual({family:'voca64',voice:'fresh-en-f14'});
 expect(P.germanOther).toEqual({family:'voca64',voice:'fresh-de-m02'});
 expect(P.germanCompare).toEqual({family:'voca64',voice:'fresh-de-f05'});
 expect(P.crossFamilyGerman).toBe(true);
 expect([P.speaking('de'),P.speaking('en')]).toEqual([['kale','voca64'],['voca64']]);
 expect(P.everyTokenTimed('voca64')||P.everyTokenTimed('kale')).toBe(false);
});

test('the two Kale families: literal DE and EN names, English from the English Kale model',()=>{
 const P=profileOf({models:{kale,'kale-en':english}});
 expect(P.families).toEqual(['kale','kale-en']);
 expect([P.name('kale'),P.name('kale-en')]).toEqual(['Kale Nano DE','Kale Nano EN']);
 expect(P.english).toEqual({family:'kale-en',voice:'kale-en-f01'});
 expect(P.germanCompare).toEqual({family:'kale',voice:'fresh-de-f14'});
 expect(P.crossFamilyGerman).toBe(false);
 expect([P.speaking('de'),P.speaking('en')]).toEqual([['kale'],['kale-en']]);
 expect(P.voices('kale-en','en').length).toBe(8);
 expect(P.everyTokenTimed('kale-en')).toBe(true);
 expect([P.voiceText('kale-en-m03','de'),P.voiceText('kale-en-f02','en')]).toEqual(['Männliche Stimme 03','Female voice 02']);
 expect(P.graphSize('kale-en')).toBe('14.6 MB · ONNX');
});

const fresh={languages:['en'],voices:voices('fresh','en',['f03','f14','m03','m08']),graphBytes:16821784,vocabulary:{version:'phony-atomic-v1'}};

test('German Kale with our English Kale fit: DE and EN names, English from that family',()=>{
 const P=profileOf({models:{kale,'kale-fresh-en':fresh}});
 expect(P.families).toEqual(['kale','kale-fresh-en']);
 expect([P.name('kale'),P.name('kale-fresh-en')]).toEqual(['Kale Nano DE','Kale Nano EN']);
 expect([P.english,P.englishSecond]).toEqual([{family:'kale-fresh-en',voice:'fresh-en-f03'},{family:'kale-fresh-en',voice:'fresh-en-m08'}]);
 expect(P.englishKale).toBe('kale-fresh-en');
 expect(P.crossFamilyGerman).toBe(false);
 expect([P.speaking('de'),P.speaking('en')]).toEqual([['kale'],['kale-fresh-en']]);
 expect(P.voices('kale-fresh-en','en')).toEqual(['fresh-en-f03','fresh-en-f14','fresh-en-m03','fresh-en-m08']);
 // German family type: stress marks get no time, so not every token is timed.
 expect(P.everyTokenTimed('kale-fresh-en')).toBe(false);
 expect([P.voiceText('fresh-en-m08','de'),P.voiceText('fresh-en-f14','en')]).toEqual(['Männliche Stimme 08','Female voice 14']);
});

test('all three: Voca64 stays the English check family, every English family has a check voice',()=>{
 const P=profileOf({models:{voca64:voca,kale,'kale-fresh-en':fresh}});
 expect(P.families).toEqual(['kale','kale-fresh-en','voca64']);
 expect(P.families.map(P.name)).toEqual(['Kale Nano DE','Kale Nano EN','Voca64']);
 expect(P.english).toEqual({family:'voca64',voice:'fresh-en-f03'});
 expect(P.englishEach).toEqual([{family:'kale-fresh-en',voice:'fresh-en-f03'},{family:'voca64',voice:'fresh-en-f03'}]);
 expect(P.germanCompare).toEqual({family:'voca64',voice:'fresh-de-f05'});
 expect([P.speaking('de'),P.speaking('en')]).toEqual([['kale','voca64'],['kale-fresh-en','voca64']]);
});

test('a build without German Kale or without an English model is not a qualified configuration',()=>{
 expect(()=>profileOf({models:{voca64:voca}})).toThrow('UNSUPPORTED_FAMILY_SET');
 expect(()=>profileOf({models:{kale}})).toThrow('UNSUPPORTED_FAMILY_SET');
 expect(()=>profileOf({models:{kale,'kale-en':english,'kale-fresh-en':fresh}})).toThrow('UNSUPPORTED_FAMILY_SET');
});
