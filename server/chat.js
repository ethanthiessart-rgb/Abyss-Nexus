'use strict';

const { getDatabaseHelpers } = require('./database');
const { publishNotification } = require('./realtime-notifications');

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function clean(value) {
  return String(value ?? '').trim();
}

function registerChatRoutes(app) {
  app.get('/api/chat/meta', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();

    const users = all(`
      SELECT id, discord_username, matricule, grade, department, avatar_url
      FROM users
      WHERE status = 'active'
      ORDER BY discord_username COLLATE NOCASE
    `);

    const departments = [
      ...new Set(users.map((user) => user.department).filter(Boolean))
    ];

    res.json({
      ok: true,
      currentUser: req.session.user,
      users: users.map((user) => ({
        id: user.id,
        username: user.discord_username,
        matricule: user.matricule,
        grade: user.grade,
        department: user.department,
        avatarUrl: user.avatar_url
      })),
      departments
    });
  });

  app.get('/api/chat/conversations', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT c.id, c.name, c.type, c.department, c.created_at,
             cm.last_read_at,
             (
               SELECT body
               FROM chat_messages
               WHERE conversation_id = c.id
               ORDER BY created_at DESC
               LIMIT 1
             ) AS last_message,
             (
               SELECT created_at
               FROM chat_messages
               WHERE conversation_id = c.id
               ORDER BY created_at DESC
               LIMIT 1
             ) AS last_message_at
      FROM chat_conversations c
      JOIN chat_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ?
      ORDER BY COALESCE(last_message_at, c.created_at) DESC
    `, [req.session.user.id]);

    res.json({
      ok: true,
      conversations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        department: row.department,
        lastMessage: row.last_message,
        lastMessageAt: row.last_message_at,
        lastReadAt: row.last_read_at
      }))
    });
  });

  app.post('/api/chat/conversations', requireSession, (req, res) => {
    const type = clean(req.body.type);
    const name = clean(req.body.name);
    const department = clean(req.body.department);
    const memberIds = Array.isArray(req.body.memberIds)
      ? [...new Set(req.body.memberIds.map(Number).filter(Number.isInteger))]
      : [];

    if (!['private', 'group', 'department'].includes(type)) {
      return res.status(400).json({ ok: false, message: 'Type de conversation invalide.' });
    }

    if (type === 'department' && !department) {
      return res.status(400).json({ ok: false, message: 'Département obligatoire.' });
    }

    const { all, one, run } = getDatabaseHelpers();

    run(`
      INSERT INTO chat_conversations (
        name, type, department, created_by_user_id
      ) VALUES (?, ?, ?, ?)
    `, [
      name || (type === 'department' ? department : 'Conversation'),
      type,
      department || null,
      req.session.user.id
    ]);

    const conversationId = Number(
      one('SELECT MAX(id) AS id FROM chat_conversations')?.id
    );

    let members = [...memberIds, req.session.user.id];

    if (type === 'department') {
      members = all(`
        SELECT id
        FROM users
        WHERE department = ? AND status = 'active'
      `, [department]).map((item) => item.id);
    }

    members = [...new Set(members)];

    for (const userId of members) {
      run(`
        INSERT OR IGNORE INTO chat_members (
          conversation_id, user_id
        ) VALUES (?, ?)
      `, [conversationId, userId]);
    }

    res.status(201).json({
      ok: true,
      message: 'Conversation créée.',
      conversationId
    });
  });

  app.get('/api/chat/conversations/:id/messages', requireSession, (req, res) => {
    const conversationId = Number(req.params.id);
    const { one, all, run } = getDatabaseHelpers();

    if (!one(`
      SELECT 1
      FROM chat_members
      WHERE conversation_id = ? AND user_id = ?
    `, [conversationId, req.session.user.id])) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    const messages = all(`
      SELECT m.id, m.body, m.attachment_url, m.created_at,
             u.id AS sender_id, u.discord_username AS sender_name,
             u.avatar_url AS sender_avatar
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
      LIMIT 500
    `, [conversationId]);

    run(`
      UPDATE chat_members
      SET last_read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = ? AND user_id = ?
    `, [conversationId, req.session.user.id]);

    res.json({
      ok: true,
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        attachmentUrl: message.attachment_url,
        createdAt: message.created_at,
        sender: {
          id: message.sender_id,
          name: message.sender_name,
          avatarUrl: message.sender_avatar
        }
      }))
    });
  });

  app.post('/api/chat/conversations/:id/messages', requireSession, (req, res) => {
    const conversationId = Number(req.params.id);
    const body = clean(req.body.body);
    const attachmentUrl = clean(req.body.attachmentUrl);

    if (!body && !attachmentUrl) {
      return res.status(400).json({ ok: false, message: 'Message vide.' });
    }

    const { one, all, run } = getDatabaseHelpers();

    if (!one(`
      SELECT 1
      FROM chat_members
      WHERE conversation_id = ? AND user_id = ?
    `, [conversationId, req.session.user.id])) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    run(`
      INSERT INTO chat_messages (
        conversation_id, sender_user_id, body, attachment_url
      ) VALUES (?, ?, ?, ?)
    `, [
      conversationId,
      req.session.user.id,
      body || null,
      attachmentUrl || null
    ]);

    const recipients = all(`
      SELECT user_id
      FROM chat_members
      WHERE conversation_id = ? AND user_id != ?
    `, [conversationId, req.session.user.id]);

    for (const recipient of recipients) {
      run(`
        INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, 'chat', 'Nouveau message', ?, '/chat')
      `, [
        recipient.user_id,
        `${req.session.user.username} : ${body || 'Pièce jointe'}`
      ]);

      publishNotification(recipient.user_id, {
        type: 'chat',
        title: 'Nouveau message',
        message: `${req.session.user.username} : ${body || 'Pièce jointe'}`,
        link: '/chat'
      });
    }

    res.status(201).json({ ok: true, message: 'Message envoyé.' });
  });
}

module.exports = { registerChatRoutes };
