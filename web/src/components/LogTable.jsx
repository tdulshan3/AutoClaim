import { useState } from 'react';

const OUTCOMES = [
  { value: '', label: 'All' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'already', label: 'Already' },
  { value: 'unlinked', label: 'Unlinked' },
  { value: 'failed', label: 'Failed' },
  { value: 'auth', label: 'Auth' },
];

const TONE = { claimed: 'ok', already: 'ok', unlinked: 'warn', failed: 'bad', auth: 'bad' };

function formatStamp(iso) {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
}

function prettyRaw(raw) {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function LogTable({ entries, stats, profiles, filters, onFilters, onClear }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Log</h2>
        <span className="muted">
          {stats.claimed} claimed · {stats.already} already
          {stats.unlinked > 0 && ` · ${stats.unlinked} unlinked`} · {stats.failed} failed
        </span>
      </div>

      <div className="toolbar">
        <div className="filters">
          {OUTCOMES.map((option) => (
            <button
              key={option.value || 'all'}
              className={`chip ${filters.outcome === option.value ? 'chip-on' : ''}`}
              onClick={() => onFilters({ ...filters, outcome: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          {profiles.length > 1 && (
            <select
              className="input input-sm"
              value={filters.profileId}
              onChange={(e) => onFilters({ ...filters, profileId: e.target.value })}
            >
              <option value="">All profiles</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-ghost" onClick={onClear}>
            Clear log
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="empty">Nothing logged yet. Attempts show up here as they happen.</p>
      ) : (
        <ul className="log">
          {entries.map((entry) => {
            const isOpen = expanded === entry.id;
            return (
              <li key={entry.id} className="log-row">
                <button className="log-main" onClick={() => setExpanded(isOpen ? null : entry.id)}>
                  <span className={`pill pill-${TONE[entry.outcome] || 'idle'}`}>{entry.outcome}</span>
                  <span className="log-when mono">{formatStamp(entry.at)}</span>
                  <span className="log-who">{entry.profileName}</span>
                  <span className="log-day mono muted">{entry.day}</span>
                  <span className="log-message">{entry.message}</span>
                  <span className="log-status mono muted">{entry.status || '—'}</span>
                  <span className={`caret ${isOpen ? 'caret-open' : ''}`}>›</span>
                </button>

                {isOpen && (
                  <div className="log-detail">
                    <dl className="detail-facts">
                      <div>
                        <dt>Triggered by</dt>
                        <dd>{entry.kind === 'auto' ? 'Schedule' : 'Manual'}</dd>
                      </div>
                      <div>
                        <dt>Server type</dt>
                        <dd className="mono">{entry.serverType}</dd>
                      </div>
                      {entry.originalMessage && entry.originalMessage !== entry.message && (
                        <div>
                          <dt>Server said</dt>
                          <dd>{entry.originalMessage}</dd>
                        </div>
                      )}
                    </dl>
                    <pre className="raw">
                      {prettyRaw(entry.raw) || 'No response body was returned.'}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
