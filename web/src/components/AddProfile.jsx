import { useState } from 'react';

export default function AddProfile({ busy, onAdd }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [serverType, setServerType] = useState('ase');
  const [label, setLabel] = useState('');

  const submit = () => {
    onAdd({ connectSid: token, serverType, label: label.trim() });
    setToken('');
    setLabel('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="add-profile" onClick={() => setOpen(true)}>
        + Add a profile
      </button>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>New profile</h2>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <label className="field">
        <span className="field-label">Session cookie (connect.sid)</span>
        <input
          type="password"
          className="input mono"
          placeholder="s:xxxxx.yyyyy or s%3Axxxxx.yyyyy"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="hint">
          On xm100.vn open devtools → Application → Cookies → <code>connect.sid</code>. Paste the
          value in whichever form you copied it; it gets normalised. The account name is read back
          from the site as soon as you add it.
        </p>
      </label>

      <div className="field-grid">
        <label className="field">
          <span className="field-label">Server type</span>
          <select className="input" value={serverType} onChange={(e) => setServerType(e.target.value)}>
            <option value="ase">ase (Survival Evolved)</option>
            <option value="asa">asa (Survival Ascended)</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Display name (optional)</span>
          <input
            className="input"
            placeholder="Defaults to the account name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </div>

      <div className="actions">
        <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={submit}>
          Add profile
        </button>
      </div>
    </section>
  );
}
