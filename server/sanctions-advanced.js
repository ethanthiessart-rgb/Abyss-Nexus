'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerAdvancedSanctionRoutes(app) {
  app.get(
    '/api/sanctions-advanced',
    requirePermission('discipline.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const rows = all(`
        SELECT sa.*, employee.discord_username AS employee_name,
               employee.matricule AS employee_matricule,
               issuer.discord_username AS issuer_name,
               validator.discord_username AS validator_name
        FROM advanced_sanctions sa
        JOIN users employee ON employee.id = sa.employee_user_id
        JOIN users issuer ON issuer.id = sa.issued_by_user_id
        LEFT JOIN users validator ON validator.id = sa.validated_by_user_id
        ORDER BY sa.created_at DESC
      `);

      res.json({
        ok: true,
        sanctions: rows.map((row) => ({
          id: row.id,
          employeeUserId: row.employee_user_id,
          employeeName: row.employee_name,
          employeeMatricule: row.employee_matricule,
          issuerName: row.issuer_name,
          validatorName: row.validator_name,
          sanctionType: row.sanction_type,
          severity: row.severity,
          reason: row.reason,
          evidenceUrl: row.evidence_url,
          durationMinutes: row.duration_minutes,
          expiresAt: row.expires_at,
          status: row.status,
          appealText: row.appeal_text,
          createdAt: row.created_at
        }))
      });
    }
  );

  app.post(
    '/api/sanctions-advanced',
    requirePermission('discipline.manage'),
    (req, res) => {
      const employeeUserId = Number(req.body.employeeUserId);
      const sanctionType = clean(req.body.sanctionType);
      const severity = clean(req.body.severity);
      const reason = clean(req.body.reason);
      const evidenceUrl = clean(req.body.evidenceUrl);
      const durationMinutes = req.body.durationMinutes
        ? Number(req.body.durationMinutes)
        : null;
      const requiresValidation = req.body.requiresValidation !== false;

      if (
        !Number.isInteger(employeeUserId) ||
        !['warning', 'mute', 'kick', 'exclusion', 'ban'].includes(sanctionType) ||
        !['minor', 'moderate', 'major', 'critical'].includes(severity) ||
        reason.length < 5
      ) {
        return res.status(400).json({
          ok: false,
          message: 'Sanction avancée invalide.'
        });
      }

      const expiresAt = durationMinutes
        ? new Date(Date.now() + durationMinutes * 60000).toISOString()
        : null;

      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM users WHERE id = ?', [employeeUserId])) {
        return res.status(404).json({
          ok: false,
          message: 'Employé introuvable.'
        });
      }

      run(`
        INSERT INTO advanced_sanctions (
          employee_user_id, issued_by_user_id, sanction_type,
          severity, reason, evidence_url, duration_minutes,
          expires_at, status, requires_validation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        employeeUserId,
        req.session.user.id,
        sanctionType,
        severity,
        reason,
        evidenceUrl || null,
        durationMinutes,
        expiresAt,
        requiresValidation ? 'pending_validation' : 'active',
        requiresValidation ? 1 : 0
      ]);

      run(`
        INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, 'sanction', 'Nouvelle sanction', ?, '/employees')
      `, [employeeUserId, `${sanctionType} — ${reason}`]);

      res.status(201).json({
        ok: true,
        message: 'Sanction enregistrée.'
      });
    }
  );

  app.patch(
    '/api/sanctions-advanced/:id/validate',
    requirePermission('discipline.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const approved = Boolean(req.body.approved);
      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM advanced_sanctions WHERE id = ?', [id])) {
        return res.status(404).json({
          ok: false,
          message: 'Sanction introuvable.'
        });
      }

      run(`
        UPDATE advanced_sanctions
        SET status = ?, validated_by_user_id = ?,
            validated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        approved ? 'active' : 'rejected',
        req.session.user.id,
        id
      ]);

      res.json({
        ok: true,
        message: approved ? 'Sanction validée.' : 'Sanction refusée.'
      });
    }
  );

  app.patch(
    '/api/sanctions-advanced/:id/appeal',
    (req, res) => {
      if (!req.session.user) {
        return res.status(401).json({
          ok: false,
          message: 'Session expirée.'
        });
      }

      const id = Number(req.params.id);
      const appealText = clean(req.body.appealText);

      if (appealText.length < 5) {
        return res.status(400).json({
          ok: false,
          message: 'La contestation est trop courte.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const sanction = one(`
        SELECT id
        FROM advanced_sanctions
        WHERE id = ? AND employee_user_id = ?
      `, [id, req.session.user.id]);

      if (!sanction) {
        return res.status(404).json({
          ok: false,
          message: 'Sanction introuvable.'
        });
      }

      run(`
        UPDATE advanced_sanctions
        SET appeal_text = ?, appeal_status = 'pending'
        WHERE id = ?
      `, [appealText, id]);

      res.json({
        ok: true,
        message: 'Contestation envoyée.'
      });
    }
  );
}

module.exports = { registerAdvancedSanctionRoutes };
