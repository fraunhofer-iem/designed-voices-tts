import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const directory=process.env.PROOF_DIR||'artifacts/branding-proof';
const url=process.env.PREVIEW_URL||'http://127.0.0.1:8894/';
const expected=new Bun.CryptoHasher('sha256').update(await Bun.file('web/brand/fraunhofer-iem.png').arrayBuffer()).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await mkdir(directory,{recursive:true});const results=[];
 for(const [locale,width,height] of [['de',1440,1100],['en',390,844]]){
  const page=await browser.newPage({viewport:{width,height}}),external=[];
  page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.goto(url);await page.waitForFunction(()=>window.tts?.status().ready);
  await page.evaluate(locale=>window.tts.setLocale(locale),locale);
  const result=await page.evaluate(async()=>{
   const footer=document.querySelector('footer'),link=footer.querySelector('.institute-logo'),image=link?.querySelector('img');
   if(!image)throw Error('INSTITUTE_LOGO_MISSING');await image.decode();
   const box=image.getBoundingClientRect(),bounds=footer.getBoundingClientRect(),style=getComputedStyle(footer);
   const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');
   const cornerAlpha=[[0,0],[image.naturalWidth-1,0],[0,image.naturalHeight-1],[image.naturalWidth-1,image.naturalHeight-1]].map(([x,y])=>{context.clearRect(0,0,1,1);context.drawImage(image,x,y,1,1,0,0,1,1);return context.getImageData(0,0,1,1).data[3];});
   return {header:document.querySelector('header').innerText,footer:footer.innerText,intro:document.querySelector('[data-i18n="intro.body"]').innerText,
    href:link.href,alt:image.alt,cornerAlpha,encoded:image.currentSrc,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,
    ratio:box.width/box.height,rightOffset:bounds.right-parseFloat(style.paddingRight)-box.right,
    lastContent:[...footer.children].every(node=>node.getBoundingClientRect().bottom<=box.bottom+1),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const hash=new Bun.CryptoHasher('sha256').update(Buffer.from(result.encoded.split(',')[1]||'','base64')).digest('hex');
  if(hash!==expected||!result.encoded.startsWith('data:image/png;base64,'))throw Error('LOGO_BYTES_CHANGED_OR_REMOTE');delete result.encoded;
  if(result.cornerAlpha.some(alpha=>alpha!==0))throw Error('WHITE_LOGO_BACKGROUND');
  if(result.href!=='https://www.iem.fraunhofer.de/'||result.alt!=='Fraunhofer IEM'||Math.abs(result.ratio-3000/825)>.01||Math.abs(result.rightOffset)>1||!result.lastContent||result.overflow)throw Error('LOGO_LAYOUT:'+JSON.stringify(result));
  if(result.header.includes('ENGAGE')||!result.footer.includes('ENGAGE-KI')||!result.footer.includes('(BMFTR)')||!result.footer.includes('(PTKA)'))throw Error('BRANDING_SCOPE_CHANGED');
  if(result.intro!==(locale==='de'?'Text eingeben, Modell und Stimme wählen. Die Sprache wird lokal im Browser erzeugt.':'Enter text, choose a model and a voice. Speech is generated locally in your browser.'))throw Error('UNNATURAL_LOCAL_COPY');
  await page.context().setOffline(true);await page.locator('.institute-logo img').evaluate(image=>image.decode());
  await page.locator('footer').screenshot({path:`${directory}/${locale}-footer.png`});await page.screenshot({path:`${directory}/${locale}-page.png`,fullPage:true});
  if(external.length)throw Error('EXTERNAL_ASSET_REQUEST:'+external.join(','));
  results.push({locale,width,sha256:hash,...result,offlineLogo:true,externalRequests:external});await page.close();
 }
 await writeFile(directory+'/RESULT.json',JSON.stringify(results,null,2)+'\n');console.log('PASS: transparent logo bottom-right, DE/EN natural copy, local/offline asset, funding intact');
}finally{await browser.close();}
