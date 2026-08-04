'use strict';

const { getDatabaseHelpers } = require('./database');
const { hasPermission, requirePermission } = require('./permissions');

const REPORT_TYPES = [
  'Rapport général',
  'Rapport d’activité',
  'Rapport d’incident',
  'Rapport concernant un membre',
  'Rapport concernant un staff',
  'Rapport de réunion',
  'Rapport de formation',
  'Rapport confidentiel',
  'Autre'
];

const REPORT_STATUSES = [
  'draft',
  'submitted',
  'read',
  'needs_revision',
  'validated',
  'refused',
  'archived'
];

function clean(value) {
  return String(value ?? '').trim();
}

function nextReportNumber(one) {
  const row = one(`
    SELECT MAX(
      CASE
        WHEN report_number GLOB 'ANX-RPT-[0-9][0-9][0-9][0-9][0-9][0-9]'
        THEN CAST(SUBSTR(report_number, 9) AS INTEGER)
        ELSE 0
      END
    ) AS max_number
    FROM reports
  `);

  const next = Number(row?.max_number || 0) + 1;
  return `ANX-RPT-${String(next).padStart(6, '0')}`;
}

function mapReport(row) {
  return {
    id: row.id,
    reportNumber: row.report_number,
    title: row.title,
    reportType: row.report_type,
    content: row.content,
    confidential: Boolean(row.confidential),
    status: row.status,
    directionComment: row.direction_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    author: {
      id: row.author_id,
      username: row.discord_username,
      avatarUrl: row.avatar_url,
      matricule: row.matricule,
      grade: row.grade,
      department: row.department
    },
    reviewer: row.reviewer_username
      ? {
          username: row.reviewer_username,
          grade: row.reviewer_grade
        }
      : null
  };
}

function reportSelect() {
  return `
    SELECT
      r.id, r.report_number, r.author_id, r.title, r.report_type, r.content,
      r.confidential, r.status, r.direction_comment, r.created_at,
      r.updated_at, r.submitted_at, r.reviewed_at,
      u.discord_username, u.avatar_url, u.matricule, u.grade, u.department,
      reviewer.discord_username AS reviewer_username,
      reviewer.grade AS reviewer_grade
    FROM reports r
    JOIN users u ON u.id = r.author_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
  `;
}

function canReadReport(req, report) {
  if (report.author_id === req.session.user.id) return true;
  return hasPermission(req, 'reports.view_all');
}

