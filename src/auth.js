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

export function initAuth({ onLogin, onLogout, onSupportPrompt, onError }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const googleButton = document.getElementById('google-signin-button');
  const retryButton = document.getElementById('google-auth-retry');
  const fail = (message, detail) => {
    console.error('[auth]', message, detail ?? '');
    onError?.(message);
  };

  function showGoogleRetry() {
    googleButton.replaceChildren();
    retryButton.classList.remove('hidden');
  }

  function hideGoogleRetry() {
    retryButton.classList.add('hidden');
  }

  function loadGoogleLibrary() {
    if (window.google?.accounts?.id) return Promise.resolve(true);

    document.getElementById('google-identity-script')?.remove();
    return new Promise((resolve) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        resolve(loaded);
      };

      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => finish(Boolean(window.google?.accounts?.id));
      script.onerror = () => finish(false);
      document.head.append(script);
      setTimeout(() => finish(Boolean(window.google?.accounts?.id)), 8000);
    });
  }

  async function handleCredential(response) {
    const { ok, status, data } = await api('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        credential: response.credential,
        deviceId: getDeviceId(),
        userAgent: navigator.userAgent,
      }),
    });

    if (!ok) {
      fail(
        status === 0
          ? 'Không kết nối được máy chủ. Máy chủ có thể đang khởi động, thử lại sau ~1 phút nhé.'
          : `Đăng nhập thất bại (${status}): ${data.error || 'lỗi không rõ'}`,
        data,
      );
      return;
    }

    onLogin(data.user);
    onSupportPrompt();
  }

  async function renderGoogleButton() {
    hideGoogleRetry();
    if (!clientId) {
      fail('Thiếu VITE_GOOGLE_CLIENT_ID nên không bật được đăng nhập Google.');
      showGoogleRetry();
      return;
    }

    const loaded = await loadGoogleLibrary();
    if (!loaded) {
      fail(
        'Trình chặn quảng cáo có thể đang chặn accounts.google.com. Hãy cho phép miền này rồi bấm "Thử lại".',
      );
      showGoogleRetry();
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
      });
      // Nút do Google render trong iframe nên không style từ ngoài được; bản
      // "outline" nền trắng chói trên nền tối, phải đổi sang "filled_black".
      googleButton.replaceChildren();
      window.google.accounts.id.renderButton(googleButton, {
        theme: document.body.classList.contains('light-theme')
          ? 'outline'
          : 'filled_black',
        size: 'medium',
        shape: 'pill',
      });
      setTimeout(() => {
        if (!googleButton.childElementCount) {
          fail(
            'Không hiển thị được nút Google. Hãy cho phép accounts.google.com và cookie bên thứ ba rồi thử lại.',
          );
          showGoogleRetry();
        }
      }, 1500);
    } catch (error) {
      fail(
        'Google từ chối khởi tạo đăng nhập. Thường do domain hiện tại chưa nằm trong "Authorized JavaScript origins" của OAuth client.',
        error,
      );
      showGoogleRetry();
    }
  }
  retryButton.onclick = renderGoogleButton;
  renderGoogleButton();
  // Đổi sáng/tối thì vẽ lại nút cho khớp nền.
  window.addEventListener('swr302:theme', () => renderGoogleButton());

  api('/auth/me').then(({ ok, data }) => {
    if (ok) onLogin(data.user);
    else onLogout();
  });

  document.getElementById('logout-button').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    onLogout();
  };
}
