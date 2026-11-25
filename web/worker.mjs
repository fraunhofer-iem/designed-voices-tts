import {SpeechEngine} from './engine.mjs';
let engine,activeId;
self.onmessage=async({data})=>{
 const {id,request,manifest}=data;activeId=id;
 try{
  engine??=new SpeechEngine(manifest,message=>self.postMessage({id:activeId,type:'progress',...message}));
  if(data.detect){self.postMessage({id,type:'result',...await engine.detect(data.detect)});return;}
  const result=await engine.synthesize({...request,id});
  self.postMessage({id,type:'result',...result},[result.audio.buffer,...(result.marked?[result.marked.buffer]:[])]);
 }catch(error){self.postMessage({id,type:'error',error:error?.message||String(error)});}
};
