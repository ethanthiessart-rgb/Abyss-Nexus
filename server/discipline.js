'use strict';

const { getDatabaseHelpers } = require('./database');
const { hasPermission, requirePermission } = require('./permissions');

const SANCTION_TYPES = [
  {
    key: 'blame_1',
    label: 'Blâme I',
    severity: 'minor',
    trustPenalty: 5
  },
  {
    key: 'blame_2',
    label: 'Blâme II',
    severity: 'important',
    trustPenalty: 10
  },
  {
    key: 'blame_3',
    label: 'Blâme III directionnel',
    severity: 'serious',
    trustPenalty: 20
  },
  {
    key: 'directional_suspension',
    label: 'Suspension directionnelle',
    severity: 'very_serious',
    trustPenalty: 35
  },
  {
    key: 'pending_dismissal',
    label: 'Attente de licenciement directionnel',
    severity: 'critical',
    trustPenalty: 60
  }
];

function clean(value) {
  return String(value ?? '').trim();
}

function nextSanctionNumber(one) {
  const row = one(`
    SELECT MAX(
      CASE
        WHEN sanction_number GLOB 'ANX-SAN-[0-9][0-9][0-9][0-9][0-9][0-9]'
        THEN CAST(SUBSTR(sanction_number, 9) AS INTEGER)
        ELSE 0
      END
    ) AS max_number
    FROM sanctions
  `);

  const next = Number(row?.max_number || 0) + 1;
  return `ANX-SAN-${String(next).padStart(6, '0')}`;
}

function canManage(req) {
  return hasPermission(req, 'discipline.manage');
}

function getDuration(durationKey, customDays) {
  if (durationKey === 'permanent') {
    return { label: 'Permanent', endsAt: null };
  }

  const mapping = {
    '3d': 3,
    '7d': 7,
    '14d': 14,
    '30d': 30
  };

  const days = durationKey === 'custom'
    ? Number(customDays)
    : mapping[durationKey];

  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return null;
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() + days);

  return {
    label: `${days} jour${days > 1 ? 's' : ''}`,
    endsAt: end.toISOString()
  };
}

function mapSanction(row) {
  return {
    id: row.id,
    sanctionNumber: row.sanction_number,
    sanctionType: row.sanction_type,
    severity: row.severity,
    reason: row.reason,
    comment: row.comment,
    durationLabel: row.duration_label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancelledReason: row.cancelled_reason,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    target: {
      id: row.target_user_id,
      username: row.target_username,
      avatarUrl: row.target_avatar,
      matricule: row.target_matricule,
      grade: row.target_grade,
      department: row.target_department
    },
    issuer: {
      id: row.issuer_id,
      username: row.issuer_username,
      grade: row.issuer_grade,
      department: row.issuer_department
    }
  };
}

function sanctionSelect() {
  return `
    SELECT
      s.id, s.sanction_number, s.sanction_type, s.severity, s.reason,
      s.comment, s.duration_label, s.starts_at, s.ends_at, s.status,
      s.cancelled_reason, s.cancelled_at, s.created_at,
      target.id AS target_user_id,
      target.discord_username AS target_username,
      target.avatar_url AS target_avatar,
      target.matricule AS target_matricule,
      target.grade AS target_grade,
      target.department AS target_department,
      issuer.id AS issuer_id,
      issuer.discord_username AS issuer_username,
      issuer.grade AS issuer_grade,
      issuer.department AS issuer_department
    FROM sanctions s
    JOIN users target ON target.id = s.target_user_id
    JOIN users issuer ON issuer.id = s.issued_by_user_id
  `;
}

