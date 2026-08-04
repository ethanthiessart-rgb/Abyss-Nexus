'use strict';

(() => {
  const quote = document.querySelector('#daily-quote');
  const accountButtons = document.querySelectorAll('.account-option');
  const accountType = document.querySelector('#account-type');
  const password = document.querySelector('#password');
  const togglePassword = document.querySelector('#toggle-password');
  const form = document.querySelector('#login-form');
  const formMessage = document.querySelector('#form-message');
  const submitButton = form?.querySelector('button[type="submit"]');

  if (quote && window.getAbyssQuoteOfTheDay) {
    quote.textContent = window.getAbyssQuoteOfTheDay();
  }

  accountButtons.forEach((button) => {
    button.addEventListener('click', () => {
      accountButtons.forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      accountType.value = button.dataset.account;
      formMessage.textContent = '';
    });
  });

  togglePassword?.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    togglePassword.textContent = visible ? 'Afficher' : 'Masquer';
    togglePassword.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    formMessage.classList.remove('success');

    const data = new FormData(form);
    const payload = {
      matricule: String(data.get('matricule') || '').trim(),
      identifier: String(data.get('identifier') || '').trim(),
      password: String(data.get('password') || ''),
      accountType: String(data.get('accountType') || 'personnel')
    };

    if (!/^ABY-[A-Z0-9-]{3,20}$/i.test(payload.matricule)) {
      formMessage.textContent = 'Le matricule doit commencer par ABY-.';
      return;
    }
    if (payload.identifier.length < 3 || payload.password.length < 8) {
      formMessage.textContent = 'Vérifie ton identifiant et ton mot de passe.';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Authentification...';
    formMessage.textContent = '';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.message || 'Connexion refusée.');
      }

      formMessage.classList.add('success');
      formMessage.textContent = 'Authentification réussie. Ouverture du Core...';
      window.setTimeout(() => window.location.assign(result.redirect || '/dashboard'), 550);
    } catch (error) {
      formMessage.textContent = error.message || 'Une erreur est survenue.';
      submitButton.disabled = false;
      submitButton.textContent = 'Accéder à Abyss Nexus';
    }
  });

  const statusLabel = document.querySelector('#status-label');
  fetch('/api/status')
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('status unavailable')))
    .then((data) => {
      if (statusLabel && data.label) statusLabel.textContent = data.label;
    })
    .catch(() => {
      if (statusLabel) statusLabel.textContent = 'État indisponible';
    });
})();
