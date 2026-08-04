'use strict';

(() => {
  const state = {
    box: 'inbox',
    messages: [],
    filteredMessages: [],
    selectedId: null,
    users: [],
    departments: [],
    currentUser: null,
    canSendGlobal: false
  };

  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');
  const composeDialog = $('#compose-dialog');

  const PRIORITY_LABELS = {
    normal: 'Normale',
    important: 'Importante',
    urgent: 'Urgente',
    direction: 'Direction'
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
    if (!value) return 'Date inconnue';
    const date = new Date(value.endsWith?.('Z') ? value : `${value}Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function populateRecipients() {
    $('#recipient-users').innerHTML = state.users
      .filter((user) => user.id !== state.currentUser.id)
      .map((user) => `
        <option value="${user.id}">
          ${escapeHtml(user.username)} — ${escapeHtml(user.matricule)} — ${escapeHtml(user.department)}
        </option>
      `).join('');

    $('#recipient-department').innerHTML = state.departments
      .map((department) => `
        <option value="${escapeHtml(department)}">${escapeHtml(department)}</option>
      `).join('');

    $('#global-option').hidden = !state.canSendGlobal;
  }

  function applySearch() {
    const query = $('#mail-search').value.trim().toLowerCase();

    state.filteredMessages = state.messages.filter((message) => {
      const text = [
        message.subject,
        message.body,
        message.sender.username,
        message.sender.matricule,
        message.sender.department,
        message.priority
      ].join(' ').toLowerCase();

      return !query || text.includes(query);
    });

    renderList();
  }

  function renderList() {
    $('#mail-list').innerHTML = state.filteredMessages.map((message) => `
      <button class="mail-item ${message.id === state.selectedId ? 'is-selected' : ''} ${state.box === 'inbox' && !message.readAt ? 'is-unread' : ''}" type="button" data-id="${message.id}">
        <div class="mail-item-top">
          <div>
            <span class="sender">${escapeHtml(message.sender.username)}</span>
            <strong class="subject">${escapeHtml(message.subject)}</strong>
          </div>
          <span class="priority-badge" data-priority="${message.priority}">
            ${escapeHtml(PRIORITY_LABELS[message.priority] || message.priority)}
          </span>
        </div>
        <small>${escapeHtml(formatDate(message.createdAt))}</small>
      </button>
    `).join('');

    $('#mail-empty').hidden = state.filteredMessages.length > 0;

    document.querySelectorAll('.mail-item').forEach((button) => {
      button.addEventListener('click', () => selectMessage(Number(button.dataset.id)));
    });
  }

  async function loadBox() {
    const data = await api(`/api/mail/${state.box}`);
    state.messages = data.messages;
    applySearch();
  }

  async function selectMessage(id) {
    state.selectedId = id;
    renderList();

    try {
      const data = await api(`/api/mail/${id}`);
      const message = data.message;

      $('#mail-placeholder').hidden = true;
      $('#mail-detail').hidden = false;
      $('#detail-priority').textContent =
        PRIORITY_LABELS[message.priority] || message.priority;
      $('#detail-subject').textContent = message.subject;
      $('#detail-date').textContent = formatDate(message.createdAt);
      $('#detail-confidential').hidden = !message.confidential;
      $('#detail-avatar').src =
        message.sender.avatarUrl || '/assets/logos/abyss-nexus-logo.png';
      $('#detail-sender').textContent = message.sender.username;
      $('#detail-sender-info').textContent =
        `${message.sender.matricule} · ${message.sender.grade} · ${message.sender.department}`;
      $('#detail-body').textContent = message.body;

      $('#detail-recipients').innerHTML = message.recipients.map((recipient) => `
        <span class="recipient-chip">
          ${escapeHtml(recipient.username)} · ${escapeHtml(recipient.matricule)}
        </span>
      `).join('');

      await loadBox();
    } catch (error) {
      showToast(error.message);
    }
  }

  function updateRecipientFields() {
    const type = $('#recipient-type').value;
    $('#users-field').hidden = type !== 'users';
    $('#department-field').hidden = type !== 'department';
  }

  async function sendMessage(event) {
    event.preventDefault();

    const recipientType = $('#recipient-type').value;
    const recipientIds = [...$('#recipient-users').selectedOptions]
      .map((option) => Number(option.value));

    $('#compose-message').textContent = '';

    try {
      const data = await api('/api/mail', {
        method: 'POST',
        body: JSON.stringify({
          recipientType,
          recipientIds,
          department: $('#recipient-department').value,
          priority: $('#message-priority').value,
          subject: $('#message-subject').value.trim(),
          body: $('#message-body').value.trim(),
          confidential: $('#message-confidential').checked
        })
      });

      composeDialog.close();
      $('#compose-form').reset();
      updateRecipientFields();
      showToast(`${data.message} ${data.recipientCount} destinataire(s).`);

      if (state.box === 'sent') {
        await loadBox();
      }
    } catch (error) {
      $('#compose-message').textContent = error.message;
    }
  }

  async function init() {
    try {
      const meta = await api('/api/mail/meta');
      state.users = meta.users;
      state.departments = meta.departments;
      state.currentUser = meta.currentUser;
      state.canSendGlobal = meta.canSendGlobal;

      $('#personnel-link').hidden =
        !(state.currentUser.permissions || []).includes('personnel.view');

      populateRecipients();
      updateRecipientFields();
      await loadBox();

      const messageId = new URLSearchParams(location.search).get('message');
      if (messageId) {
        await selectMessage(Number(messageId));
      }
    } catch (error) {
      showToast(error.message);
      setTimeout(() => location.assign('/dashboard'), 1200);
    }
  }

  document.querySelectorAll('.mail-tab').forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('.mail-tab').forEach((item) =>
        item.classList.remove('is-active')
      );
      button.classList.add('is-active');
      state.box = button.dataset.box;
      state.selectedId = null;
      $('#mail-detail').hidden = true;
      $('#mail-placeholder').hidden = false;
      await loadBox();
    });
  });

  $('#mail-search').addEventListener('input', applySearch);
  $('#recipient-type').addEventListener('change', updateRecipientFields);
  $('#compose-button').addEventListener('click', () => composeDialog.showModal());
  $('#close-compose').addEventListener('click', () => composeDialog.close());
  $('#compose-form').addEventListener('submit', sendMessage);

  $('#logout-button').addEventListener('click', async () => {
    const data = await api('/api/auth/logout', { method: 'POST' });
    location.assign(data.redirect || '/');
  });

  init();
})();