function registerDisciplineRoutes(app) {
  app.get('/api/discipline/meta', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, message: 'Session expirée.' });
    }

    const { all } = getDatabaseHelpers();
    const users = canManage(req)
      ? all(`
          SELECT id, discord_username, avatar_url, matricule, grade, department, status
          FROM users
          WHERE status != 'archived'
          ORDER BY discord_username COLLATE NOCASE
        `)
      : [];

    res.json({
      ok: true,
      canManage: canManage(req),
      sanctionTypes: SANCTION_TYPES,
      currentUser: req.session.user,
      users: users.map((user) => ({
        id: user.id,
        username: user.discord_username,
        avatarUrl: user.avatar_url,
        matricule: user.matricule,
        grade: user.grade,
        department: user.department,
        status: user.status
      }))
    });
  });

  app.get('/api/discipline', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, message: 'Session expirée.' });
    }

    const { all } = getDatabaseHelpers();
    const rows = canManage(req)
      ? all(`${sanctionSelect()} ORDER BY s.created_at DESC`)
      : all(
          `${sanctionSelect()}
           WHERE s.target_user_id = ?
           ORDER BY s.created_at DESC`,
          [req.session.user.id]
        );

    res.json({
      ok: true,
      sanctions: rows.map(mapSanction)
    });
  });

  app.get('/api/discipline/user/:id', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, message: 'Session expirée.' });
    }

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ ok: false, message: 'Employé invalide.' });
    }

    if (!canManage(req) && targetId !== req.session.user.id) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    const { one, all } = getDatabaseHelpers();
    const user = one(`
      SELECT id, discord_username, avatar_url, matricule, grade, department, status, created_at
      FROM users
      WHERE id = ?
    `, [targetId]);

    if (!user) {
      return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
    }

    const rows = all(
      `${sanctionSelect()}
       WHERE s.target_user_id = ?
       ORDER BY s.created_at DESC`,
      [targetId]
    );

    const sanctions = rows.map(mapSanction);
    const active = sanctions.filter((item) => item.status === 'active');

    const penalty = active.reduce((total, item) => {
      const definition = SANCTION_TYPES.find((entry) => entry.key === item.sanctionType);
      return total + (definition?.trustPenalty || 0);
    }, 0);

    const trustIndex = Math.max(0, 100 - penalty);

    let surveillanceLevel = 'Normal';
    if (trustIndex < 80) surveillanceLevel = 'Sous surveillance';
    if (trustIndex < 60) surveillanceLevel = 'Haute surveillance';
    if (trustIndex < 35) surveillanceLevel = 'Critique';
    if (active.some((item) => item.sanctionType === 'pending_dismissal')) {
      surveillanceLevel = 'Direction';
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.discord_username,
        avatarUrl: user.avatar_url,
        matricule: user.matricule,
        grade: user.grade,
        department: user.department,
        status: user.status,
        createdAt: user.created_at
      },
      sanctions,
      trustIndex,
      surveillanceLevel
    });
  });

  app.post(
    '/api/discipline',
    requirePermission('discipline.manage'),
    (req, res) => {
      const targetUserId = Number(req.body.targetUserId);
      const sanctionType = clean(req.body.sanctionType);
      const reason = clean(req.body.reason);
      const comment = clean(req.body.comment);
      const durationKey = clean(req.body.durationKey) || 'permanent';
      const customDays = Number(req.body.customDays);

      const definition = SANCTION_TYPES.find((item) => item.key === sanctionType);
      if (!definition) {
        return res.status(400).json({ ok: false, message: 'Sanction invalide.' });
      }

      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ ok: false, message: 'Employé invalide.' });
      }

      if (reason.length < 5 || reason.length > 1000) {
        return res.status(400).json({
          ok: false,
          message: 'Le motif doit contenir entre 5 et 1000 caractères.'
        });
      }

      const duration = getDuration(durationKey, customDays);
      if (!duration) {
        return res.status(400).json({ ok: false, message: 'Durée invalide.' });
      }

      const { one, run } = getDatabaseHelpers();
      const target = one(
        'SELECT id, discord_username FROM users WHERE id = ?',
        [targetUserId]
      );

      if (!target) {
        return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
      }

      const sanctionNumber = nextSanctionNumber(one);

      run(
        `INSERT INTO sanctions (
          sanction_number, target_user_id, issued_by_user_id,
          sanction_type, severity, reason, comment,
          duration_label, ends_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          sanctionNumber,
          targetUserId,
          req.session.user.id,
          definition.key,
          definition.severity,
          reason,
          comment || null,
          duration.label,
          duration.endsAt
        ]
      );

      run(
        `INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          targetUserId,
          'sanction',
          'Nouvelle sanction reçue',
          `${definition.label} — ${reason}`,
          '/discipline'
        ]
      );

      run(
        `INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, ?, ?, ?)`,
        [
          req.session.user.id,
          'SANCTION_CREATE',
          `Sanction=${sanctionNumber}; Cible=${targetUserId}; Type=${definition.key}`,
          req.ip
        ]
      );

      res.status(201).json({
        ok: true,
        message: 'Sanction appliquée.',
        sanctionNumber
      });
    }
  );

  app.post(
    '/api/discipline/:id/cancel',
    requirePermission('discipline.manage'),
    (req, res) => {
      const sanctionId = Number(req.params.id);
      const reason = clean(req.body.reason);

      if (!Number.isInteger(sanctionId) || sanctionId <= 0) {
        return res.status(400).json({ ok: false, message: 'Sanction invalide.' });
      }

      if (reason.length < 5) {
        return res.status(400).json({
          ok: false,
          message: 'Indiquez le motif de l’annulation.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const sanction = one(`
        SELECT id, sanction_number, target_user_id, status
        FROM sanctions
        WHERE id = ?
      `, [sanctionId]);

      if (!sanction) {
        return res.status(404).json({ ok: false, message: 'Sanction introuvable.' });
      }

      if (sanction.status !== 'active') {
        return res.status(409).json({
          ok: false,
          message: 'Cette sanction n’est plus active.'
        });
      }

      run(
        `UPDATE sanctions
         SET status = 'cancelled',
             cancelled_reason = ?,
             cancelled_by_user_id = ?,
             cancelled_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reason, req.session.user.id, sanctionId]
      );

      run(
        `INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          sanction.target_user_id,
          'sanction',
          'Sanction annulée',
          `${sanction.sanction_number} a été annulée.`,
          '/discipline'
        ]
      );

      run(
        `INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, ?, ?, ?)`,
        [
          req.session.user.id,
          'SANCTION_CANCEL',
          `Sanction=${sanction.sanction_number}`,
          req.ip
        ]
      );

      res.json({ ok: true, message: 'Sanction annulée.' });
    }
  );
}

module.exports = { registerDisciplineRoutes };
