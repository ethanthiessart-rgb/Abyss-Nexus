'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');
  const createDialog = $('#api-key-dialog');
  const secretDialog = $('#api-secret-dialog');

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

  function formatDate(value) {
    if (!value) return 'Jamais';

    const normalized =
      typeof value === 'string' && !value.endsWith('Z')
        ? `${value}Z`
        : value;

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(normalized));
  }

  async function load() {
    const data = await api('/api/api-center/keys');

    $('#api-scopes').innerHTML =
      '<legend>Portées autorisées</legend>' +
      data.availableScopes.map((scope) => `
        <label class="scope-row">
          <input type="checkbox" value="${scope.key}">
          ${scope.label}
        </label>
      `).join('');

    $('#api-key-list').innerHTML = data.keys.length
      ? data.keys.map((key) => `
          <article class="api-key-item">
            <div>
              <strong>${key.name}</strong>
              <span>${key.prefix}••••••••</span>
              <small>
                ${key.scopes.join(', ')} ·
                ${key.rateLimitPerMinute}/min
              </small>
            </div>

            <div>
              <span class="${key.active ? 'status-active' : 'status-disabled'}">
                ${key.active ? 'Active' : 'Désactivée'}
              </span>
              <small>Utilisée : ${formatDate(key.lastUsedAt)}</small>
              <small>${key.requestCount} requête(s)</small>
            </div>

            <div class="api-key-actions">
              <button
                class="secondary-action toggle-key"
                data-id="${key.id}"
                data-active="${key.active ? '0' : '1'}">
                ${key.active ? 'Désactiver' : 'Activer'}
              </button>

              <button
                class="danger-action delete-key"
                data-id="${key.id}">
                Supprimer
              </button>
            </div>
          </article>
        `).join('')
      : '<p class="empty-state">Aucune clé API créée.</p>';

    document.querySelectorAll('.toggle-key').forEach((button) => {
      button.addEventListener('click', async () => {
        const result = await api(
          `/api/api-center/keys/${button.dataset.id}/toggle`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              active: button.dataset.active === '1'
            })
          }
        );

        show(result.message);
        load();
      });
    });

    document.querySelectorAll('.delete-key').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement cette clé API ?')) return;

        const result = await api(
          `/api/api-center/keys/${button.dataset.id}`,
          { method: 'DELETE' }
        );

        show(result.message);
        load();
      });
    });
  }

  const baseUrl = `${location.origin}/api/v1`;
  $('#base-url').textContent = baseUrl;
  $('#api-example').textContent =
`$headers = @{
  "x-api-key" = "COLLE_TA_CLE_ICI"
}

Invoke-RestMethod `
  -Uri "${baseUrl}/status" `
  -Headers $headers`;

  $('#new-api-key').addEventListener('click', () => {
    createDialog.showModal();
  });

  $('#cancel-api-key').addEventListener('click', () => {
    createDialog.close();
  });

  $('#api-key-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const scopes = [
        ...document.querySelectorAll('#api-scopes input:checked')
      ].map((input) => input.value);

      const result = await api('/api/api-center/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#api-key-name').value.trim(),
          scopes,
          rateLimitPerMinute: Number($('#api-rate-limit').value),
          expiresAt: $('#api-expires-at').value
            ? new Date($('#api-expires-at').value).toISOString()
            : null
        })
      });

      createDialog.close();
      $('#api-key-form').reset();
      $('#api-secret').value = result.apiKey;
      secretDialog.showModal();
      load();
    } catch (error) {
      show(error.message);
    }
  });

  $('#copy-api-secret').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#api-secret').value);
    show('Clé API copiée.');
  });

  $('#close-api-secret').addEventListener('click', () => {
    $('#api-secret').value = '';
    secretDialog.close();
  });

  load().catch((error) => show(error.message));
})();
