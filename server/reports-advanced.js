'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerAdvancedReportRoutes(app) {
  app.get('/api/reports-advanced', requirePermission('reports.create'), (req, res) => {
    const { all } = getDatabaseHelpers();
    const canReview = (req.session.user.permissions || []).includes('reports.review');

    const rows = canReview
      ? all(`
          SELECT ar.*, author.discord_username AS author_name,
                 reviewer.discord_username AS reviewer_name
          FROM advanced_reports ar
          JOIN users author ON author.id = ar.author_user_id
          LEFT JOIN users reviewer ON reviewer.id = ar.reviewed_by_user_id
          ORDER BY ar.updated_at DESC
        `)
      : all(`
          SELECT ar.*, author.discord_username AS author_name,
                 reviewer.discord_username AS reviewer_name
          FROM advanced_reports ar
          JOIN users author ON author.id = ar.author_user_id
          LEFT JOIN users reviewer ON reviewer.id = ar.reviewed_by_user_id
          WHERE ar.author_user_id = ?
          ORDER BY ar.updated_at DESC
        `, [req.session.user.id]);

    res.json({
      ok: true,
      canReview,
      reports: rows.map((row) => ({
        id: row.id,
        reportNumber: row.report_number,
        title: row.title,
        content: row.content,
        status: row.status,
        priority: row.priority,
        departments: row.target_departments
          ? JSON.parse(row.target_departments)
          : [],
        attachmentUrl: row.attachment_url,
        signature: row.signature,
        reviewComment: row.review_comment,
        authorName: row.author_name,
        reviewerName: row.reviewer_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  });

  app.post('/api/reports-advanced', requirePermission('reports.create'), (req, res) => {
    const title = clean(req.body.title);
    const content = clean(req.body.content);
    const priority = clean(req.body.priority) || 'normal';
    const status = clean(req.body.status) || 'draft';
    const attachmentUrl = clean(req.body.attachmentUrl);
    const signature = clean(req.body.signature);
    const departments = Array.isArray(req.body.departments)
      ? req.body.departments.map(String).filter(Boolean)
      : [];

    if (
      title.length < 3 ||
      content.length < 10 ||
      !['normal', 'important', 'urgent'].includes(priority) ||
      !['draft', 'submitted'].includes(status)
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Rapport avancé invalide.'
      });
    }

    const { one, run } = getDatabaseHelpers();
    const next = Number(
      one('SELECT COUNT(*) AS count FROM advanced_reports')?.count || 0
    ) + 1;
    const reportNumber = `ANX-RAP-${String(next).padStart(6, '0')}`;

    run(`
      INSERT INTO advanced_reports (
        report_number, author_user_id, title, content,
        priority, status, target_departments,
        attachment_url, signature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      reportNumber,
      req.session.user.id,
      title,
      content,
      priority,
      status,
      JSON.stringify(departments),
      attachmentUrl || null,
      signature || null
    ]);

    const created = one('SELECT MAX(id) AS id FROM advanced_reports');
    const reportId = Number(created.id);

    run(`
      INSERT INTO advanced_report_versions (
        report_id, version_number, content,
        changed_by_user_id
      ) VALUES (?, 1, ?, ?)
    `, [reportId, content, req.session.user.id]);

    res.status(201).json({
      ok: true,
      message: status === 'submitted'
        ? 'Rapport envoyé.'
        : 'Brouillon enregistré.',
      reportNumber
    });
  });

  app.patch(
    '/api/reports-advanced/:id/review',
    requirePermission('reports.review'),
    (req, res) => {
      const id = Number(req.params.id);
      const status = clean(req.body.status);
      const reviewComment = clean(req.body.reviewComment);

      if (!['validated', 'rejected', 'changes_requested'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: 'Décision invalide.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const report = one(`
        SELECT id, author_user_id, report_number
        FROM advanced_reports
        WHERE id = ?
      `, [id]);

      if (!report) {
        return res.status(404).json({
          ok: false,
          message: 'Rapport introuvable.'
        });
      }

      run(`
        UPDATE advanced_reports
        SET status = ?, review_comment = ?,
            reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        status,
        reviewComment || null,
        req.session.user.id,
        id
      ]);

      run(`
        INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, 'report', ?, ?, '/reports-advanced')
      `, [
        report.author_user_id,
        `Rapport ${status}`,
        reviewComment || report.report_number
      ]);

      res.json({
        ok: true,
        message: 'Rapport traité.'
      });
    }
  );
}

module.exports = { registerAdvancedReportRoutes };
