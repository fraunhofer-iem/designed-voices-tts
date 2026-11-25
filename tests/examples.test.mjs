import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {EXAMPLES,EXAMPLE_KINDS,exampleText} from '../web/examples.mjs';
import {LOCALES,hasMessage,translate} from '../web/i18n.mjs';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');

test('each speech language has one example per kind',()=>{
 expect(EXAMPLE_KINDS).toEqual(['plain','question','time','amount','abbreviation']);
 expect(Object.keys(EXAMPLES).sort()).toEqual(['de','en']);
 for(const lang of ['de','en']){
  expect(Object.keys(EXAMPLES[lang])).toEqual(EXAMPLE_KINDS);
  for(const kind of EXAMPLE_KINDS){
   const text=exampleText(lang,kind);
   expect(text.trim()).toBe(text);
   expect(text.length).toBeGreaterThan(10);
   expect(text.length).toBeLessThanOrEqual(120);
  }
 }
 const all=['de','en'].flatMap(lang=>Object.values(EXAMPLES[lang]));
 expect(new Set(all).size).toBe(10);
});

test('the kinds show what they are named after',()=>{
 expect(EXAMPLES.de.question.endsWith('?')).toBe(true);
 expect(EXAMPLES.en.question.endsWith('?')).toBe(true);
 for(const lang of ['de','en']){
  expect(EXAMPLES[lang].plain).not.toMatch(/\d/);
  expect(EXAMPLES[lang].time).toMatch(/\d{4}.*\d{1,2}:\d{2}/);
  expect(EXAMPLES[lang].amount).toMatch(/\d[.,]\d{2}/);
  expect(EXAMPLES[lang].amount).toMatch(/[€$]/);
  expect(EXAMPLES[lang].abbreviation).toMatch(/[A-Za-z]\./);
  expect(EXAMPLES[lang].abbreviation).toMatch(/\b[A-Z]{2,}\b/);
 }
});

test('examples are not the default draft and unknown examples fail closed',()=>{
 const defaults=[translate('de','sample.text.de'),translate('en','sample.text.en')];
 for(const lang of ['de','en'])for(const text of Object.values(EXAMPLES[lang]))expect(defaults).not.toContain(text);
 expect(()=>exampleText('fr','plain')).toThrow('UNKNOWN_EXAMPLE');
 expect(()=>exampleText('de','slogan')).toThrow('UNKNOWN_EXAMPLE');
});

test('the page has one labelled button per kind',()=>{
 const kinds=[...html.matchAll(/data-example="([^"]+)"/g)].map(match=>match[1]);
 expect(kinds).toEqual(EXAMPLE_KINDS);
 for(const kind of EXAMPLE_KINDS)for(const locale of LOCALES)expect(hasMessage(locale,'example.'+kind)).toBe(true);
 expect(html).not.toContain('id="example-de"');
 expect(html).not.toContain('id="example-en"');
});
