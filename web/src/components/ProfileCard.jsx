import { useState } from 'react';

const OUTCOME_COPY = {
  claimed: { label: 'Claimed today', tone: 'ok' },
  already: { label: 'Already claimed', tone: 'ok' },
  failed: { label: 'Last attempt failed', tone: 'bad' },
  auth: { label: 'Session expired', tone: 'bad' },
  unlinked: { label: 'No game account linked', tone: 'warn' },
};

function avatarUrl(account) {
  if (!account?.avatar || !account?.discordId) return null;
  return `https://cdn.discordapp.com/avatars/${account.discordId}/${account.avatar}.png?size=80`;
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

/**
 * Which game account the points land in. ARK players come in through Steam or
 * through Epic (EOS), so neither one can be assumed - and if neither is linked
 * the claim may well succeed while the points have nowhere to go, which is
 * worth saying out loud rather than leaving to be discovered in game.
 */
function PlatformRow({ account }) {
  const platforms = [
    { name: 'Steam', id: account.steamId },
    { name: 'Epic', id: account.eosId },
  ];
  const linked = platforms.filter((p) => p.id);

  return (
    <div className="platforms">
      {linked.length === 0 ? (
        <span className="platform platform-none">
          No Steam or Epic account linked, so claimed points have nowhere to go
        </span>
      ) : (
        platforms.map((platform) => (
          <span
            key={platform.name}
            className={`platform ${platform.id ? 'platform-on' : 'platform-off'}`}
            title={platform.id || `No ${platform.name} account linked`}
          >
            <strong>{platform.name}</strong>
            <span className="mono">{platform.id || 'not linked'}</span>
          </span>
        ))
      )}
    </div>
  );
}

export default function ProfileCard({ profile, busy, onClaim, onUpdate, onRefresh, onRemove }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [label, setLabel] = useState(profile.label);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const { account, status } = profile;
  const entry = status.todayEntry;
  const state = entry
    ? OUTCOME_COPY[entry.outcome] || { label: 'Not claimed yet', tone: 'idle' }
    : { label: 'Not claimed yet', tone: 'idle' };

  const avatar = avatarBroken ? null : avatarUrl(account);

  return (
    <section className="card profile">
      <div className="profile-head">
        <div className="avatar">
          {avatar ? (
            <img src={avatar} alt="" onError={() => setAvatarBroken(true)} />
          ) : (
            initials(profile.name)
          )}
        </div>

        <div className="profile-id">
          <div className="profile-name">
            {profile.name}
            {profile.authOk === false && <span className="pill pill-bad">session expired</span>}
          </div>
          <div className="profile-sub">
            {account?.nickname && account.nickname !== profile.name && (
              <>
                <span>{account.nickname}</span>
                <span className="sep">·</span>
              </>
            )}
            <span className="mono">{profile.serverType}</span>
            {account?.role && (
              <>
                <span className="sep">·</span>
                <span>{account.role}</span>
              </>
            )}
          </div>
        </div>

        <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Edit'}
        </button>
      </div>

      {account && (
        <dl className="facts facts-tight">
          <div>
            <dt>Points</dt>
            <dd>{account.points?.toLocaleString() ?? '—'}</dd>
          </div>
          <div>
            <dt>ASA points</dt>
            <dd>{account.asaPoints?.toLocaleString() ?? '—'}</dd>
          </div>
          <div>
            <dt>Xcoin</dt>
            <dd>{account.xcoin?.toLocaleString() ?? '—'}</dd>
          </div>
          <div>
            <dt>VIP ({profile.serverType})</dt>
            <dd>{(profile.serverType === 'asa' ? account.vipAsa : account.vipAse) || '—'}</dd>
          </div>
        </dl>
      )}

      {account && <PlatformRow account={account} />}

      <div className={`state state-${state.tone}`}>
        <span className="state-label">{state.label}</span>
        {entry && (
          <span className="state-detail">
            {entry.message}
            {entry.originalMessage && entry.originalMessage !== entry.message && (
              <span className="muted"> · server said “{entry.originalMessage}”</span>
            )}
          </span>
        )}
        {entry?.outcome === 'unlinked' && (
          <span className="state-detail">
            Link a Steam or Epic account on{' '}
            <a href="https://xm100.vn" target="_blank" rel="noreferrer noopener">
              xm100.vn
            </a>{' '}
            and it will claim on the next check. Retrying from here can't fix this.
          </span>
        )}
      </div>

      <div className="actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => onClaim(false)}>
          {status.inFlight ? 'Claiming…' : 'Claim now'}
        </button>
        <button
          className="btn"
          disabled={busy}
          title="Send the request even though today already looks claimed"
          onClick={() => onClaim(true)}
        >
          Force resend
        </button>
        <button className="btn" disabled={busy} onClick={onRefresh}>
          Refresh account
        </button>

        <label className="inline-toggle">
          <input
            type="checkbox"
            checked={profile.autoClaim}
            disabled={busy}
            onChange={(e) => onUpdate({ autoClaim: e.target.checked })}
          />
          Auto-claim
        </label>
      </div>

      {status.failuresToday > 0 && (
        <p className="hint">
          {status.failuresToday} of {status.maxAttempts} attempts failed today.
        </p>
      )}

      {open && (
        <div className="profile-edit">
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Display name</span>
              <div className="field-row">
                <input
                  className="input"
                  value={label}
                  placeholder={account?.username || 'Profile name'}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={busy || label === profile.label}
                  onClick={() => onUpdate({ label })}
                >
                  Save
                </button>
              </div>
            </label>

            <label className="field">
              <span className="field-label">Server type</span>
              <select
                className="input"
                value={profile.serverType}
                disabled={busy}
                onChange={(e) => onUpdate({ serverType: e.target.value })}
              >
                <option value="ase">ase (Survival Evolved)</option>
                <option value="asa">asa (Survival Ascended)</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field-label">
              Session cookie · currently <code>{profile.tokenPreview}</code>
            </span>
            <div className="field-row">
              <input
                type="password"
                className="input mono"
                placeholder="Paste a fresh connect.sid"
                value={token}
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !token.trim()}
                onClick={() => {
                  onUpdate({ connectSid: token });
                  setToken('');
                }}
              >
                Replace
              </button>
            </div>
          </label>

          <div className="danger-row">
            {confirmRemove ? (
              <>
                <span className="muted">Remove {profile.name}?</span>
                <button className="btn btn-danger" disabled={busy} onClick={onRemove}>
                  Yes, remove
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmRemove(true)}>
                Remove profile
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
