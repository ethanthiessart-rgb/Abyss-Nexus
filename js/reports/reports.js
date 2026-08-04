'use strict';

(() => {
  const state = {
    reports: [],
    filteredReports: [],
    reportTypes: [],
    selectedId: null,
    editingDraftId: null,
    canViewAll: false,
    currentUser: null
  };

  const $ = (selector) => document.querySelector(selector);
  const toast = $('#toast');
  const reportDialog = $('#report-dialog');

  const STATUS_LABELS = {
    draft: 'Brouillon',
    submitted: 'Envoyé',
    read: 'Lu par la Direction',
    needs_revision: 'À corriger',
    validated: 'Validé',
    refused: 'Refusé',
    archived: 'Archivé'
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

  function populateReportTypes() {
    $('#report-type').innerHTML = state.reportTypes
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
      .join('');

    $('#type-filter').innerHTML =
      '<option value="">Tous les types</option>' +
      state.reportTypes
        .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
        .join('');
  }

  function updateStats() {
    $('#report-total').textContent = state.reports.length;
    $('#report-pending').textContent = state.reports.filter((report) =>
      ['submitted', 'read', 'needs_revision'].includes(report.status)
    ).length;
    $('#report-validated').textContent = state.reports.filter(
      (report) => report.status === 'validated'
    ).length;
    $('#report-drafts').textContent = state.reports.filter(
      (report) => report.status === 'draft'
    ).length;
  }

  function applyFilters() {
    const query = $('#report-search').value.trim().toLowerCase();
    const status = $('#status-filter').value;
    const type = $('#type-filter').value;

    state.filteredReports = state.reports.filter((report) => {
      const haystack = [
        report.reportNumber,
        report.title,
        report.reportType,
        report.author.username,
        report.author.matricule,
        report.author.grade,
        report.author.department
      ].join(' ').toLowerCase();

      return (
        (!query || haystack.includes(query)) &&
        (!status || report.status === status) &&
        (!type || report.reportType === type)
      );
    });

    renderList();
  }

  function renderList() {
    $('#reports-list').innerHTML = state.filteredReports.map((report) => `
      <button class="report-item ${report.id === state.selectedId ? 'is-selected' : ''}" type="button" data-id="${report.id}">
        <div class="report-item-top">
          <div>
            <span class="report-number">${escapeHtml(report.reportNumber)}</span>
            <strong class="report-title">${escapeHtml(report.title)}</strong>
          </div>
          <span class="report-status" data-status="${report.status}">
            ${escapeHtml(STATUS_LABELS[report.status] || report.status)}
          </span>
        </div>
        <span class="report-author">${escapeHtml(report.author.username)} · ${escapeHtml(report.author.matricule)}</span>
        <small>${escapeHtml(report.reportType)} · ${escapeHtml(formatDate(report.createdAt))}</small>
      </button>
    `).join('');

    $('#reports-empty').hidden = state.filteredReports.length > 0;

    document.querySelectorAll('.report-item').forEach((button) => {
      button.addEventListener('click', () => selectReport(Number(button.dataset.id)));
    });
  }

  async function loadReports() {
    const data = await api('/api/reports');
    state.reports = data.reports;
    updateStats();
    applyFilters();
  }

  async function selectReport(id) {
    state.selectedId = id;
    renderList();

    try {
      const data = await api(`/api/reports/${id}`);
      const report = data.report;

      $('#report-placeholder').hidden = true;
      $('#report-detail').hidden = false;
      $('#detail-number').textContent = report.reportNumber;
      $('#detail-title').textContent = report.title;
      $('#detail-meta').textContent =
        `${report.reportType} · Créé le ${formatDate(report.createdAt)}${report.confidential ? ' · Confidentiel' : ''}`;

      const status = $('#detail-status');
      status.textContent = STATUS_LABELS[report.status] || report.status;
      status.dataset.status = report.status;

      $('#detail-avatar').src =
        report.author.avatarUrl || '/assets/logos/abyss-nexus-logo.png';
      $('#detail-author').textContent = report.author.username;
      $('#detail-author-info').textContent =
        `${report.author.matricule} · ${report.author.grade} · ${report.author.department}`;
      $('#detail-content').textContent = report.content;
      $('#detail-signature').textContent =
        `${report.author.username} — ${report.author.grade} — ${report.author.department}`;
      $('#detail-signature-date').textContent =
        `${report.author.matricule} · ${formatDate(report.submittedAt || report.createdAt)}`;

      const isAuthor = report.author.id === state.currentUser.id;
      const isDraft = report.status === 'draft';

      $('#author-actions').hidden = !(isAuthor && isDraft);
      $('#direction-review').hidden = !state.canViewAll;

      if (state.canViewAll) {
        $('#review-status').value =
          ['read', 'needs_revision', 'validated', 'refused', 'archived'].includes(report.status)
            ? report.status
            : 'read';
        $('#review-comment').value = report.directionComment || '';
      }

      $('#edit-draft').onclick = () => openReportDialog(report);
      $('#submit-draft').onclick = () => submitDraft(report.id);
    } catch (error) {
      showToast(error.message);
    }
  }

  function fillIdentityPreview() {
    const user = state.currentUser;
    $('#form-username').textContent = user.username;
    $('#form-matricule').textContent = user.matricule;
    $('#form-grade').textContent = user.grade;
    $('#form-department').textContent = user.department;
    $('#form-signature').textContent =
      `${user.username} — ${user.grade} — ${user.department}`;
  }

  function openReportDialog(report = null) {
    state.editingDraftId = report?.id || null;
    $('#report-dialog-title').textContent = report
      ? 'Modifier le brouillon'
      : 'Rédiger un rapport';

    $('#report-title').value = report?.title || '';
    $('#report-type').value = report?.reportType || state.reportTypes[0] || '';
    $('#report-confidential').checked = Boolean(report?.confidential);
    $('#report-content-input').value = report?.content || '';
    $('#report-form-message').textContent = '';

    fillIdentityPreview();
    reportDialog.showModal();
  }

  async function saveReport(saveAsDraft) {
    const payload = {
      title: $('#report-title').value.trim(),
      reportType: $('#report-type').value,
      confidential: $('#report-confidential').checked,
      content: $('#report-content-input').value.trim(),
      saveAsDraft
    };

    try {
      let data;

      if (state.editingDraftId) {
        data = await api(`/api/reports/${state.editingDraftId}/draft`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });

        if (!saveAsDraft) {
          await api(`/api/reports/${state.editingDraftId}/submit`, {
            method: 'POST'
          });
          data.message = 'Rapport envoyé.';
        }
      } else {
        data = await api('/api/reports', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      reportDialog.close();
      showToast(data.message);
      state.editingDraftId = null;
      await loadReports();
    } catch (error) {
      $('#report-form-message').textContent = error.message;
    }
  }

  async function submitDraft(id) {
    try {
      const data = await api(`/api/reports/${id}/submit`, { method: 'POST' });
      showToast(data.message);
      await loadReports();
      await selectReport(id);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function saveReview() {
    if (!state.selectedId) return;

    try {
      const data = await api(`/api/reports/${state.selectedId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: $('#review-status').value,
          directionComment: $('#review-comment').value.trim()
        })
      });

      showToast(data.message);
      await loadReports();
      await selectReport(state.selectedId);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function init() {
    try {
      const meta = await api('/api/reports/meta');
      state.reportTypes = meta.reportTypes;
      state.canViewAll = meta.canViewAll;
      state.currentUser = meta.currentUser;

      $('#personnel-link').hidden =
        !(state.currentUser.permissions || []).includes('personnel.view');

      populateReportTypes();
      fillIdentityPreview();
      await loadReports();
    } catch (error) {
      showToast(error.message);
      setTimeout(() => location.assign('/dashboard'), 1200);
    }
  }

  $('#report-search').addEventListener('input', applyFilters);
  $('#status-filter').addEventListener('change', applyFilters);
  $('#type-filter').addEventListener('change', applyFilters);

  $('#new-report-button').addEventListener('click', () => openReportDialog());
  $('#close-report-dialog').addEventListener('click', () => reportDialog.close());

  $('#report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveReport(false);
  });

  $('#save-draft').addEventListener('click', () => saveReport(true));
  $('#save-review').addEventListener('click', saveReview);

  $('#logout-button').addEventListener('click', async () => {
    try {
      const data = await api('/api/auth/logout', { method: 'POST' });
      location.assign(data.redirect || '/');
    } catch (error) {
      showToast(error.message);
    }
  });

  init();
})();
