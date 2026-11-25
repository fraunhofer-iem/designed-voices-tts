import {test,expect} from 'bun:test';
import {describeError,translateDetail} from '../web/errors.mjs';
import {createTranslator} from '../web/i18n.mjs';

const de=createTranslator('de'),en=createTranslator('en');
const errorText=(message,tr)=>{const described=describeError(message,tr);return tr(described.key,described.params);};

test('engine and loader messages get a localized user-facing summary',()=>{
 expect(errorText('Ungültige Modell-/Sprachauswahl.',de)).toBe('Die gewählte Kombination aus Modell, Sprache und Stimme ist ungültig.');
 expect(errorText('Ungültige Modell-/Sprachauswahl.',en)).toBe('The selected combination of model, language and voice is invalid.');
 expect(errorText('Bitte 1 bis 500 Zeichen eingeben.',en)).toBe('Enter 1 to 500 characters.');
 expect(errorText('Der Text enthält nichts Aussprechbares.',de)).toBe('Der Text enthält nichts Aussprechbares.');
 expect(errorText('Bitte den Text auf weniger als eine Minute Sprache kürzen.',en)).toBe('The text is too long for audio of up to one minute.');
 expect(errorText('Der Abschnitt überschreitet die sichere Audiolänge.',en)).toBe('A segment exceeds the safe audio length.');
 expect(errorText('Das Modell hat ungültiges Audio geliefert.',en)).toBe('The model returned invalid audio.');
 expect(errorText('Worker konnte nicht gestartet werden.',de)).toContain('Worker');
 expect(errorText('Die Runtime wird noch vorbereitet. Bitte gleich neu laden.',en)).toBe('The runtime is still being prepared. Reload in a moment.');
 expect(errorText('Runtime unvollständig',de)).toBe('Die Laufzeit ist unvollständig.');
});

test('speaking-rate and comparison failures name the problem and the way out',()=>{
 expect(errorText('Ungültiges Sprechtempo.',de)).toBe('Das Sprechtempo liegt außerhalb des zulässigen Bereichs.');
 expect(errorText('Ungültiges Sprechtempo.',en)).toBe('The speaking rate is outside the allowed range.');
 expect(errorText('Bei diesem Sprechtempo wird das Audio länger als eine Minute.',de)).toBe('Bei diesem Sprechtempo wird das Audio länger als eine Minute. Bitte ein höheres Tempo wählen oder den Text kürzen.');
 expect(errorText('Bei diesem Sprechtempo wird das Audio länger als eine Minute.',en)).toBe('At this speaking rate the audio would be longer than one minute. Choose a higher rate or shorten the text.');
 expect(errorText('Der Abschnitt überschreitet bei diesem Sprechtempo die sichere Audiolänge.',en)).toBe('At this speaking rate a segment exceeds the safe audio length. Choose a higher rate or shorten the text.');
 expect(errorText('Der Abschnitt überschreitet bei diesem Sprechtempo die sichere Audiolänge.',de)).toContain('Sprechtempo');
 expect(errorText('Ungültige Vergleichsstimme.',en)).toBe('The comparison voice does not match the selected speech language.');
 expect(errorText('Ungültige Vergleichsstimme.',de)).toBe('Die Vergleichsstimme passt nicht zur gewählten Sprache.');
});

test('asset failures keep the offending file name in both languages',()=>{
 const download=describeError('Download fehlgeschlagen: kale.plan.onnx',en);
 expect(download.key).toBe('error.download');
 expect(en(download.key,download.params)).toBe('File could not be downloaded: kale.plan.onnx');
 expect(errorText('Prüfsumme stimmt nicht: voca64.wave.onnx',de)).toBe('Prüfsumme stimmt nicht: voca64.wave.onnx');
 expect(errorText('Unknown asset: quickjs.wasm',de)).toBe('Unbekannte Datei im Modellpaket: quickjs.wasm');
 expect(errorText('English frontend: boom',en)).toBe('English frontend error: boom');
 expect(errorText('ENGLISH_DEADLINE',de)).toContain('Zeitlimit');
});

test('unknown technical errors are not swallowed',()=>{
 const described=describeError('Some internal failure 42',en);
 expect(described.key).toBe('error.unknown');
 expect(described.detail).toBe('Some internal failure 42');
 expect(en(described.key,described.params)).toBe('Unexpected error: Some internal failure 42');
 expect(errorText('Some internal failure 42',de)).toBe('Unerwarteter Fehler: Some internal failure 42');
 expect(errorText(Error('nope'),en)).toBe('Unexpected error: nope');
});

test('worker progress details are localized by pattern',()=>{
 expect(translateDetail('Frontend und Modell laden',en)).toBe('Loading frontend and model');
 expect(translateDetail('Frontend und Modell laden',de)).toBe('Frontend und Modell laden');
 expect(translateDetail('Abschnitt 2 / 5',en)).toBe('Segment 2 / 5');
 expect(translateDetail('Abschnitt 2 / 5',de)).toBe('Abschnitt 2 / 5');
 expect(translateDetail('',en)).toBe('');
 expect(translateDetail('unmapped detail',de)).toBe('unmapped detail');
});

test('a marker that cannot be loaded or applied has its own plain message in both languages',async()=>{
 const {createTranslator}=await import('../web/i18n.mjs');
 for(const [message,key] of [['Das Wasserzeichen konnte nicht eingefügt werden.','error.marking'],['Das Wasserzeichen konnte nicht geladen werden.','error.markingLoad']]){
  const described=describeError(message);expect(described.key).toBe(key);
  expect(createTranslator('en')(key)).toContain('No output was produced.');expect(createTranslator('de')(key)).toContain('Es wurde keine Ausgabe erzeugt.');
 }
});
