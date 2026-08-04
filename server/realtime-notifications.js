'use strict';

const { EventEmitter } = require('node:events');
const { getDatabaseHelpers } = require('./database');

const bus = new EventEmitter();
bus.setMaxListeners(500);

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function publishNotification(userId, payload) {
  bus.emit(`user:${userId}`, payload);
}

function registerRealtimeNotificationRoutes(app) {
  app.get('/api/realtime-notifications', requireSession, (req, res) => {
    const { all, one } = getDatabaseHelpers();

    const category = String(req.query.category || '').trim();
    const params = [req.session.user.id];
    let where = 'WHERE user_id = ?';

    if (category) {
      where += ' AND type = ?';
      params.push(category);
    }

    const notifications = all(`
      SELECT id, type, title, message, link, read_at, created_at
      FROM notifications
      ${where}
      ORDER BY created_at DESC
      LIMIT 300
    `, params);

    const unread = one(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `, [req.session.user.id]);

    res.json({
      ok: true,
      unreadCount: Number(unread?.count || 0),
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

  app.get('/api/realtime-notifications/stream', requireSession, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const userId = req.session.user.id;
    const channel = `user:${userId}`;

    const send = (payload) => {
      res.write(`event: notification\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 25000);

    bus.on(channel, send);

    req.on('close', () => {
      clearInterval(heartbeat);
      bus.off(channel, send);
    });
  });

  app.post('/api/realtime-notifications/:id/read', requireSession, (req, res) => {
    const id = Number(req.params.id);
    const { one, run } = getDatabaseHelpers();

    if (!one(`
      SELECT id FROM notifications
      WHERE id = ? AND user_id = ?
    `, [id, req.session.user.id])) {
      return res.status(404).json({ ok: false, message: 'Notification introuvable.' });
    }

    run(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `, [id, req.session.user.id]);

    res.json({ ok: true });
  });

  app.post('/api/realtime-notifications/read-all', requireSession, (req, res) => {
    const { run } = getDatabaseHelpers();

    run(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND read_at IS NULL
    `, [req.session.user.id]);

    res.json({ ok: true, message: 'Toutes les notifications sont lues.' });
  });
}

module.exports = {
  registerRealtimeNotificationRoutes,
  publishNotification
};
