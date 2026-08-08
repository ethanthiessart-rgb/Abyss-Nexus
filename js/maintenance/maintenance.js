'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');

  function show(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    setTimeout(() => toast.classList.remove('is-visible'), 2300);
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
      throw new Error(data.message || 'Erreur');
    }

    return data;
  }

  function applyState(state) {
    if (!state) return;

    const mode = document.querySelector(
      `input[name="mode"][value="${state.mode}"]`
    );
    if (mode) mode.checked = true;

    const alert = document.querySelector(
      `input[name="alert-code"][value="${state.alertCode || 'green'}"]`
    );
    if (alert) alert.checked = true;

    if ($('#maintenance-message')) {
      $('#maintenance-message').value = state.message || '';
    }

    if ($('#return-unknown')) {
      $('#return-unknown').checked = Boolean(state.returnUnknown);
    }

    if ($('#return-at')) {
      $('#return-at').disabled = Boolean(state.returnUnknown);
      $('#return-at').value = state.returnAt
        ? new Date(state.returnAt).toISOString().slice(0, 16)
        : '';
    }

    if ($('#maintenance-badge')) {
      $('#maintenance-badge').textContent = state.label || 'Opérationnel';
    }

    window.dispatchEvent(
      new CustomEvent('abyss-status-updated', {
        detail: {
          label: state.label || 'Opérationnel',
          alert: state.alert || {
            code: state.alertCode || 'green',
            icon: '🟢',
            label: 'Code Vert',
            description: ''
          }
        }
      })
    );
  }

  async function load() {
    const data = await api('/api/maintenance');
    const state = data.state;

    applyState(state);

    if ($('#allowed-departments')) {
      $('#allowed-departments').innerHTML = data.departments
        .filter((department) => department.active)
        .map((department) => `
          <label>
            <input type="checkbox"
                   value="${department.name}"
                   ${state.allowedDepartments.includes(department.name)
                     ? 'checked'
                     : ''}>
            <span>${department.icon || '🏢'} ${department.name}</span>
          </label>
        `)
        .join('');
    }
  }

  $('#return-unknown')?.addEventListener('change', () => {
    $('#return-at').disabled = $('#return-unknown').checked;
  });

  $('#maintenance-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const data = await api('/api/maintenance', {
        method: 'PUT',
        body: JSON.stringify({
          mode:
            document.querySelector('input[name="mode"]:checked')?.value,
          alertCode:
            document.querySelector('input[name="alert-code"]:checked')?.value
            || 'green',
          message: $('#maintenance-message')?.value.trim() || '',
          returnUnknown: Boolean($('#return-unknown')?.checked),
          returnAt: $('#return-at')?.value
            ? new Date($('#return-at').value).toISOString()
            : null,
          allowedDepartments: [
            ...document.querySelectorAll(
              '#allowed-departments input:checked'
            )
          ].map((input) => input.value)
        })
      });

      applyState(data.state);
      show(data.message || 'État du site mis à jour.');

      // Recharge ensuite les données serveur afin de confirmer l’écriture.
      await load();
    } catch (error) {
      show(error.message);
    }
  });

  load().catch((error) => show(error.message));
})();
