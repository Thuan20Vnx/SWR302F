const DEVICE_ID_KEY = 'hachimi-device-id';

export function getDeviceId() {
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
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Không kết nối được máy chủ' } };
  }
}

export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.getElementById('google-identity-script');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts?.id));
    script.onerror = () => resolve(false);
    document.head.append(script);
    setTimeout(() => resolve(Boolean(window.google?.accounts?.id)), 8000);
  });
}
