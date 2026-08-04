'use strict';

const { getDatabaseHelpers } = require('./database');

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function registerStatisticsRoutes(app) {
  app.get('/api/statistics', requireSession, (req, res) => {
    const { one, all } = getDatabaseHelpers();

    const users = one(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled
      FROM users
    `);

    const reports = one(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
        SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) AS validated,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts
      FROM reports
    `);

    const sanctions = one(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM sanctions
    `);

    const documents = one(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
      FROM documents
    `);

    const announcements = one(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
      FROM announcements
    `);

    const recentActivity = all(`
      SELECT a.action, a.details, a.created_at,
             COALESCE(u.discord_username, 'Système') AS actor
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT 12
    `);

    const departments = all(`
      SELECT department, COUNT(*) AS count
      FROM users
      WHERE status != 'archived'
      GROUP BY department
      ORDER BY count DESC, department
    `);

    res.json({
      ok: true,
      users: {
        total: Number(users?.total || 0),
        active: Number(users?.active || 0),
        suspended: Number(users?.suspended || 0),
        disabled: Number(users?.disabled || 0)
      },
      reports: {
        total: Number(reports?.total || 0),
        submitted: Number(reports?.submitted || 0),
        validated: Number(reports?.validated || 0),
        drafts: Number(reports?.drafts || 0)
      },
      sanctions: {
        total: Number(sanctions?.total || 0),
        active: Number(sanctions?.active || 0),
        cancelled: Number(sanctions?.cancelled || 0)
      },
      documents: {
        total: Number(documents?.total || 0),
        active: Number(documents?.active || 0),
        archived: Number(documents?.archived || 0)
      },
      announcements: {
        total: Number(announcements?.total || 0),
        active: Number(announcements?.active || 0),
        archived: Number(announcements?.archived || 0)
      },
      departments: departments.map((item) => ({
        department: item.department,
        count: Number(item.count || 0)
      })),
      recentActivity: recentActivity.map((item) => ({
        action: item.action,
        details: item.details,
        createdAt: item.created_at,
        actor: item.actor
      }))
    });
  });
}

module.exports = { registerStatisticsRoutes };
