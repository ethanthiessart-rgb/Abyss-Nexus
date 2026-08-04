'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function canManage(req) {
  return req.session.user.accountType === 'direction' ||
    (req.session.user.permissions || []).includes('personnel.edit');
}

function registerLeaveRoutes(app) {
  app.get('/api/leave', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = canManage(req)
      ? all(`
          SELECT lr.*, employee.discord_username AS employee_name,
                 employee.matricule AS employee_matricule,
                 reviewer.discord_username AS reviewer_name,
                 replacement.discord_username AS replacement_name
          FROM leave_requests lr
          JOIN users employee ON employee.id = lr.employee_user_id
          LEFT JOIN users reviewer ON reviewer.id = lr.reviewed_by_user_id
          LEFT JOIN users replacement ON replacement.id = lr.replacement_user_id
          ORDER BY lr.created_at DESC
        `)
      : all(`
          SELECT lr.*, employee.discord_username AS employee_name,
                 employee.matricule AS employee_matricule,
                 reviewer.discord_username AS reviewer_name,
                 replacement.discord_username AS replacement_name
          FROM leave_requests lr
          JOIN users employee ON employee.id = lr.employee_user_id
          LEFT JOIN users reviewer ON reviewer.id = lr.reviewed_by_user_id
          LEFT JOIN users replacement ON replacement.id = lr.replacement_user_id
          WHERE lr.employee_user_id = ?
          ORDER BY lr.created_at DESC
        `, [req.session.user.id]);

    res.json({
      ok: true,
      canManage: canManage(req),
      requests: rows.map((row) => ({
        id: row.id,
        employeeUserId: row.employee_user_id,
        employeeName: row.employee_name,
        employeeMatricule: row.employee_matricule,
        requestType: row.request_type,
        startAt: row.start_at,
        endAt: row.end_at,
        reason: row.reason,
        status: row.status,
        reviewerName: row.reviewer_name,
        reviewComment: row.review_comment,
        replacementUserId: row.replacement_user_id,
        replacementName: row.replacement_name,
        createdAt: row.created_at
      }))
    });
  });

  app.post('/api/leave', requireSession, (req, res) => {
    const requestType = clean(req.body.requestType);
    const startAt = clean(req.body.startAt);
    const endAt = clean(req.body.endAt);
    const reason = clean(req.body.reason);

    if (
      !['leave', 'absence', 'unavailability'].includes(requestType) ||
      !startAt ||
      !endAt ||
      new Date(endAt) < new Date(startAt) ||
      reason.length < 3
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Demande invalide.'
      });
    }

    const { run } = getDatabaseHelpers();

    run(`
      INSERT INTO leave_requests (
        employee_user_id, request_type, start_at, end_at,
        reason, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `, [
      req.session.user.id,
      requestType,
      startAt,
      endAt,
      reason
    ]);

    res.status(201).json({
      ok: true,
      message: 'Demande envoyée.'
    });
  });

  app.patch(
    '/api/leave/:id/review',
    requirePermission('personnel.edit'),
    (req, res) => {
      const id = Number(req.params.id);
      const status = clean(req.body.status);
      const reviewComment = clean(req.body.reviewComment);
      const replacementUserId = req.body.replacementUserId
        ? Number(req.body.replacementUserId)
        : null;

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: 'Décision invalide.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const request = one(`
        SELECT id, employee_user_id
        FROM leave_requests
        WHERE id = ?
      `, [id]);

      if (!request) {
        return res.status(404).json({
          ok: false,
          message: 'Demande introuvable.'
        });
      }

      run(`
        UPDATE leave_requests
        SET status = ?, reviewed_by_user_id = ?,
            review_comment = ?, replacement_user_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        status,
        req.session.user.id,
        reviewComment || null,
        replacementUserId,
        id
      ]);

      run(`
        INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, 'leave', ?, ?, '/leave')
      `, [
        request.employee_user_id,
        status === 'approved'
          ? 'Demande acceptée'
          : 'Demande refusée',
        reviewComment || 'Votre demande a été traitée.'
      ]);

      res.json({
        ok: true,
        message: 'Demande traitée.'
      });
    }
  );
}

module.exports = { registerLeaveRoutes };
