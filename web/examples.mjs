// Example sentences per speech language. They are speech content, not interface
// copy: the German ones stay German in the English interface and vice versa.
// Each kind exercises one thing the reading display makes visible.

export const EXAMPLE_KINDS = Object.freeze(['plain', 'question', 'time', 'amount', 'abbreviation']);

export const EXAMPLES = Object.freeze({
  de: Object.freeze({
    plain: 'Der Zug nach Hamburg fährt heute von Gleis sieben ab.',
    question: 'Können Sie mir sagen, wo ich den Fahrplan finde?',
    time: 'Der Kurs beginnt am 3. Februar 2027 um 14:30 Uhr.',
    amount: 'Die Fahrkarte kostet 18,40 €.',
    abbreviation: 'Die Sitzung der AG dauert ca. 2 Std., ggf. länger.'
  }),
  en: Object.freeze({
    plain: 'The train to Boston leaves from platform seven today.',
    question: 'Can you tell me where to find the timetable?',
    time: 'The course starts on February 3, 2027 at 2:30 p.m.',
    amount: 'The ticket costs $18.40.',
    abbreviation: 'The office is on Main St. near the UN building.'
  })
});

export function exampleText(lang, kind) {
  const text = EXAMPLES[lang]?.[kind];
  if (typeof text !== 'string') throw Error('UNKNOWN_EXAMPLE:' + lang + ':' + kind);
  return text;
}
