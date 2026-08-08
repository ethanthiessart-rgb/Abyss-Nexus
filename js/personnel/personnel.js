'use strict';

(() => {
  const state = {
    users: [],
    filteredUsers: [],
    selectedId: null,
    departments: [],
    permissions: [],
    currentPermissions: []
  };

  const $ = (selector) => document.querySelector(selector);
  const list = $('#personnel-list');
  const toast = $('#toast');
  const createDialog = $('#create-dialog');

  function can(permission) {
    return state.currentPermissions.includes(permission);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2500);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'Réponse serveur invalide.' }));
    if (!response.ok) throw new Error(data.message || 'Une erreur est survenue.');
    return data;
  }

  function populateDepartments() {
    for (const selector of ['#create-department', '#edit-department']) {
      const select = $(selector);
      select.innerHTML = state.departments.map((department) =>
        `<option value="${department.replaceAll('"', '&quot;')}">${department}</option>`
      ).join('');
    }
  }

  function statusLabel(status) {
    return ({ active: 'Actif', suspended: 'Suspendu', disabled: 'Désactivé', archived: 'Archivé' })[status] || status;
  }

  function renderList() {
    list.innerHTML = state.filteredUsers.map((user) => `
      <button class="personnel-item ${user.id === state.selectedId ? 'is-selected' : ''}" type="button" data-id="${user.id}">
        <img src="${user.avatarUrl || '/assets/logos/abyss-nexus-logo.png'}" alt="">
        <span>
          <strong>${escapeHtml(user.username)}</strong>
          <span>${escapeHtml(user.matricule)} · ${escapeHtml(user.grade)}</span>
          <small>${escapeHtml(user.department)}</small>
        </span>
        <span class="mini-status">${statusLabel(user.status)}</span>
      </button>
    `).join('');

    $('#empty-message').hidden = state.filteredUsers.length > 0;
    $('#employee-count').textContent = state.users.length;
    $('#active-count').textContent = state.users.filter((user) => user.status === 'active').length;
    $('#suspended-count').textContent = state.users.filter((user) => user.status === 'suspended').length;

    list.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', () => selectUser(Number(button.dataset.id)));
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function loadUsers() {
    const data = await api('/api/personnel');
    state.users = data.users;
    state.filteredUsers = [...state.users];
    renderList();
  }

  function renderPermissions(detail) {
    const overrideMap = new Map(detail.overrides.map((item) => [item.permission_key, item.effect]));
    $('#permission-list').innerHTML = state.permissions.map((permission) => `
      <label class="permission-row">
        <span>${escapeHtml(permission.label)}</span>
        <select data-permission="${permission.key}" ${can('permissions.manage') ? '' : 'disabled'}>
          <option value="inherit" ${!overrideMap.has(permission.key) ? 'selected' : ''}>Automatique</option>
          <option value="allow" ${overrideMap.get(permission.key) === 'allow' ? 'selected' : ''}>Autoriser</option>
          <option value="deny" ${overrideMap.get(permission.key) === 'deny' ? 'selected' : ''}>Refuser</option>
        </select>
      </label>
    `).join('');
  }

  async function selectUser(id) {
    state.selectedId = id;
    renderList();

    const detail = await api(`/api/personnel/${id}`);
    const user = detail.user;

    $('#detail-placeholder').hidden = true;
    $('#detail-content').hidden = false;
    $('#detail-avatar').src = user.avatarUrl || '/assets/logos/abyss-nexus-logo.png';
    $('#detail-name').textContent = user.username;
    $('#detail-matricule').textContent = `${user.matricule} · ${user.identifier}`;
    $('#detail-status').textContent = statusLabel(user.status);
    $('#edit-grade').value = user.grade;
    $('#edit-department').value = user.department;
    $('#edit-status').value = user.status;

    $('#edit-form').querySelectorAll('input, select, button').forEach((element) => {
      element.disabled = !can('personnel.edit');
    });
    $('#reset-password-button').disabled = !can('personnel.reset_password');
    $('#reset-password').disabled = !can('personnel.reset_password');
    const deleteButton = $('#delete-account-button');
    if (deleteButton) deleteButton.disabled = !can('personnel.edit');
    $('#save-permissions').disabled = !can('permissions.manage');

    renderPermissions(detail);
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!state.selectedId) return;
    try {
      await api(`/api/personnel/${state.selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          grade: $('#edit-grade').value.trim(),
          department: $('#edit-department').value,
          status: $('#edit-status').value
        })
      });
      showToast('Employé mis à jour.');
      await loadUsers();
      await selectUser(state.selectedId);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function savePermissions() {
    if (!state.selectedId) return;
    const overrides = [...document.querySelectorAll('[data-permission]')]
      .map((select) => ({
        permissionKey: select.dataset.permission,
        effect: select.value
      }))
      .filter((item) => item.effect !== 'inherit');

    try {
      await api(`/api/personnel/${state.selectedId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ overrides })
      });
      showToast('Permissions enregistrées.');
      await selectUser(state.selectedId);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function resetPassword() {
    if (!state.selectedId) return;
    const password = $('#reset-password').value;
    try {
      await api(`/api/personnel/${state.selectedId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      $('#reset-password').value = '';
      showToast('Mot de passe réinitialisé.');
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteAccount() {
    if (!state.selectedId) return;

    const user = state.users.find((item) => item.id === state.selectedId);
    const label = user ? `${user.username} (${user.matricule})` : 'ce compte';

    const firstConfirm = window.confirm(
      `SUPPRESSION DÉFINITIVE\n\nVoulez-vous réellement supprimer ${label} ?\n\nCette action est irréversible.`
    );
    if (!firstConfirm) return;

    const typed = window.prompt(
      `Dernière confirmation.\n\nTapez SUPPRIMER pour supprimer définitivement ${label}.`
    );
    if (typed !== 'SUPPRIMER') {
      showToast('Suppression annulée.');
      return;
    }

    try {
      const data = await api(`/api/personnel/${state.selectedId}`, {
        method: 'DELETE'
      });

      state.selectedId = null;
      $('#detail-content').hidden = true;
      $('#detail-placeholder').hidden = false;
      $('#detail-placeholder').textContent = 'Sélectionnez un employé.';
      showToast(data.message || 'Compte supprimé définitivement.');
      await loadUsers();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function discordLookup() {
    const discordId = $('#create-discord-id').value.trim();
    $('#lookup-message').textContent = 'Recherche en cours...';
    try {
      const data = await api('/api/personnel/discord-lookup', {
        method: 'POST',
        body: JSON.stringify({ discordId })
      });
      $('#create-username').value = data.member.username;
      $('#create-avatar-url').value = data.member.avatarUrl;
      $('#create-avatar').src = data.member.avatarUrl;
      $('#create-preview-name').textContent = data.member.username;
      $('#lookup-message').textContent = `ID Discord : ${data.member.discordId}`;
    } catch (error) {
      $('#lookup-message').textContent = error.message;
    }
  }

  async function createUser(event) {
    event.preventDefault();
    $('#create-message').textContent = '';
    try {
      const data = await api('/api/personnel', {
        method: 'POST',
        body: JSON.stringify({
          discordId: $('#create-discord-id').value.trim(),
          username: $('#create-username').value.trim(),
          avatarUrl: $('#create-avatar-url').value.trim(),
          grade: $('#create-grade').value.trim(),
          department: $('#create-department').value,
          identifier: $('#create-identifier').value.trim(),
          password: $('#create-password').value
        })
      });
      createDialog.close();
      $('#create-form').reset();
      $('#create-avatar').src = '/assets/logos/abyss-nexus-logo.png';
      $('#create-preview-name').textContent = 'Profil non recherché';
      showToast(`Compte créé : ${data.matricule}`);
      await loadUsers();
    } catch (error) {
      $('#create-message').textContent = error.message;
    }
  }

  function applyPermissionsToInterface() {
    $('#open-create').hidden = !can('personnel.create');
    $('#save-permissions').hidden = !can('permissions.manage');
    $('.reset-section').hidden = !can('personnel.reset_password');
  }

  async function init() {
    try {
      const meta = await api('/api/personnel/meta');
      state.departments = meta.departments;
      state.permissions = meta.permissions;
      state.currentPermissions = meta.currentPermissions;
      populateDepartments();
      applyPermissionsToInterface();
      await loadUsers();
    } catch (error) {
      showToast(error.message);
      if (error.message === 'Permission insuffisante.') setTimeout(() => location.assign('/dashboard'), 1200);
    }
  }

  $('#search-input').addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    state.filteredUsers = state.users.filter((user) =>
      [user.username, user.matricule, user.discordId, user.grade, user.department]
        .some((value) => String(value || '').toLowerCase().includes(query))
    );
    renderList();
  });

  $('#open-create').addEventListener('click', () => createDialog.showModal());
  $('#close-create').addEventListener('click', () => createDialog.close());
  $('#discord-lookup').addEventListener('click', discordLookup);
  $('#create-form').addEventListener('submit', createUser);
  $('#edit-form').addEventListener('submit', saveEdit);
  $('#save-permissions').addEventListener('click', savePermissions);
  $('#reset-password-button').addEventListener('click', resetPassword);
  $('#delete-account-button')?.addEventListener('click', deleteAccount);
  $('#logout-button').addEventListener('click', async () => {
    const data = await api('/api/auth/logout', { method: 'POST' });
    location.assign(data.redirect || '/');
  });

  init();
})();
