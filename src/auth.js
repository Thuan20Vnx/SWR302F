const DEVICE_ID_KEY = 'swr302-device-id';

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function api(path, options = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    // Server offline: the app keeps working from localStorage.
    return { ok: false, status: 0, data: {} };
  }
}

export function initAuth({ onLogin, onLogout, onSupportPrompt }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  async function handleCredential(response) {
    const { ok, data } = await api('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        credential: response.credential,
        deviceId: getDeviceId(),
        userAgent: navigator.userAgent,
      }),
    });
    if (!ok) return;
    onLogin(data.user);
    onSupportPrompt();
  }

  function renderGoogleButton(attemptsLeft = 20) {
    if (!clientId) return;
    if (!window.google?.accounts?.id) {
      if (attemptsLeft > 0) setTimeout(() => renderGoogleButton(attemptsLeft - 1), 250);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
    });
    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-button'),
      { theme: 'outline', size: 'medium', shape: 'pill' },
    );
  }
  renderGoogleButton();

  api('/auth/me').then(({ ok, data }) => {
    if (ok) onLogin(data.user);
    else onLogout();
  });

  document.getElementById('logout-button').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    onLogout();
  };
}
