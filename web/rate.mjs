// Speaking rate. The planner predicts an integer frame count per token; the
// rate rescales those counts before the waveform model runs. Rates are handled
// as integer hundredths so 0.75 or 1.05 never drift through binary fractions.

export const RATE_MIN = 0.75;
export const RATE_MAX = 1.5;
export const RATE_STEP = 0.05;
export const RATE_DEFAULT = 1;
export const RATE_ERROR = 'Ungültiges Sprechtempo.';

// Accepts a number on the 0.05 grid between 0.75 and 1.5 and returns integer
// hundredths. A missing value means the default rate. Anything else fails
// closed instead of being snapped to a neighbouring rate.
export function rateHundredths(value) {
  if (value === undefined || value === null) return 100;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(RATE_ERROR);
  const hundredths = Math.round(value * 100);
  if (Math.abs(value * 100 - hundredths) > 1e-6) throw Error(RATE_ERROR);
  if (hundredths < 75 || hundredths > 150 || hundredths % 5 !== 0) throw Error(RATE_ERROR);
  return hundredths;
}

// round(d / rate) with halves rounded up. Tokens the planner gave no frame stay
// silent; tokens that had at least one frame keep at least one. At the default
// rate the planner's own array is returned untouched.
export function scaleDurations(durations, hundredths) {
  if (!Number.isInteger(hundredths) || hundredths < 75 || hundredths > 150) throw Error(RATE_ERROR);
  if (hundredths === 100) return durations;
  return durations.map((frames) => {
    if (!Number.isInteger(frames) || frames < 0) throw Error('INVALID_DURATION');
    return frames === 0 ? 0 : Math.max(1, Math.round(frames * 100 / hundredths));
  });
}

export const totalFrames = (durations) => durations.reduce((sum, frames) => sum + frames, 0);
