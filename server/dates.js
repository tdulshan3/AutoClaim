/**
 * Every "day" in this app is a calendar day in the *server's* timezone
 * (Asia/Ho_Chi_Minh by default), not the machine's. Getting this wrong means
 * claiming at the wrong time, or thinking a day was missed when it wasn't.
 */

/** 'YYYY-MM-DD' for the given instant in the given zone. */
export function dayIn(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Wall-clock 'HH:MM:SS' in the given zone. */
export function timeIn(timezone, instant = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(instant);
}

/** Milliseconds until the next midnight in the given zone. */
export function msUntilNextDay(timezone, instant = new Date()) {
  const [h, m, s] = timeIn(timezone, instant).split(':').map(Number);
  const elapsed = ((h * 60 + m) * 60 + s) * 1000;
  return 86_400_000 - elapsed;
}
