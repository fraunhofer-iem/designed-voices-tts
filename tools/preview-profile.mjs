// What a preview or package serves, so the browser checks can address the models it has.
// The published build serves German Kale and Voca64. Other configurations serve German Kale with an
// English Kale family: our own English fit (kale-fresh-en), with or without Voca64, or the public
// English model (kale-en). Everything else in the checks is the same.
//   const P=await previewProfile(process.env.PREVIEW_URL)
const ORDER=['kale','kale-fresh-en','kale-en','voca64'];
const ENGLISH_KALE=['kale-fresh-en','kale-en'];
// The first voice of the English checks and a second one, per English family.
const ENGLISH_VOICES={voca64:['fresh-en-f03','fresh-en-f14'],'kale-fresh-en':['fresh-en-f03','fresh-en-m08'],'kale-en':['kale-en-f01','kale-en-m01']};
const pick=(family,voice)=>({family,voice});

export async function previewProfile(url='http://127.0.0.1:8894/'){
 const response=await fetch(new URL('manifest.json',url));
 if(!response.ok)throw Error('PREVIEW_MANIFEST_UNAVAILABLE:'+response.status);
 return profileOf(await response.json());
}

export function profileOf(manifest){
 const families=ORDER.filter(family=>manifest.models[family]),has=family=>families.includes(family);
 const englishKale=ENGLISH_KALE.filter(has);
 if(!has('kale')||englishKale.length>1||!(has('voca64')||englishKale.length))throw Error('UNSUPPORTED_FAMILY_SET:'+families.join('+'));
 const speaking=lang=>families.filter(family=>manifest.models[family].languages.includes(lang));
 const voices=(family,lang)=>manifest.models[family].voices.filter(voice=>voice.includes('-'+lang+'-'));
 const name=family=>family==='voca64'?'Voca64':ENGLISH_KALE.includes(family)?'Kale Nano EN':englishKale.length?'Kale Nano DE':'Kale Nano';
 // English: Voca64 while it is served (the published build), otherwise the English Kale family.
 const englishFamily=has('voca64')?'voca64':englishKale[0];
 const english=pick(englishFamily,ENGLISH_VOICES[englishFamily][0]),englishSecond=pick(englishFamily,ENGLISH_VOICES[englishFamily][1]);
 // One voice per English-speaking family, the check voice of each.
 const englishEach=speaking('en').map(family=>pick(family,ENGLISH_VOICES[family][0]));
 // A second German voice: of the other German family if there is one, otherwise of Kale itself.
 const germanOther=has('voca64')?pick('voca64','fresh-de-m02'):pick('kale','fresh-de-m07');
 const germanCompare=has('voca64')?pick('voca64','fresh-de-f05'):pick('kale','fresh-de-f14');
 const code=voice=>voice.split('-')[2];
 const voiceText=(voice,locale)=>(locale==='en'?(code(voice)[0]==='f'?'Female voice ':'Male voice '):(code(voice)[0]==='f'?'Weibliche Stimme ':'Männliche Stimme '))+code(voice).slice(1);
 const languageText=voice=>voice.split('-')[1]==='en'?'English':null;
 return {manifest,families,has,speaking,voices,name,
  german:pick('kale','fresh-de-f01'),germanOther,germanCompare,english,englishSecond,englishFamily,englishEach,englishKale:englishKale[0]||null,
  // A comparison voice of another family restarts a session; within one family it does not.
  crossFamilyGerman:germanCompare.family!=='kale',
  // The English Kale model gives every token at least one frame; the other models leave tokens silent.
  everyTokenTimed:family=>family==='kale-en',
  voiceText,languageText,graphSize:family=>(manifest.models[family].graphBytes/1e6).toFixed(1)+' MB · ONNX'};
}
