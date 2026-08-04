'use strict';

(() => {
  const state = {
    canManage: false,
    users: [],
    filteredUsers: [],
    sanctions: [],
    sanctionTypes: [],
    currentUser: null,
    selectedUserId: null,
    cancellingSanctionId: null
  };

  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');
  const sanctionDialog = $('#sanction-dialog');
  const cancelDialog = $('#cancel-dialog');

  const STATUS_LABELS = {
    active: 'Active',
    expired: 'Expirée',
    cancelled: 'Annulée',
    archived: 'Archivée'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2500);
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

    const data = await response.json().catch(() => ({
      ok: false,
      message: 'Réponse serveur invalide.'
    }));

    if (!response.ok) {
      throw new Error(data.message || 'Une erreur est survenue.');
    }

    return data;
  }

  function formatDate(value) {
    if (!value) return 'Non renseigné';
    const date = new Date(value.endsWith?.('Z') ? value : `${value}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function populateForms() {
    $('#sanction-type').innerHTML = state.sanctionTypes
      .map((item) => `<option value="${item.key}">${escapeHtml(item.label)}</option>`)
      .join('');

    $('#sanction-target').innerHTML = state.users
      .map((user) => `
        <option value="${user.id}">
          ${escapeHtml(user.username)} — ${escapeHtml(user.matricule)}
        </option>
      `).join('');
  }

  function renderPeople() {
    $('#people-list').innerHTML = state.filteredUsers.map((user) => `
      <button class="person-item ${user.id === state.selectedUserId ? 'is-selected' : ''}" type="button" data-id="${user.id}">
        <img src="${user.avatarUrl || '/assets/logos/abyss-nexus-logo.png'}" alt="">
        <span>
          <strong>${escapeHtml(user.username)}</strong>
          <span>${escapeHtml(user.matricule)} · ${escapeHtml(user.grade)}</span>
        </span>
      </button>
    `).join('');

    document.querySelectorAll('.person-item').forEach((button) => {
      button.addEventListener('click', () => loadDossier(Number(button.dataset.id)));
    });
  }

  function renderSanctions(data) {
    const sanctions = data.sanctions;
    $('#sanction-total').textContent = sanctions.length;
    $('#sanction-active').textContent =
      sanctions.filter((item) => item.status === 'active').length;
    $('#last-sanction').textContent =
      sanctions.length ? sanctions[0].sanctionNumber : 'Aucune';

    $('#sanctions-list').innerHTML = sanctions.map((item) => {
      const type = state.sanctionTypes.find((entry) => entry.key === item.sanctionType);
      const canCancel = state.canManage && item.status === 'active';

      return `
        <article class="sanction-card ${item.status === 'cancelled' ? 'is-cancelled' : ''}" data-severity="${item.severity}">
          <header>
            <div>
              <span class="sanction-number">${escapeHtml(item.sanctionNumber)}</span>
              <h4>${escapeHtml(type?.label || item.sanctionType)}</h4>
            </div>
            <span>${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
          </header>
          <p class="sanction-meta">
            ${escapeHtml(item.durationLabel || 'Permanent')} · ${escapeHtml(formatDate(item.startsAt))}
          </p>
          <p class="sanction-reason">${escapeHtml(item.reason)}</p>
          ${item.comment ? `<p class="sanction-comment">${escapeHtml(item.comment)}</p>` : ''}
          <p class="sanction-footer">
            Appliquée par ${escapeHtml(item.issuer.username)} — ${escapeHtml(item.issuer.grade)}
          </p>
          ${item.cancelledReason ? `<p class="sanction-footer">Annulation : ${escapeHtml(item.cancelledReason)}</p>` : ''}
          ${canCancel ? `<button class="secondary-action cancel-sanction" type="button" data-id="${item.id}">Annuler</button>` : ''}
        </article>
      `;
    }).join('');

    $('#sanctions-empty').hidden = sanctions.length > 0;

    document.querySelectorAll('.cancel-sanction').forEach((button) => {
      button.addEventListener('click', () => {
        state.cancellingSanctionId = Number(button.dataset.id);
        $('#cancel-reason').value = '';
        $('#cancel-message').textContent = '';
        cancelDialog.showModal();
      });
    });
  }

  async function loadDossier(userId) {
    state.selectedUserId = userId;
    renderPeople();

    try {
      const data = await api(`/api/discipline/user/${userId}`);
      const user = data.user;

      $('#dossier-placeholder').hidden = true;
      $('#dossier-content').hidden = false;
      $('#dossier-avatar').src =
        user.avatarUrl || '/assets/logos/abyss-nexus-logo.png';
      $('#dossier-name').textContent = user.username;
      $('#dossier-info').textContent =
        `${user.matricule} · ${user.grade} · ${user.department}`;

      const surveillance = $('#surveillance-level');
      surveillance.textContent = data.surveillanceLevel;
      surveillance.dataset.level = data.surveillanceLevel;

      $('#trust-value').textContent = `${data.trustIndex} %`;
      $('#trust-bar').style.width = `${data.trustIndex}%`;

      renderSanctions(data);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function createSanction(event) {
    event.preventDefault();
    $('#sanction-message').textContent = '';

    try {
      const data = await api('/api/discipline', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: Number($('#sanction-target').value),
          sanctionType: $('#sanction-type').value,
          reason: $('#sanction-reason').value.trim(),
          comment: $('#sanction-comment').value.trim(),
          durationKey: $('#sanction-duration').value,
          customDays: Number($('#custom-days').value)
        })
      });

      sanctionDialog.close();
      $('#sanction-form').reset();
      $('#custom-days-field').hidden = true;
      showToast(`${data.message} ${data.sanctionNumber}`);

      const targetId = Number($('#sanction-target').value) || state.selectedUserId;
      await loadDossier(targetId);
    } catch (error) {
      $('#sanction-message').textContent = error.message;
    }
  }

  async function cancelSanction(event) {
    event.preventDefault();
    $('#cancel-message').textContent = '';

    try {
      const data = await api(
        `/api/discipline/${state.cancellingSanctionId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: $('#cancel-reason').value.trim()
          })
        }
      );

      cancelDialog.close();
      showToast(data.message);
      await loadDossier(state.selectedUserId);
    } catch (error) {
      $('#cancel-message').textContent = error.message;
    }
  }

  async function init() {
    try {
      const meta = await api('/api/discipline/meta');
      state.canManage = meta.canManage;
      state.users = meta.users;
      state.filteredUsers = [...state.users];
      state.sanctionTypes = meta.sanctionTypes;
      state.currentUser = meta.currentUser;

      $('#personnel-link').hidden =
        !(state.currentUser.permissions || []).includes('personnel.view');

      $('#new-sanction-button').hidden = !state.canManage;
      $('#discipline-search').hidden = !state.canManage;
      $('#people-panel').hidden = !state.canManage;

      if (state.canManage) {
        populateForms();
        renderPeople();
        const firstUser = state.users[0];
        if (firstUser) await loadDossier(firstUser.id);
      } else {
        await loadDossier(state.currentUser.id);
      }
    } catch (error) {
      showToast(error.message);
      setTimeout(() => location.assign('/dashboard'), 1200);
    }
  }

  $('#discipline-search').addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    state.filteredUsers = state.users.filter((user) =>
      [user.username, user.matricule, user.grade, user.department]
        .some((value) => String(value || '').toLowerCase().includes(query))
    );
    renderPeople();
  });

  $('#new-sanction-button').addEventListener('click', () => {
    if (state.selectedUserId) {
      $('#sanction-target').value = String(state.selectedUserId);
    }
    $('#sanction-message').textContent = '';
    sanctionDialog.showModal();
  });

  $('#close-sanction-dialog').addEventListener('click', () => sanctionDialog.close());
  $('#close-cancel-dialog').addEventListener('click', () => cancelDialog.close());

  $('#sanction-duration').addEventListener('change', () => {
    $('#custom-days-field').hidden = $('#sanction-duration').value !== 'custom';
  });

  $('#sanction-form').addEventListener('submit', createSanction);
  $('#cancel-form').addEventListener('submit', cancelSanction);

  $('#logout-button').addEventListener('click', async () => {
    const data = await api('/api/auth/logout', { method: 'POST' });
    location.assign(data.redirect || '/');
  });

  init();
})();
