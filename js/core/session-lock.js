'use strict';

(() => {
  let locked = false;
  let timer;
  let inactivityMinutes = 15;

  const overlay = document.createElement('div');
  overlay.className = 'session-lock-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <form class="session-lock-card">
      <img class="session-lock-logo"
           src="/assets/logos/abyss-nexus-logo.png"
           alt="Logo Abyss Nexus">
      <h2>ABYSS NEXUS</h2>
      <p>SESSION VERROUILLÉE</p>
      <input class="session-lock-password"
             type="password"
             placeholder="Entrez votre mot de passe"
             autocomplete="current-password"
             required>
      <p class="session-lock-error"></p>
      <button class="primary-action" type="submit">
        Déverrouiller
      </button>
    </form>
  `;

  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const passwordInput = overlay.querySelector('.session-lock-password');
  const errorText = overlay.querySelector('.session-lock-error');

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

  function lock() {
    if (locked) return;

    locked = true;
    overlay.hidden = false;
    passwordInput.value = '';
    errorText.textContent = '';
    passwordInput.focus();
    sessionStorage.setItem('anx-session-locked', '1');
  }

  function unlock() {
    locked = false;
    overlay.hidden = true;
    sessionStorage.removeItem('anx-session-locked');
    resetTimer();
  }

  function resetTimer() {
    clearTimeout(timer);

    inactivityMinutes = Number(
      window.AbyssNexusSettings?.autoLockMinutes || 15
    );

    timer = setTimeout(
      lock,
      inactivityMinutes * 60 * 1000
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.textContent = '';

    try {
      await json('/api/account/verify-password', {
        method: 'POST',
        body: JSON.stringify({
          password: passwordInput.value
        })
      });

      unlock();
    } catch (error) {
      errorText.textContent = error.message;
      passwordInput.select();
    }
  });

  window.addEventListener('abyss-lock-session', lock);

  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(
    (eventName) => {
      document.addEventListener(eventName, () => {
        if (!locked) resetTimer();
      }, { passive: true });
    }
  );

  if (sessionStorage.getItem('anx-session-locked') === '1') {
    lock();
  }

  resetTimer();
})();
