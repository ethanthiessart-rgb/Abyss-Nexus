'use strict';

const bcrypt = require('bcryptjs');
const { getDatabaseHelpers } = require('./database');
const { getEffectivePermissions } = require('./permissions');

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      ok: false,
      message: 'Session expirée.'
    });
  }
  next();
}

function registerAccountRoutes(app) {
  app.get('/api/account/settings', requireSession, (req, res) => {
    const { one } = getDatabaseHelpers();

    const settings = one(`
      SELECT theme, animations_enabled, sounds_enabled,
             glow_enabled, desktop_notifications_enabled,
             auto_lock_minutes
      FROM user_settings
      WHERE user_id = ?
    `, [req.session.user.id]);

    res.json({
      ok: true,
      user: req.session.user,
      settings: {
        theme: settings?.theme || 'abyss-blue',
        animationsEnabled: settings
          ? Boolean(settings.animations_enabled)
          : true,
        soundsEnabled: settings
          ? Boolean(settings.sounds_enabled)
          : false,
        glowEnabled: settings
          ? Boolean(settings.glow_enabled)
          : true,
        desktopNotificationsEnabled: settings
          ? Boolean(settings.desktop_notifications_enabled)
          : false,
        autoLockMinutes: Number(settings?.auto_lock_minutes || 15)
      }
    });
  });

  app.put('/api/account/settings', requireSession, (req, res) => {
    const themes = new Set([
      'abyss-blue',
      'dark',
      'midnight',
      'crimson'
    ]);

    const theme = String(req.body.theme || 'abyss-blue');
    const autoLockMinutes = Number(req.body.autoLockMinutes);

    if (!themes.has(theme)) {
      return res.status(400).json({
        ok: false,
        message: 'Thème invalide.'
      });
    }

    if (
      !Number.isInteger(autoLockMinutes) ||
      autoLockMinutes < 1 ||
      autoLockMinutes > 240
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Le verrouillage automatique doit être compris entre 1 et 240 minutes.'
      });
    }

    const { run } = getDatabaseHelpers();

    run(`
      INSERT INTO user_settings (
        user_id, theme, animations_enabled, sounds_enabled,
        glow_enabled, desktop_notifications_enabled,
        auto_lock_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        theme = excluded.theme,
        animations_enabled = excluded.animations_enabled,
        sounds_enabled = excluded.sounds_enabled,
        glow_enabled = excluded.glow_enabled,
        desktop_notifications_enabled = excluded.desktop_notifications_enabled,
        auto_lock_minutes = excluded.auto_lock_minutes,
        updated_at = CURRENT_TIMESTAMP
    `, [
      req.session.user.id,
      theme,
      req.body.animationsEnabled ? 1 : 0,
      req.body.soundsEnabled ? 1 : 0,
      req.body.glowEnabled ? 1 : 0,
      req.body.desktopNotificationsEnabled ? 1 : 0,
      autoLockMinutes
    ]);

    res.json({
      ok: true,
      message: 'Préférences enregistrées.'
    });
  });

  app.post('/api/account/change-password', requireSession, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (newPassword.length < 8) {
      return res.status(400).json({
        ok: false,
        message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.'
      });
    }

    const { one, run } = getDatabaseHelpers();

    const user = one(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.session.user.id]
    );

    const valid = user
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : false;

    if (!valid) {
      return res.status(401).json({
        ok: false,
        message: 'Mot de passe actuel incorrect.'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    run(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, req.session.user.id]
    );

    run(`
      INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, 'PASSWORD_CHANGED', 'Mot de passe modifié par l’utilisateur', ?)
    `, [req.session.user.id, req.ip]);

    res.json({
      ok: true,
      message: 'Mot de passe modifié.'
    });
  });

  app.post('/api/account/verify-password', requireSession, async (req, res) => {
    const password = String(req.body.password || '');
    const { one } = getDatabaseHelpers();

    const user = one(
      'SELECT password_hash, department FROM users WHERE id = ?',
      [req.session.user.id]
    );

    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!valid) {
      return res.status(401).json({
        ok: false,
        message: 'Mot de passe incorrect.'
      });
    }

    const { one: dbOne, all } = getDatabaseHelpers();

    req.session.user.permissions = getEffectivePermissions(
      req.session.user.id,
      user.department,
      dbOne,
      all
    );

    res.json({
      ok: true,
      message: 'Session déverrouillée.'
    });
  });
}

module.exports = { registerAccountRoutes };
