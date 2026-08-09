import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import AddProfile from './components/AddProfile.jsx';
import LogTable from './components/LogTable.jsx';
import ProfileCard from './components/ProfileCard.jsx';
import ScheduleBar from './components/ScheduleBar.jsx';

const POLL_MS = 10_000;

export default function App() {
  const [data, setData] = useState(null);
  const [entries, setEntries] = useState([]);
  const [filters, setFilters] = useState({ outcome: '', profileId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [status, logs] = await Promise.all([api.status(), api.logs(filters)]);
      setData(status);
      setEntries(logs.entries);
      setError('');
    } catch (err) {
      setError(`Can't reach the AutoClaim service: ${err.message}`);
    }
  }, [filters]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const profiles = data?.profiles ?? [];

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>AutoClaim</h1>
          <p className="subtitle">Daily attendance on xm100.vn</p>
        </div>
        {data && (
          <div className="header-meta">
            <span className="mono">{data.scheduler.today}</span>
            <span className="sep">·</span>
            {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}
          </div>
        )}
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      {!data ? (
        !error && <div className="loading">Connecting…</div>
      ) : (
        <>
          <ScheduleBar
            scheduler={data.scheduler}
            busy={busy}
            onTimezone={(tz) => run(() => api.setTimezone(tz))}
          />

          {profiles.length === 0 ? (
            <p className="empty-hero">
              No profiles yet. Add one below with the account's <code>connect.sid</code> cookie and
              it will claim once a day on its own.
            </p>
          ) : (
            profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                busy={busy}
                onClaim={(force) => run(() => api.claim(profile.id, force))}
                onUpdate={(patch) => run(() => api.updateProfile(profile.id, patch))}
                onRefresh={() => run(() => api.refreshProfile(profile.id))}
                onRemove={() => run(() => api.removeProfile(profile.id))}
              />
            ))
          )}

          <AddProfile busy={busy} onAdd={(profile) => run(() => api.addProfile(profile))} />

          <LogTable
            entries={entries}
            stats={data.stats}
            profiles={profiles}
            filters={filters}
            onFilters={setFilters}
            onClear={() => run(() => api.clearLogs())}
          />
        </>
      )}
    </div>
  );
}
