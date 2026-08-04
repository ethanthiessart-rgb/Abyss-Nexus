'use strict';

const { getDatabaseHelpers } = require('./database');
const { hasPermission } = require('./permissions');

const PRIORITIES = ['normal', 'important', 'urgent'];

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
    hasPermission(req, 'announcements.global');
}

function registerAnnouncementRoutes(app) {
  app.get('/api/announcements/meta', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const departments = all(
      `SELECT DISTINCT department FROM users
       WHERE department IS NOT NULL ORDER BY department`
    ).map((row) => row.department);

    res.json({
      ok: true,
      departments,
      canManage: canManage(req),
      currentUser: req.session.user
    });
  });

  app.get('/api/announcements', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const user = req.session.user;
    const rows = canManage(req)
      ? all(`
          SELECT a.*, u.discord_username AS author_name, u.grade AS author_grade
          FROM announcements a
          JOIN users u ON u.id = a.author_id
          WHERE a.archived_at IS NULL
          ORDER BY a.pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
        `)
      : all(`
          SELECT DISTINCT a.*, u.discord_username AS author_name, u.grade AS author_grade
          FROM announcements a
          JOIN users u ON u.id = a.author_id
          LEFT JOIN announcement_departments ad ON ad.announcement_id = a.id
          WHERE a.archived_at IS NULL
            AND a.status = 'published'
            AND (a.publish_at IS NULL OR a.publish_at <= CURRENT_TIMESTAMP)
            AND (a.global_visible = 1 OR ad.department = ?)
          ORDER BY a.pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
        `, [user.department]);

    res.json({
      ok: true,
      announcements: rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        priority: row.priority,
        imageUrl: row.image_url,
        globalVisible: Boolean(row.global_visible),
        pinned: Boolean(row.pinned),
        status: row.status,
        publishAt: row.publish_at,
        createdAt: row.created_at,
        authorName: row.author_name,
        authorGrade: row.author_grade
      }))
    });
  });

  app.post('/api/announcements', requireSession, (req, res) => {
    if (!canManage(req)) {
      return res.status(403).json({ ok: false, message: 'Permission insuffisante.' });
    }

    const title = clean(req.body.title);
    const content = clean(req.body.content);
    const priority = clean(req.body.priority) || 'normal';
    const imageUrl = clean(req.body.imageUrl) || null;
    const globalVisible = Boolean(req.body.globalVisible);
    const pinned = Boolean(req.body.pinned);
    const publishAt = clean(req.body.publishAt) || null;
    const departments = Array.isArray(req.body.departments)
      ? req.body.departments.map(clean).filter(Boolean)
      : [];

    if (!title || !content || !PRIORITIES.includes(priority)) {
      return res.status(400).json({
        ok: false,
        message: 'Titre, contenu et priorité valides sont obligatoires.'
      });
    }

    if (!globalVisible && departments.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Choisissez au moins un département ou activez l’annonce globale.'
      });
    }

    const status = publishAt && new Date(publishAt) > new Date()
      ? 'scheduled'
      : 'published';

    const { one, all, run } = getDatabaseHelpers();
    run(
      `INSERT INTO announcements (
        author_id, title, content, priority, image_url,
        global_visible, pinned, status, publish_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session.user.id,
        title,
        content,
        priority,
        imageUrl,
        globalVisible ? 1 : 0,
        pinned ? 1 : 0,
        status,
        publishAt
      ]
    );

    const created = one('SELECT MAX(id) AS id FROM announcements');
    const announcementId = Number(created.id);

    for (const department of departments) {
      run(
        `INSERT OR IGNORE INTO announcement_departments
         (announcement_id, department) VALUES (?, ?)`,
        [announcementId, department]
      );
    }

    const recipients = globalVisible
      ? all(`SELECT id FROM users WHERE status = 'active'`)
      : all(
          `SELECT id FROM users
           WHERE status = 'active'
             AND department IN (${departments.map(() => '?').join(',')})`,
          departments
        );

    if (status === 'published') {
      for (const recipient of recipients) {
        if (recipient.id === req.session.user.id) continue;
        run(
          `INSERT INTO notifications
           (user_id, type, title, message, link)
           VALUES (?, 'announcement', ?, ?, '/announcements')`,
          [
            recipient.id,
            priority === 'urgent' ? 'Annonce urgente' : 'Nouvelle annonce',
            title
          ]
        );
      }
    }

    run(
      `INSERT INTO audit_logs (user_id, action, details, ip_address)
       VALUES (?, 'ANNOUNCEMENT_CREATE', ?, ?)`,
      [
        req.session.user.id,
        `Annonce=${announcementId}; Global=${globalVisible}`,
        req.ip
      ]
    );

    res.status(201).json({ ok: true, message: 'Annonce enregistrée.' });
  });

  app.post('/api/announcements/:id/archive', requireSession, (req, res) => {
    if (!canManage(req)) {
      return res.status(403).json({ ok: false, message: 'Permission insuffisante.' });
    }

    const id = Number(req.params.id);
    const { one, run } = getDatabaseHelpers();
    if (!one('SELECT id FROM announcements WHERE id = ?', [id])) {
      return res.status(404).json({ ok: false, message: 'Annonce introuvable.' });
    }

    run(
      `UPDATE announcements SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    res.json({ ok: true, message: 'Annonce archivée.' });
  });
}

module.exports = { registerAnnouncementRoutes };
