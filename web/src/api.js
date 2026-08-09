async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const api = {
  status: () => request('/status'),
  setTimezone: (timezone) => request('/timezone', { method: 'POST', body: { timezone } }),

  addProfile: (profile) => request('/profiles', { method: 'POST', body: profile }),
  updateProfile: (id, patch) => request(`/profiles/${id}`, { method: 'PATCH', body: patch }),
  removeProfile: (id) => request(`/profiles/${id}`, { method: 'DELETE' }),
  refreshProfile: (id) => request(`/profiles/${id}/refresh`, { method: 'POST' }),
  claim: (id, force = false) => request(`/profiles/${id}/claim`, { method: 'POST', body: { force } }),

  logs: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value),
    ).toString();
    return request(`/logs${query ? `?${query}` : ''}`);
  },
  clearLogs: () => request('/logs', { method: 'DELETE' }),
};
