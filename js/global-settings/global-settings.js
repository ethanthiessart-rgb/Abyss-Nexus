'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');
  const form = $('#global-settings-form');

  let settings = null;
  let dirty = false;

  function show(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');

    clearTimeout(show.timer);
    show.timer = setTimeout(
      () => toast.classList.remove('is-visible'),
      2300
    );
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Erreur serveur.');
    }

    return data;
  }

  function getPath(object, path) {
    return path.split('.').reduce(
      (value, key) => value?.[key],
      object
    );
  }

  function setPath(object, path, value) {
    const keys = path.split('.');
    let cursor = object;

    for (let index = 0; index < keys.length - 1; index += 1) {
      const key = keys[index];
      cursor[key] ||= {};
      cursor = cursor[key];
    }

    cursor[keys.at(-1)] = value;
  }

  function valueFromInput(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number') return Number(input.value);
    return input.value;
  }

  function fillForm() {
    document.querySelectorAll('[data-path]').forEach((input) => {
      const value = getPath(settings, input.dataset.path);

      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = value ?? '';
      }
    });

    renderPreview();
    dirty = false;
  }

  function collectForm() {
    const next = JSON.parse(JSON.stringify(settings));

    document.querySelectorAll('[data-path]').forEach((input) => {
      setPath(next, input.dataset.path, valueFromInput(input));
    });

    return next;
  }

  function renderPreview() {
    const current = collectForm();
    const branding = current.branding;

    $('#preview-logo').src =
      branding.logoUrl || '/assets/logos/abyss-nexus-logo.png';
    $('#preview-name').textContent =
      branding.organizationName || 'Abyss Nexus';
    $('#preview-subtitle').textContent =
      branding.portalSubtitle || 'Staff Management System';

    $('#branding-preview').style.setProperty(
      '--preview-primary',
      branding.primaryColor
    );
  }

  function formatDate(value) {
    if (!value) return '—';

    const normalized =
      typeof value === 'string' && !value.endsWith('Z')
        ? `${value}Z`
        : value;

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(normalized));
  }

  async function loadHistory() {
    const data = await api('/api/global-settings/history');

    $('#settings-history').innerHTML = data.history.length
      ? data.history.map((item) => `
          <article class="history-item">
            <strong>${item.actorName}</strong>
            <span>${item.ipAddress || 'Adresse inconnue'}</span>
            <small>${formatDate(item.createdAt)}</small>
          </article>
        `).join('')
      : '<p class="empty-state">Aucune modification enregistrée.</p>';
  }

  async function load() {
    const data = await api('/api/global-settings');
    settings = data.settings;
    fillForm();
    await loadHistory();
  }

  async function save() {
    const next = collectForm();

    const data = await api('/api/global-settings', {
      method: 'PUT',
      body: JSON.stringify({ settings: next })
    });

    settings = data.settings;
    fillForm();
    show(data.message);

    // The navigation reads the public settings after refresh.
    setTimeout(() => location.reload(), 700);
  }

  document.querySelectorAll('.settings-tabs button').forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('.settings-tabs button')
        .forEach((item) => item.classList.remove('is-active'));

      document.querySelectorAll('.settings-section')
        .forEach((section) => section.classList.remove('is-active'));

      button.classList.add('is-active');

      const sectionName = button.dataset.section;
      document.querySelector(
        `[data-settings-section="${sectionName}"]`
      )?.classList.add('is-active');

      if (sectionName === 'history') {
        await loadHistory().catch((error) => show(error.message));
      }
    });
  });

  form.addEventListener('input', () => {
    dirty = true;
    renderPreview();
  });

  form.addEventListener('change', () => {
    dirty = true;
    renderPreview();
  });

  $('#save-settings').addEventListener('click', () => {
    save().catch((error) => show(error.message));
  });

  $('#reset-settings').addEventListener('click', async () => {
    if (!confirm(
      'Réinitialiser toute la configuration globale aux valeurs par défaut ?'
    )) {
      return;
    }

    try {
      const data = await api('/api/global-settings/reset', {
        method: 'POST'
      });

      settings = data.settings;
      fillForm();
      show(data.message);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      show(error.message);
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;

    event.preventDefault();
    event.returnValue = '';
  });

  load().catch((error) => show(error.message));
})();
