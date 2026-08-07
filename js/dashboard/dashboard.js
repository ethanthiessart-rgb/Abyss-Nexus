'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Erreur serveur.');
    return data;
  }

  function applyModulePermissions(permissions) {
    const cards = [...document.querySelectorAll('.module-card')];

    for (const card of cards) {
      const permission = card.dataset.permission;
      if (permission && !permissions.includes(permission)) {
        card.hidden = true;
      }
    }

    for (const section of document.querySelectorAll('.module-section')) {
      const visibleCards = [...section.querySelectorAll('.module-card')]
        .filter((card) => !card.hidden);
      section.hidden = visibleCards.length === 0;
    }

    const visibleCount = cards.filter((card) => !card.hidden).length;
    const counter = $('#module-count');
    if (counter) {
      counter.textContent = `${visibleCount} module${visibleCount > 1 ? 's' : ''} disponible${visibleCount > 1 ? 's' : ''}`;
    }
  }

  async function init() {
    const session = await api('/api/auth/session');
    const user = session.user;
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];

    $('#user-name').textContent = user.username;
    $('#welcome-name').textContent = user.username;
    $('#user-grade').textContent = user.grade;
    $('#stat-matricule').textContent = user.matricule;
    $('#stat-grade').textContent = user.grade;
    $('#stat-department').textContent = user.department;
    $('#user-avatar').src = user.avatarUrl || '/assets/logos/abyss-nexus-logo.png';

    applyModulePermissions(permissions);

    try {
      const notifications = await api('/api/notification-center');
      $('#stat-notifications').textContent = notifications.unreadCount;
      const badge = $('#notification-count');
      badge.hidden = notifications.unreadCount === 0;
      badge.textContent = notifications.unreadCount > 99 ? '99+' : notifications.unreadCount;
    } catch (error) {
      console.warn('Notifications indisponibles :', error);
      $('#stat-notifications').textContent = '—';
    }
  }

  init().catch((error) => {
    console.error('Dashboard Abyss Nexus :', error);
    location.assign('/');
  });
})();
