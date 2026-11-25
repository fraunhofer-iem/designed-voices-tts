import {mkdir,copyFile} from 'node:fs/promises';
// Output directory: dist, or the directory named by --out (a trial build that no preview serves yet).
const at=process.argv.indexOf('--out'),out=at<0?'dist':process.argv[at+1];
if(!out)throw Error('Usage: bun tools/build-web.mjs [--out DIRECTORY]');
await mkdir(out,{recursive:true});
const entries=['web/app.mjs','web/worker.mjs','web/marker-worker.mjs'];
if(await Bun.file('web/english.mjs').exists())entries.push('web/english.mjs');
const result=await Bun.build({entrypoints:entries,outdir:out,target:'browser',format:'esm',minify:true,external:['/assets/*','/english.js']});
if(!result.success)throw new AggregateError(result.logs,'Web build failed');
const html=await Bun.file('web/index.html').text();
const logo=Buffer.from(await Bun.file('web/brand/fraunhofer-iem.png').arrayBuffer()).toString('base64');
await Bun.write(out+'/index.html',html.replace('src="/brand/fraunhofer-iem.png"',`src="data:image/png;base64,${logo}"`));
await copyFile('web/style.css',out+'/style.css');
console.log('Built',result.outputs.map(x=>x.path).join(', '));
