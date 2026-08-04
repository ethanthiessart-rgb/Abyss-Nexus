'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function registerArchiveRoutes(app) {
  app.get(
    '/api/archives',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const type = String(req.query.type || 'all');
      const { all } = getDatabaseHelpers();
      const items = [];

      if (type === 'all' || type === 'announcements') {
        for (const row of all(`
          SELECT a.id, a.title, a.archived_at,
                 u.discord_username AS actor
          FROM announcements a
          JOIN users u ON u.id = a.author_id
          WHERE a.archived_at IS NOT NULL
          ORDER BY a.archived_at DESC
        `)) {
          items.push({
            type: 'announcement',
            id: row.id,
            title: row.title,
            subtitle: `Auteur : ${row.actor}`,
            archivedAt: row.archived_at
          });
        }
      }

      if (type === 'all' || type === 'documents') {
        for (const row of all(`
          SELECT d.id, d.title, d.original_name, d.archived_at,
                 u.discord_username AS actor
          FROM documents d
          JOIN users u ON u.id = d.uploader_id
          WHERE d.archived_at IS NOT NULL
          ORDER BY d.archived_at DESC
        `)) {
          items.push({
            type: 'document',
            id: row.id,
            title: row.title,
            subtitle: `${row.original_name} · Importé par ${row.actor}`,
            archivedAt: row.archived_at
          });
        }
      }

      if (type === 'all' || type === 'reports') {
        for (const row of all(`
          SELECT r.id, r.report_number, r.title, r.updated_at,
                 u.discord_username AS actor
          FROM reports r
          JOIN users u ON u.id = r.author_id
          WHERE r.status = 'archived'
          ORDER BY r.updated_at DESC
        `)) {
          items.push({
            type: 'report',
            id: row.id,
            title: `${row.report_number} — ${row.title}`,
            subtitle: `Auteur : ${row.actor}`,
            archivedAt: row.updated_at
          });
        }
      }

      if (type === 'all' || type === 'sanctions') {
        for (const row of all(`
          SELECT s.id, s.sanction_number, s.sanction_type,
                 s.created_at, u.discord_username AS target
          FROM sanctions s
          JOIN users u ON u.id = s.target_user_id
          WHERE s.status IN ('archived', 'cancelled', 'expired')
          ORDER BY s.created_at DESC
        `)) {
          items.push({
            type: 'sanction',
            id: row.id,
            title: `${row.sanction_number} — ${row.sanction_type}`,
            subtitle: `Membre : ${row.target}`,
            archivedAt: row.created_at
          });
        }
      }

      if (type === 'all' || type === 'personnel') {
        for (const row of all(`
          SELECT id, discord_username, matricule, grade,
                 department, created_at
          FROM users
          WHERE status = 'archived'
          ORDER BY created_at DESC
        `)) {
          items.push({
            type: 'personnel',
            id: row.id,
            title: `${row.discord_username} — ${row.matricule}`,
            subtitle: `${row.grade} · ${row.department}`,
            archivedAt: row.created_at
          });
        }
      }

      items.sort((a, b) =>
        String(b.archivedAt || '').localeCompare(String(a.archivedAt || ''))
      );

      res.json({ ok: true, items });
    }
  );
}

module.exports = { registerArchiveRoutes };
