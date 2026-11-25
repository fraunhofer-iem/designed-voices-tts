// Localizes the technical messages that come back from the worker, the engine
// and the asset loader. The raw message is never discarded: unknown text is
// shown as the detail of `error.unknown`, and callers can keep it for logs.

const EXACT = new Map([
  ['Ungültige Modell-/Sprachauswahl.', 'error.selection'],
  ['Bitte 1 bis 500 Zeichen eingeben.', 'error.textLength'],
  ['Der Text enthält nichts Aussprechbares.', 'error.textUnpronounceable'],
  ['Der Abschnitt überschreitet die sichere Audiolänge.', 'error.chunkTooLong'],
  ['Das Modell hat ungültiges Audio geliefert.', 'error.invalidAudio'],
  ['Bitte den Text auf weniger als eine Minute Sprache kürzen.', 'error.textTooLong'],
  ['Ungültiges Sprechtempo.', 'error.rate'],
  ['Ungültige Vergleichsstimme.', 'error.compare'],
  ['Der Abschnitt überschreitet bei diesem Sprechtempo die sichere Audiolänge.', 'error.rateChunkTooLong'],
  ['Bei diesem Sprechtempo wird das Audio länger als eine Minute.', 'error.rateTooLong'],
  ['Worker konnte nicht gestartet werden.', 'error.worker'],
  ['Die Runtime wird noch vorbereitet. Bitte gleich neu laden.', 'error.runtimePending'],
  ['Runtime unvollständig', 'error.runtimeIncomplete'],
  ['ENGLISH_DEADLINE', 'error.englishDeadline'],
  ['Das Wasserzeichen konnte nicht eingefügt werden.', 'error.marking'],
  ['Das Wasserzeichen konnte nicht geladen werden.', 'error.markingLoad']
]);

const PREFIXES = [
  [/^Download fehlgeschlagen: (.+)$/, 'error.download'],
  [/^Prüfsumme stimmt nicht: (.+)$/, 'error.checksum'],
  [/^Unknown asset: (.+)$/, 'error.unknownAsset'],
  [/^English frontend: (.+)$/, 'error.englishFrontend']
];

const DETAILS = [
  [/^Frontend und Modell laden$/, 'progress.detail.loading'],
  [/^Abschnitt (\d+) \/ (\d+)$/, 'progress.detail.chunk', (match) => ({index: match[1], total: match[2]})]
];

export function describeError(message, t) {
  const text = message instanceof Error ? message.message : typeof message === 'string' ? message : String(message ?? '');
  const exact = EXACT.get(text);
  if (exact) return {key: exact, params: {}, detail: null};
  for (const [pattern, key] of PREFIXES) {
    const match = pattern.exec(text);
    if (match) return {key, params: {asset: match[1], detail: match[1]}, detail: null};
  }
  return {key: 'error.unknown', params: {detail: text}, detail: text};
}

// Worker progress details are engine-side German strings; translate the ones
// this UI knows and keep anything else verbatim as a diagnostic.
export function translateDetail(detail, t) {
  if (!detail) return '';
  for (const [pattern, key, params] of DETAILS) {
    const match = pattern.exec(detail);
    if (match) return t(key, params ? params(match) : {});
  }
  return detail;
}
