'use strict';

const bcrypt = require('bcryptjs');
const { getDatabaseHelpers } = require('./database');
const { getEffectivePermissions } = require('./permissions');

function normalize(value) {
  return String(value || '').trim();
}

function registerAuthRoutes(app) {
  app.post('/api/auth/login', async (req, res) => {
    const matricule = normalize(req.body.matricule).toUpperCase();
    const identifier = normalize(req.body.identifier).toLowerCase();
    const password = String(req.body.password || '');
    const accountType = normalize(req.body.accountType).toLowerCase();

    if (!matricule || !identifier || !password || !['personnel', 'direction'].includes(accountType)) {
      return res.status(400).json({ ok: false, message: 'Tous les champs sont obligatoires.' });
    }

    const { one, all, run } = getDatabaseHelpers();
    const user = one(
      `SELECT id, discord_username, avatar_url, matricule, identifier, password_hash,
              account_type, grade, department, status
       FROM users
       WHERE matricule = ? AND identifier = ?`,
      [matricule, identifier]
    );

    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;
    const validAccountType = user && user.account_type === accountType;
    const active = user && user.status === 'active';

    if (!user || !validPassword || !validAccountType || !active) {
      run(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [user?.id || null, 'LOGIN_FAILED', `Matricule=${matricule}; Type=${accountType}`, req.ip]
      );
      return res.status(401).json({ ok: false, message: 'Matricule, identifiant ou mot de passe incorrect.' });
    }

    req.session.regenerate((error) => {
      if (error) {
        return res.status(500).json({ ok: false, message: 'Impossible de créer la session sécurisée.' });
      }

      req.session.user = {
        id: user.id,
        username: user.discord_username,
        avatarUrl: user.avatar_url,
        matricule: user.matricule,
        accountType: user.account_type,
        grade: user.grade,
        department: user.department,
        permissions: getEffectivePermissions(user.id, user.department, one, all)
      };

      run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      run(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [user.id, 'LOGIN_SUCCESS', `Connexion ${accountType}`, req.ip]
      );

      return res.json({ ok: true, redirect: '/dashboard' });
    });
  });

  app.get('/api/auth/session', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, user: req.session.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const userId = req.session.user?.id || null;
    const { run } = getDatabaseHelpers();

    if (userId) {
      run(
        'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
        [userId, 'LOGOUT', 'Déconnexion volontaire', req.ip]
      );
    }

    req.session.destroy(() => {
      res.clearCookie('anx.sid');
      res.json({ ok: true, redirect: '/' });
    });
  });
}

function requireAuthentication(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

module.exports = { registerAuthRoutes, requireAuthentication };
