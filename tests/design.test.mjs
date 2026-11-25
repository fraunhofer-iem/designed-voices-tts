import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('../web/style.css'),html=read('../web/index.html');

test('the stylesheet stays flat: system fonts, no gradients, no remote resources',()=>{
 expect(css).not.toMatch(/gradient\(/);
 expect(css).not.toMatch(/@font-face|@import/);
 expect(css).not.toMatch(/text-shadow|backdrop-filter/);
 // The only URL is the inline arrow of the select control.
 const urls=[...css.matchAll(/url\(([^)]*)\)/g)].map(match=>match[1]);
 expect(urls.length).toBe(1);
 expect(urls[0].startsWith('"data:image/svg+xml,')).toBe(true);
 expect(css).toMatch(/font-family:ui-sans-serif,system-ui/);
 expect([...css.matchAll(/font-family:/g)].length).toBe(1);
});

test('the page loads one stylesheet and one module and nothing from elsewhere',()=>{
 expect([...html.matchAll(/<script[^>]*>/g)].map(match=>match[0])).toEqual(['<script type="module" src="/app.js">']);
 expect([...html.matchAll(/<link[^>]*>/g)].map(match=>match[0])).toEqual(['<link rel="stylesheet" href="/style.css">','<link rel="icon" href="data:,">']);
 expect(html).not.toMatch(/<iframe|<object|<embed|<video|<meter/);
 const sources=[...html.matchAll(/\ssrc="([^"]+)"/g)].map(match=>match[1]);
 expect(sources).toEqual(['/brand/fraunhofer-iem.png','/app.js']);
});

test('new controls are real form controls with labels and a live status',()=>{
 for(const id of ['text','model','language','voice','compare','rate'])expect(html).toMatch(new RegExp('<label[^>]* for="'+id+'"'));
 expect(html).toMatch(/<select id="compare">/);
 expect(html).toMatch(/<input id="rate" type="range"/);
 expect(html).toMatch(/<output id="rate-value" for="rate">/);
 expect(html).toMatch(/id="status" role="status" aria-live="polite"/);
 expect(html).toMatch(/<ul class="outputs-list" id="outputs-list" aria-label=/);
 expect(html).toMatch(/<section class="outputs" aria-labelledby="outputs-title">/);
 expect(html).toMatch(/<details><summary data-i18n="reading.phones">/);
});
