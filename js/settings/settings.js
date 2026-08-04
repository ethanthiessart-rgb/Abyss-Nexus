'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(
      () => toast.classList.remove('is-visible'),
      2300
    );
  }

  async function json(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Erreur serveur.');
    return data;
  }

  async function load() {
    const data = await json('/api/account/settings');
    const user = data.user;
    const settings = data.settings;

    $('#settings-avatar').src =
      user.avatarUrl || '/assets/logos/abyss-nexus-logo.png';

    $('#settings-name').textContent = user.username;
    $('#settings-meta').textContent =
      `${user.matricule} · ${user.grade} · ${user.department}`;

    $('#theme').value = settings.theme;
    $('#animations').checked = settings.animationsEnabled;
    $('#sounds').checked = settings.soundsEnabled;
    $('#glow').checked = settings.glowEnabled;
    $('#desktop-notifications').checked =
      settings.desktopNotificationsEnabled;
    $('#auto-lock').value = String(settings.autoLockMinutes);
  }

  $('#preferences-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const data = await json('/api/account/settings', {
        method: 'PUT',
        body: JSON.stringify({
          theme: $('#theme').value,
          animationsEnabled: $('#animations').checked,
          soundsEnabled: $('#sounds').checked,
          glowEnabled: $('#glow').checked,
          desktopNotificationsEnabled:
            $('#desktop-notifications').checked,
          autoLockMinutes: Number($('#auto-lock').value)
        })
      });

      showToast(data.message);
      location.reload();
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const newPassword = $('#new-password').value;
    const confirmation = $('#confirm-password').value;

    if (newPassword !== confirmation) {
      return showToast('Les deux nouveaux mots de passe sont différents.');
    }

    try {
      const data = await json('/api/account/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: $('#current-password').value,
          newPassword
        })
      });

      event.target.reset();
      showToast(data.message);
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#lock-now').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('abyss-lock-session'));
  });

  load().catch((error) => showToast(error.message));
})();
