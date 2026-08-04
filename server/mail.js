'use strict';

const { getDatabaseHelpers } = require('./database');

function clean(value) {
  return String(value ?? '').trim();
}

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function messageSelect() {
  return `
    SELECT
      m.id, m.subject, m.body, m.priority, m.confidential, m.created_at,
      sender.id AS sender_id,
      sender.discord_username AS sender_username,
      sender.avatar_url AS sender_avatar,
      sender.matricule AS sender_matricule,
      sender.grade AS sender_grade,
      sender.department AS sender_department
    FROM mail_messages m
    JOIN users sender ON sender.id = m.sender_id
  `;
}

function mapMessage(row) {
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    priority: row.priority,
    confidential: Boolean(row.confidential),
    createdAt: row.created_at,
    sender: {
      id: row.sender_id,
      username: row.sender_username,
      avatarUrl: row.sender_avatar,
      matricule: row.sender_matricule,
      grade: row.sender_grade,
      department: row.sender_department
    },
    readAt: row.read_at || null
  };
}

function registerMailRoutes(app) {
  app.get('/api/mail/meta', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const users = all(`
      SELECT id, discord_username, matricule, grade, department
      FROM users
      WHERE status = 'active'
      ORDER BY discord_username COLLATE NOCASE
    `);

    const departments = [
      ...new Set(users.map((user) => user.department).filter(Boolean))
    ];

    res.json({
      ok: true,
      users: users.map((user) => ({
        id: user.id,
        username: user.discord_username,
        matricule: user.matricule,
        grade: user.grade,
        department: user.department
      })),
      departments,
      currentUser: req.session.user,
      canSendGlobal: req.session.user.accountType === 'direction'
    });
  });

  app.get('/api/mail/inbox', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const rows = all(`
      ${messageSelect()}
      JOIN mail_recipients mr ON mr.message_id = m.id
      WHERE mr.recipient_id = ? AND mr.deleted = 0
      ORDER BY m.created_at DESC
    `, [req.session.user.id]);

    res.json({
      ok: true,
      messages: rows.map((row) => ({
        ...mapMessage(row),
        readAt: row.read_at
      }))
    });
  });

  app.get('/api/mail/sent', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const rows = all(`
      ${messageSelect()}
      WHERE m.sender_id = ?
      ORDER BY m.created_at DESC
    `, [req.session.user.id]);

    res.json({ ok: true, messages: rows.map(mapMessage) });
  });

  app.get('/api/mail/:id', requireSession, (req, res) => {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return res.status(400).json({ ok: false, message: 'Message invalide.' });
    }

    const { one, all, run } = getDatabaseHelpers();
    const row = one(`${messageSelect()} WHERE m.id = ?`, [messageId]);

    if (!row) {
      return res.status(404).json({ ok: false, message: 'Message introuvable.' });
    }

    const recipient = one(
      'SELECT read_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
      [messageId, req.session.user.id]
    );

    const isSender = row.sender_id === req.session.user.id;
    if (!recipient && !isSender) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    if (recipient && !recipient.read_at) {
      run(
        `UPDATE mail_recipients
         SET read_at = CURRENT_TIMESTAMP
         WHERE message_id = ? AND recipient_id = ?`,
        [messageId, req.session.user.id]
      );

      run(
        `UPDATE notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND link = ? AND read_at IS NULL`,
        [req.session.user.id, `/mail?message=${messageId}`]
      );
    }

    const recipients = all(`
      SELECT u.id, u.discord_username, u.matricule, u.department, mr.read_at
      FROM mail_recipients mr
      JOIN users u ON u.id = mr.recipient_id
      WHERE mr.message_id = ?
      ORDER BY u.discord_username COLLATE NOCASE
    `, [messageId]);

    res.json({
      ok: true,
      message: {
        ...mapMessage(row),
        readAt: recipient?.read_at || null,
        recipients: recipients.map((item) => ({
          id: item.id,
          username: item.discord_username,
          matricule: item.matricule,
          department: item.department,
          readAt: item.read_at
        }))
      }
    });
  });

  app.post('/api/mail', requireSession, (req, res) => {
    const subject = clean(req.body.subject);
    const body = clean(req.body.body);
    const priority = clean(req.body.priority) || 'normal';
    const confidential = Boolean(req.body.confidential);
    const recipientType = clean(req.body.recipientType);
    const recipientIds = Array.isArray(req.body.recipientIds)
      ? req.body.recipientIds.map(Number).filter(Number.isInteger)
      : [];
    const department = clean(req.body.department);

    if (!subject || !body) {
      return res.status(400).json({
        ok: false,
        message: 'Le sujet et le contenu sont obligatoires.'
      });
    }

    if (!['normal', 'important', 'urgent', 'direction'].includes(priority)) {
      return res.status(400).json({ ok: false, message: 'Priorité invalide.' });
    }

    const { one, all, run } = getDatabaseHelpers();
    let recipients = [];

    if (recipientType === 'users') {
      if (!recipientIds.length) {
        return res.status(400).json({
          ok: false,
          message: 'Sélectionnez au moins un destinataire.'
        });
      }
      const placeholders = recipientIds.map(() => '?').join(',');
      recipients = all(
        `SELECT id FROM users WHERE id IN (${placeholders}) AND status = 'active'`,
        recipientIds
      );
    } else if (recipientType === 'department') {
      if (!department) {
        return res.status(400).json({
          ok: false,
          message: 'Sélectionnez un département.'
        });
      }
      recipients = all(
        'SELECT id FROM users WHERE department = ? AND status = ?',
        [department, 'active']
      );
    } else if (recipientType === 'global') {
      if (req.session.user.accountType !== 'direction') {
        return res.status(403).json({
          ok: false,
          message: 'Seule la Direction peut envoyer un message global.'
        });
      }
      recipients = all(
        'SELECT id FROM users WHERE status = ?',
        ['active']
      );
    } else {
      return res.status(400).json({
        ok: false,
        message: 'Type de destinataire invalide.'
      });
    }

    recipients = recipients.filter((item) => item.id !== req.session.user.id);

    if (!recipients.length) {
      return res.status(400).json({
        ok: false,
        message: 'Aucun destinataire valide.'
      });
    }

    run(
      `INSERT INTO mail_messages (
        sender_id, subject, body, priority, confidential
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        req.session.user.id,
        subject,
        body,
        priority,
        confidential ? 1 : 0
      ]
    );

    const created = one('SELECT MAX(id) AS id FROM mail_messages');
    const messageId = Number(created.id);

    for (const recipient of recipients) {
      run(
        `INSERT INTO mail_recipients (
          message_id, recipient_id
        ) VALUES (?, ?)`,
        [messageId, recipient.id]
      );

      run(
        `INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          recipient.id,
          'mail',
          priority === 'urgent' ? 'Message urgent' : 'Nouveau message',
          `${req.session.user.username} vous a envoyé : ${subject}`,
          `/mail?message=${messageId}`
        ]
      );
    }

    run(
      `INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, ?, ?, ?)`,
      [
        req.session.user.id,
        'MAIL_SEND',
        `Message=${messageId}; Destinataires=${recipients.length}`,
        req.ip
      ]
    );

    res.status(201).json({
      ok: true,
      message: 'Message envoyé.',
      messageId,
      recipientCount: recipients.length
    });
  });

  app.get('/api/notifications', requireSession, (req, res) => {
    const { all, one } = getDatabaseHelpers();

    const notifications = all(`
      SELECT id, type, title, message, link, read_at, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `, [req.session.user.id]);

    const countRow = one(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `, [req.session.user.id]);

    res.json({
      ok: true,
      unreadCount: Number(countRow?.count || 0),
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        message: item.message,
        link: item.link,
        readAt: item.read_at,
        createdAt: item.created_at
      }))
    });
  });

  app.post('/api/notifications/read-all', requireSession, (req, res) => {
    const { run } = getDatabaseHelpers();
    run(
      `UPDATE notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND read_at IS NULL`,
      [req.session.user.id]
    );

    res.json({ ok: true });
  });
}

module.exports = { registerMailRoutes };
