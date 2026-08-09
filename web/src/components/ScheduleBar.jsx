import { useEffect, useState } from 'react';

const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'America/Toronto',
  'America/Vancouver',
  'UTC',
];

function formatDuration(ms) {
  if (ms <= 0) return 'any moment';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

/** Counts down locally between polls so the number doesn't sit still. */
function useCountdown(baseMs) {
  const [remaining, setRemaining] = useState(baseMs);

  useEffect(() => {
    setRemaining(baseMs);
    const startedAt = Date.now();
    const id = setInterval(() => setRemaining(baseMs - (Date.now() - startedAt)), 30_000);
    return () => clearInterval(id);
  }, [baseMs]);

  return remaining;
}

export default function ScheduleBar({ scheduler, busy, onTimezone }) {
  const untilNextDay = useCountdown(scheduler.msUntilNextDay);

  return (
    <section className="card schedule">
      <div className="schedule-facts">
        <div>
          <dt>Attendance day</dt>
          <dd className="mono">{scheduler.today}</dd>
        </div>
        <div>
          <dt>Next day starts in</dt>
          <dd>{formatDuration(untilNextDay)}</dd>
        </div>
        <div>
          <dt>Checks every</dt>
          <dd>{Math.round(scheduler.tickMs / 60_000)} min</dd>
        </div>
      </div>

      <label className="schedule-tz">
        <span className="field-label">Timezone</span>
        <select
          className="input"
          value={scheduler.timezone}
          disabled={busy}
          onChange={(e) => onTimezone(e.target.value)}
        >
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
