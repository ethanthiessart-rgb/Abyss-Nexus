'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');
const { publishNotification } = require('./realtime-notifications');

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    : [];
}

function resolveRecipients(all, audienceType, departments, userIds) {
  if (audienceType === 'global') {
    return all(`
      SELECT id
      FROM users
      WHERE status = 'active'
    `);
  }

  if (audienceType === 'departments') {
    if (!departments.length) return [];

    const placeholders = departments.map(() => '?').join(',');

    return all(`
      SELECT id
      FROM users
      WHERE status = 'active'
        AND department IN (${placeholders})
    `, departments);
  }

  if (audienceType === 'users') {
    if (!userIds.length) return [];

    const placeholders = userIds.map(() => '?').join(',');

    return all(`
      SELECT id
      FROM users
      WHERE status = 'active'
        AND id IN (${placeholders})
    `, userIds);
  }

  return [];
}

function registerCommunicationCenterRoutes(app) {
  app.get(
    '/api/communication-center/meta',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const users = all(`
        SELECT id, discord_username, matricule, department
        FROM users
        WHERE status = 'active'
        ORDER BY discord_username COLLATE NOCASE
      `);

      const templates = all(`
        SELECT id, name, title, content, priority
        FROM communication_templates
        ORDER BY name COLLATE NOCASE
      `);

      res.json({
        ok: true,
        users: users.map((user) => ({
          id: user.id,
          username: user.discord_username,
          matricule: user.matricule,
          department: user.department
        })),
        departments: [
          ...new Set(users.map((user) => user.department).filter(Boolean))
        ],
        templates
      });
    }
  );

  app.get(
    '/api/communication-center/campaigns',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const rows = all(`
        SELECT c.id, c.title, c.content, c.priority,
               c.audience_type, c.audience_json, c.status,
               c.scheduled_at, c.sent_at, c.created_at,
               u.discord_username AS author_name,
               (
                 SELECT COUNT(*)
                 FROM communication_receipts cr
                 WHERE cr.campaign_id = c.id
               ) AS recipient_count,
               (
                 SELECT COUNT(*)
                 FROM communication_receipts cr
                 WHERE cr.campaign_id = c.id
                   AND cr.read_at IS NOT NULL
               ) AS read_count
        FROM communication_campaigns c
        LEFT JOIN users u ON u.id = c.created_by_user_id
        ORDER BY c.created_at DESC
        LIMIT 300
      `);

      res.json({
        ok: true,
        campaigns: rows.map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          priority: row.priority,
          audienceType: row.audience_type,
          audience: row.audience_json
            ? JSON.parse(row.audience_json)
            : {},
          status: row.status,
          scheduledAt: row.scheduled_at,
          sentAt: row.sent_at,
          createdAt: row.created_at,
          authorName: row.author_name || 'Système',
          recipientCount: Number(row.recipient_count || 0),
          readCount: Number(row.read_count || 0)
        }))
      });
    }
  );

  app.post(
    '/api/communication-center/campaigns',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const title = clean(req.body.title);
      const content = clean(req.body.content);
      const priority = clean(req.body.priority) || 'normal';
      const audienceType = clean(req.body.audienceType);
      const departments = normalizeList(req.body.departments);
      const userIds = Array.isArray(req.body.userIds)
        ? [...new Set(req.body.userIds.map(Number).filter(Number.isInteger))]
        : [];
      const scheduledAt = clean(req.body.scheduledAt) || null;
      const sendNow = Boolean(req.body.sendNow);

      if (title.length < 3 || content.length < 5) {
        return res.status(400).json({
          ok: false,
          message: 'Le titre ou le contenu est trop court.'
        });
      }

      if (!['normal', 'important', 'urgent', 'critical'].includes(priority)) {
        return res.status(400).json({
          ok: false,
          message: 'Priorité invalide.'
        });
      }

      if (!['global', 'departments', 'users'].includes(audienceType)) {
        return res.status(400).json({
          ok: false,
          message: 'Audience invalide.'
        });
      }

      const { one, all, run } = getDatabaseHelpers();
      const recipients = resolveRecipients(
        all,
        audienceType,
        departments,
        userIds
      ).filter((item) => item.id !== req.session.user.id);

      if (!recipients.length) {
        return res.status(400).json({
          ok: false,
          message: 'Aucun destinataire valide.'
        });
      }

      const status = sendNow ? 'sent' : scheduledAt ? 'scheduled' : 'draft';

      run(`
        INSERT INTO communication_campaigns (
          title, content, priority, audience_type,
          audience_json, status, scheduled_at,
          sent_at, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        title,
        content,
        priority,
        audienceType,
        JSON.stringify({ departments, userIds }),
        status,
        scheduledAt,
        sendNow ? new Date().toISOString() : null,
        req.session.user.id
      ]);

      const campaignId = Number(
        one('SELECT MAX(id) AS id FROM communication_campaigns')?.id
      );

      for (const recipient of recipients) {
        run(`
          INSERT OR IGNORE INTO communication_receipts (
            campaign_id, user_id
          ) VALUES (?, ?)
        `, [campaignId, recipient.id]);

        if (sendNow) {
          run(`
            INSERT INTO notifications (
              user_id, type, title, message, link
            ) VALUES (?, 'communication', ?, ?, '/communication-center')
          `, [
            recipient.id,
            priority === 'critical'
              ? 'Communication critique'
              : priority === 'urgent'
                ? 'Communication urgente'
                : 'Nouvelle communication',
            `${title} — ${content.slice(0, 180)}`
          ]);

          publishNotification(recipient.id, {
            type: 'communication',
            title,
            message: content.slice(0, 220),
            link: '/communication-center'
          });
        }
      }

      res.status(201).json({
        ok: true,
        message: sendNow
          ? 'Communication envoyée.'
          : status === 'scheduled'
            ? 'Communication programmée.'
            : 'Brouillon enregistré.',
        campaignId,
        recipientCount: recipients.length
      });
    }
  );

  app.post(
    '/api/communication-center/campaigns/:id/send',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, all, run } = getDatabaseHelpers();

      const campaign = one(`
        SELECT id, title, content, priority, status
        FROM communication_campaigns
        WHERE id = ?
      `, [id]);

      if (!campaign) {
        return res.status(404).json({
          ok: false,
          message: 'Communication introuvable.'
        });
      }

      if (campaign.status === 'sent') {
        return res.status(409).json({
          ok: false,
          message: 'Cette communication a déjà été envoyée.'
        });
      }

      const recipients = all(`
        SELECT user_id
        FROM communication_receipts
        WHERE campaign_id = ?
      `, [id]);

      for (const recipient of recipients) {
        run(`
          INSERT INTO notifications (
            user_id, type, title, message, link
          ) VALUES (?, 'communication', ?, ?, '/communication-center')
        `, [
          recipient.user_id,
          campaign.priority === 'critical'
            ? 'Communication critique'
            : campaign.priority === 'urgent'
              ? 'Communication urgente'
              : 'Nouvelle communication',
          `${campaign.title} — ${campaign.content.slice(0, 180)}`
        ]);

        publishNotification(recipient.user_id, {
          type: 'communication',
          title: campaign.title,
          message: campaign.content.slice(0, 220),
          link: '/communication-center'
        });
      }

      run(`
        UPDATE communication_campaigns
        SET status = 'sent',
            sent_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [id]);

      res.json({
        ok: true,
        message: 'Communication envoyée.'
      });
    }
  );

  app.post(
    '/api/communication-center/templates',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const name = clean(req.body.name);
      const title = clean(req.body.title);
      const content = clean(req.body.content);
      const priority = clean(req.body.priority) || 'normal';
      const { run } = getDatabaseHelpers();

      if (name.length < 2 || title.length < 3 || content.length < 5) {
        return res.status(400).json({
          ok: false,
          message: 'Modèle invalide.'
        });
      }

      run(`
        INSERT INTO communication_templates (
          name, title, content, priority, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        name,
        title,
        content,
        priority,
        req.session.user.id
      ]);

      res.status(201).json({
        ok: true,
        message: 'Modèle enregistré.'
      });
    }
  );

  app.get('/api/communications/my', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({
        ok: false,
        message: 'Session expirée.'
      });
    }

    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT c.id, c.title, c.content, c.priority,
             c.sent_at, cr.read_at
      FROM communication_receipts cr
      JOIN communication_campaigns c ON c.id = cr.campaign_id
      WHERE cr.user_id = ?
        AND c.status = 'sent'
      ORDER BY c.sent_at DESC
      LIMIT 100
    `, [req.session.user.id]);

    res.json({
      ok: true,
      communications: rows
    });
  });

  app.post('/api/communications/:id/read', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({
        ok: false,
        message: 'Session expirée.'
      });
    }

    const id = Number(req.params.id);
    const { one, run } = getDatabaseHelpers();

    if (!one(`
      SELECT campaign_id
      FROM communication_receipts
      WHERE campaign_id = ? AND user_id = ?
    `, [id, req.session.user.id])) {
      return res.status(404).json({
        ok: false,
        message: 'Communication introuvable.'
      });
    }

    run(`
      UPDATE communication_receipts
      SET read_at = CURRENT_TIMESTAMP
      WHERE campaign_id = ? AND user_id = ?
    `, [id, req.session.user.id]);

    res.json({ ok: true });
  });
}

module.exports = { registerCommunicationCenterRoutes };
