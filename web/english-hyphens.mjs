// Word boundaries inside hyphenated words, for the English upstream Kale family only.
// Dizione reads "twenty-nine" as one word: the second part is attached, so the plan has no <sp>
// between the parts. Voca and German Kale were trained on such plans. The public English Kale model
// was trained on a frontend that writes a space there ("twˈɛnti nˈIn"); without it the two parts are
// spoken run together. With the option on, the part after a hyphen starts a new word in the plan.
// Phones, stress, linking and homograph choice are untouched: the analysis still sees an attached word.
// Pure functions: evaluated inside QuickJS with the rules, unit-tested without assets.

/**
 * Mark the units whose first word followed a hyphen. `units` come from Phonemizer.units(words) in
 * order; a unit covers one word, or several when its `word` is a phrase ("on the"). If units and
 * words do not line up, nothing is marked and the plan is the default one.
 */
export function markHyphenUnits(units, words) {
  const marks = [];
  let cursor = 0;
  for (const unit of units) {
    const parts = typeof unit.word === "string" ? unit.word.split(" ") : [];
    if (!parts.length || parts.some((part, offset) => words[cursor + offset]?.text !== part)) return false;
    marks.push(words[cursor].attach === true && words[cursor].hyphen === true);
    cursor += parts.length;
  }
  if (cursor !== words.length) return false;
  units.forEach((unit, index) => { if (marks[index]) unit.hyphen = true; });
  return true;
}

/** Dizione's `groups`, except that a unit attached by a hyphen starts its own word. */
export function boundaryGroups(units) {
  const out = [];
  for (const unit of units) {
    if (unit.attach && !unit.hyphen && out.length) out[out.length - 1] = [...out.at(-1), ...unit.phones];
    else out.push([...unit.phones]);
  }
  return out.filter((group) => group.length);
}
