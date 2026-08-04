'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');

  function show(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(show.timer);
    show.timer = setTimeout(
      () => toast.classList.remove('is-visible'),
      2300
    );
  }

  async function api() {
    const response = await fetch('/api/direction-dashboard', {
      headers: { Accept: 'application/json' }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Impossible de charger le dashboard.');
    }

    return data;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);

    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;

    return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
  }

  function formatUptime(seconds) {
    const total = Number(seconds || 0);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    return `${days}j ${hours}h ${minutes}m`;
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

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function renderDepartments(departments) {
    const container = $('#department-chart');
    const max = Math.max(1, ...departments.map((item) => item.count));

    container.innerHTML = departments.length
      ? departments.map((item) => `
          <div class="bar-row">
            <span title="${item.department}">${item.department}</span>
            <div class="bar-track">
              <span style="width:${Math.round(item.count / max * 100)}%"></span>
            </div>
            <strong>${item.count}</strong>
          </div>
        `).join('')
      : '<p class="empty-state">Aucun département actif.</p>';
  }

  function sevenDays() {
    const days = [];
    const today = new Date();

    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);

      days.push({
        key: day.toISOString().slice(0, 10),
        label: new Intl.DateTimeFormat('fr-FR', {
          weekday: 'short',
          day: '2-digit'
        }).format(day)
      });
    }

    return days;
  }

  function renderTrends(trends) {
    const reportMap = new Map(
      trends.reports.map((item) => [item.day, item.count])
    );
    const sanctionMap = new Map(
      trends.sanctions.map((item) => [item.day, item.count])
    );
    const days = sevenDays();

    const max = Math.max(
      1,
      ...days.map((day) => reportMap.get(day.key) || 0),
      ...days.map((day) => sanctionMap.get(day.key) || 0)
    );

    $('#trend-chart').innerHTML = days.map((day) => {
      const reports = reportMap.get(day.key) || 0;
      const sanctions = sanctionMap.get(day.key) || 0;

      return `
        <div class="trend-day">
          <div class="trend-bars">
            <span
              class="trend-bar trend-bar-report"
              title="${reports} rapport(s)"
              style="height:${Math.max(3, reports / max * 100)}%">
            </span>
            <span
              class="trend-bar trend-bar-sanction"
              title="${sanctions} sanction(s)"
              style="height:${Math.max(3, sanctions / max * 100)}%">
            </span>
          </div>
          <small>${day.label}</small>
        </div>
      `;
    }).join('');
  }

  function renderAlerts(alerts) {
    $('#direction-alert-list').innerHTML = alerts.length
      ? alerts.map((alert) => `
          <article class="direction-alert-item">
            <strong>${alert.action}</strong>
            <span>${alert.details || 'Aucun détail'}</span>
            <small>${formatDate(alert.createdAt)}</small>
          </article>
        `).join('')
      : '<p class="empty-state">Aucune alerte importante récente.</p>';
  }

  async function load() {
    const data = await api();

    setText(
      '#dashboard-generated-at',
      `Dernière actualisation : ${formatDate(data.generatedAt)}`
    );

    const pendingTotal =
      data.requests.leavePending +
      data.requests.reportsPending +
      data.requests.sanctionsPending;

    setText('#pending-total', pendingTotal);
    setText(
      '#pending-detail',
      `${data.requests.leavePending} congé(s) · ` +
      `${data.requests.reportsPending} rapport(s) · ` +
      `${data.requests.sanctionsPending} sanction(s)`
    );

    setText('#personnel-active', data.personnel.active);
    setText(
      '#personnel-detail',
      `${data.personnel.absentToday} absent(s) · ` +
      `${data.personnel.suspended} suspendu(s)`
    );

    setText('#planning-today', data.planning.shiftsToday);
    setText(
      '#planning-detail',
      `${data.planning.assignedToday} affectation(s)`
    );

    setText('#training-ongoing', data.training.ongoing);
    setText(
      '#training-detail',
      `${data.training.completed} réussie(s) · ` +
      `${data.training.failed} échouée(s)`
    );

    setText('#notifications-unread', data.system.unreadNotifications);

    setText('#staff-total', data.personnel.total);
    setText('#staff-active', data.personnel.active);
    setText('#staff-absent', data.personnel.absentToday);
    setText('#staff-suspended', data.personnel.suspended);
    setText('#staff-new', data.personnel.newThisMonth);

    setText('#reports-pending', data.reports.pending);
    setText('#reports-validated', data.reports.validated);
    setText('#reports-rejected', data.reports.rejected);
    setText('#reports-corrections', data.reports.corrections);

    setText('#sanctions-today', data.sanctions.today);
    setText('#sanctions-week', data.sanctions.week);
    setText('#sanctions-month', data.sanctions.month);
    setText('#sanctions-pending', data.sanctions.pendingValidation);

    const backup = data.system.latestBackup;

    $('#system-data').innerHTML = `
      <dt>Node.js</dt><dd>${data.system.nodeVersion}</dd>
      <dt>Uptime</dt><dd>${formatUptime(data.system.processUptimeSeconds)}</dd>
      <dt>Mémoire Abyss</dt><dd>${data.system.processMemoryMb} Mo</dd>
      <dt>Mémoire système</dt><dd>${data.system.systemMemoryPercent}%</dd>
      <dt>Base SQLite</dt><dd>${formatBytes(data.system.databaseBytes)}</dd>
      <dt>Dernière sauvegarde</dt>
      <dd>${backup ? formatDate(backup.createdAt) : 'Aucune'}</dd>
    `;

    renderDepartments(data.departments);
    renderTrends(data.trends);
    renderAlerts(data.recentAlerts);
  }

  $('#refresh-direction').addEventListener('click', () => {
    load()
      .then(() => show('Dashboard actualisé.'))
      .catch((error) => show(error.message));
  });

  load().catch((error) => show(error.message));

  setInterval(() => {
    load().catch(() => {});
  }, 30000);
})();