function registerReportRoutes(app) {
  app.get('/api/reports/meta', requirePermission('reports.create'), (req, res) => {
    res.json({
      ok: true,
      reportTypes: REPORT_TYPES,
      canViewAll: hasPermission(req, 'reports.view_all'),
      currentUser: req.session.user
    });
  });

  app.get('/api/reports', requirePermission('reports.create'), (req, res) => {
    const { all } = getDatabaseHelpers();
    const canViewAll = hasPermission(req, 'reports.view_all');

    const rows = canViewAll
      ? all(`${reportSelect()} ORDER BY r.created_at DESC`)
      : all(
          `${reportSelect()} WHERE r.author_id = ? ORDER BY r.created_at DESC`,
          [req.session.user.id]
        );

    res.json({
      ok: true,
      reports: rows.map(mapReport)
    });
  });

  app.get('/api/reports/:id', requirePermission('reports.create'), (req, res) => {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ ok: false, message: 'Rapport invalide.' });
    }

    const { one, run } = getDatabaseHelpers();
    const row = one(`${reportSelect()} WHERE r.id = ?`, [reportId]);

    if (!row) {
      return res.status(404).json({ ok: false, message: 'Rapport introuvable.' });
    }

    if (!canReadReport(req, row)) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    if (
      hasPermission(req, 'reports.view_all') &&
      row.author_id !== req.session.user.id &&
      row.status === 'submitted'
    ) {
      run(
        `UPDATE reports
         SET status = 'read', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reportId]
      );
      row.status = 'read';
    }

    return res.json({
      ok: true,
      report: mapReport(row)
    });
  });

  app.post('/api/reports', requirePermission('reports.create'), (req, res) => {
    const title = clean(req.body.title);
    const reportType = clean(req.body.reportType);
    const content = clean(req.body.content);
    const saveAsDraft = Boolean(req.body.saveAsDraft);
    const confidential =
      Boolean(req.body.confidential) || reportType === 'Rapport confidentiel';

    if (!title || !REPORT_TYPES.includes(reportType) || !content) {
      return res.status(400).json({
        ok: false,
        message: 'Le titre, le type et le contenu sont obligatoires.'
      });
    }

    if (title.length > 140) {
      return res.status(400).json({
        ok: false,
        message: 'Le titre ne doit pas dépasser 140 caractères.'
      });
    }

    if (content.length > 20000) {
      return res.status(400).json({
        ok: false,
        message: 'Le rapport est trop long.'
      });
    }

    const { one, run } = getDatabaseHelpers();
    const reportNumber = nextReportNumber(one);
    const status = saveAsDraft ? 'draft' : 'submitted';
    const submittedAt = saveAsDraft ? null : new Date().toISOString();

    run(
      `INSERT INTO reports (
        report_number, author_id, title, report_type, content,
        confidential, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reportNumber,
        req.session.user.id,
        title,
        reportType,
        content,
        confidential ? 1 : 0,
        status,
        submittedAt
      ]
    );

    run(
      `INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, ?, ?, ?)`,
      [
        req.session.user.id,
        saveAsDraft ? 'REPORT_DRAFT_CREATE' : 'REPORT_SUBMIT',
        `Rapport=${reportNumber}`,
        req.ip
      ]
    );

    return res.status(201).json({
      ok: true,
      message: saveAsDraft ? 'Brouillon enregistré.' : 'Rapport envoyé.',
      reportNumber
    });
  });

  app.patch('/api/reports/:id/draft', requirePermission('reports.create'), (req, res) => {
    const reportId = Number(req.params.id);
    const title = clean(req.body.title);
    const reportType = clean(req.body.reportType);
    const content = clean(req.body.content);
    const confidential =
      Boolean(req.body.confidential) || reportType === 'Rapport confidentiel';

    const { one, run } = getDatabaseHelpers();
    const report = one(
      'SELECT id, author_id, status, report_number FROM reports WHERE id = ?',
      [reportId]
    );

    if (!report) {
      return res.status(404).json({ ok: false, message: 'Rapport introuvable.' });
    }

    if (report.author_id !== req.session.user.id || report.status !== 'draft') {
      return res.status(403).json({
        ok: false,
        message: 'Seul l’auteur peut modifier un brouillon.'
      });
    }

    if (!title || !REPORT_TYPES.includes(reportType) || !content) {
      return res.status(400).json({
        ok: false,
        message: 'Le titre, le type et le contenu sont obligatoires.'
      });
    }

    run(
      `UPDATE reports
       SET title = ?, report_type = ?, content = ?, confidential = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [title, reportType, content, confidential ? 1 : 0, reportId]
    );

    return res.json({ ok: true, message: 'Brouillon mis à jour.' });
  });

  app.post('/api/reports/:id/submit', requirePermission('reports.create'), (req, res) => {
    const reportId = Number(req.params.id);
    const { one, run } = getDatabaseHelpers();
    const report = one(
      'SELECT id, author_id, status, report_number FROM reports WHERE id = ?',
      [reportId]
    );

    if (!report) {
      return res.status(404).json({ ok: false, message: 'Rapport introuvable.' });
    }

    if (report.author_id !== req.session.user.id || report.status !== 'draft') {
      return res.status(403).json({
        ok: false,
        message: 'Ce brouillon ne peut pas être envoyé.'
      });
    }

    run(
      `UPDATE reports
       SET status = 'submitted',
           submitted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reportId]
    );

    run(
      `INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, ?, ?, ?)`,
      [
        req.session.user.id,
        'REPORT_SUBMIT',
        `Rapport=${report.report_number}`,
        req.ip
      ]
    );

    return res.json({ ok: true, message: 'Rapport envoyé.' });
  });

  app.patch(
    '/api/reports/:id/review',
    requirePermission('reports.view_all'),
    (req, res) => {
      const reportId = Number(req.params.id);
      const status = clean(req.body.status);
      const directionComment = clean(req.body.directionComment);

      if (!['read', 'needs_revision', 'validated', 'refused', 'archived'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: 'Statut de révision invalide.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const report = one(
        'SELECT id, report_number FROM reports WHERE id = ?',
        [reportId]
      );

      if (!report) {
        return res.status(404).json({ ok: false, message: 'Rapport introuvable.' });
      }

      run(
        `UPDATE reports
         SET status = ?, direction_comment = ?, reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          status,
          directionComment || null,
          req.session.user.id,
          reportId
        ]
      );

      run(
        `INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, ?, ?, ?)`,
        [
          req.session.user.id,
          'REPORT_REVIEW',
          `Rapport=${report.report_number}; Statut=${status}`,
          req.ip
        ]
      );

      return res.json({
        ok: true,
        message: 'Décision enregistrée.'
      });
    }
  );
}

module.exports = { registerReportRoutes };
