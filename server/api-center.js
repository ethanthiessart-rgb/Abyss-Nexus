'use strict';

const crypto = require('node:crypto');

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

const rateBuckets = new Map();

function clean(value) {
  return String(value ?? '').trim();
}

function hashKey(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function generateKey() {
  return `anx_live_${crypto.randomBytes(30).toString('base64url')}`;
}

function parseScopes(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function apiKeyRequired(requiredScope) {
  return (req, res, next) => {
    const rawKey = clean(req.get('x-api-key'));

    if (!rawKey) {
      return res.status(401).json({
        ok: false,
        error: 'API_KEY_REQUIRED',
        message: 'En-tête x-api-key obligatoire.'
      });
    }

    const { one, run } = getDatabaseHelpers();
    const key = one(`
      SELECT id, name, key_prefix, scopes, rate_limit_per_minute,
             active, expires_at
      FROM api_keys
      WHERE key_hash = ?
      LIMIT 1
    `, [hashKey(rawKey)]);

    if (!key || !key.active) {
      return res.status(401).json({
        ok: false,
        error: 'API_KEY_INVALID',
        message: 'Clé API invalide ou désactivée.'
      });
    }

    if (key.expires_at && new Date(key.expires_at) <= new Date()) {
      return res.status(401).json({
        ok: false,
        error: 'API_KEY_EXPIRED',
        message: 'Cette clé API a expiré.'
      });
    }

    const scopes = parseScopes(key.scopes);

    if (
      requiredScope &&
      !scopes.includes('*') &&
      !scopes.includes(requiredScope)
    ) {
      return res.status(403).json({
        ok: false,
        error: 'SCOPE_REQUIRED',
        message: `Portée requise : ${requiredScope}`
      });
    }

    const minute = Math.floor(Date.now() / 60000);
    const bucketKey = `${key.id}:${minute}`;
    const current = Number(rateBuckets.get(bucketKey) || 0);
    const limit = Math.max(1, Number(key.rate_limit_per_minute || 60));

    if (current >= limit) {
      return res.status(429).json({
        ok: false,
        error: 'RATE_LIMITED',
        message: 'Limite de requêtes atteinte. Réessayez dans une minute.'
      });
    }

    rateBuckets.set(bucketKey, current + 1);

    req.apiKey = {
      id: key.id,
      name: key.name,
      scopes
    };

    run(`
      UPDATE api_keys
      SET last_used_at = CURRENT_TIMESTAMP,
          request_count = request_count + 1
      WHERE id = ?
    `, [key.id]);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - current - 1)));

    next();
  };
}

function registerApiCenterRoutes(app) {
  app.get(
    '/api/api-center/keys',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const keys = all(`
        SELECT id, name, key_prefix, scopes, active,
               rate_limit_per_minute, expires_at,
               last_used_at, request_count, created_at
        FROM api_keys
        ORDER BY created_at DESC
      `);

      res.json({
        ok: true,
        availableScopes: [
          { key: 'status.read', label: 'Lire l’état du portail' },
          { key: 'employees.read', label: 'Lire les employés' },
          { key: 'departments.read', label: 'Lire les départements' },
          { key: 'planning.read', label: 'Lire le planning' },
          { key: 'reports.read', label: 'Lire les rapports avancés' },
          { key: '*', label: 'Toutes les portées' }
        ],
        keys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.key_prefix,
          scopes: parseScopes(key.scopes),
          active: Boolean(key.active),
          rateLimitPerMinute: Number(key.rate_limit_per_minute || 60),
          expiresAt: key.expires_at,
          lastUsedAt: key.last_used_at,
          requestCount: Number(key.request_count || 0),
          createdAt: key.created_at
        }))
      });
    }
  );

  app.post(
    '/api/api-center/keys',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const name = clean(req.body.name);
      const scopes = Array.isArray(req.body.scopes)
        ? [...new Set(req.body.scopes.map(String).filter(Boolean))]
        : [];
      const rateLimit = Number(req.body.rateLimitPerMinute || 60);
      const expiresAt = clean(req.body.expiresAt) || null;

      if (name.length < 3 || name.length > 80) {
        return res.status(400).json({
          ok: false,
          message: 'Le nom doit contenir entre 3 et 80 caractères.'
        });
      }

      if (!scopes.length) {
        return res.status(400).json({
          ok: false,
          message: 'Sélectionnez au moins une portée.'
        });
      }

      if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 1000) {
        return res.status(400).json({
          ok: false,
          message: 'La limite doit être comprise entre 1 et 1000 requêtes/minute.'
        });
      }

      const rawKey = generateKey();
      const { run } = getDatabaseHelpers();

      run(`
        INSERT INTO api_keys (
          name, key_hash, key_prefix, scopes,
          rate_limit_per_minute, expires_at,
          created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        name,
        hashKey(rawKey),
        rawKey.slice(0, 16),
        JSON.stringify(scopes),
        rateLimit,
        expiresAt,
        req.session.user.id
      ]);

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'API_KEY_CREATE', ?, ?)
      `, [
        req.session.user.id,
        `Nom=${name}; Portées=${scopes.join(',')}`,
        req.ip
      ]);

      res.status(201).json({
        ok: true,
        message: 'Clé API créée. Copiez-la maintenant : elle ne sera plus affichée.',
        apiKey: rawKey
      });
    }
  );

  app.patch(
    '/api/api-center/keys/:id/toggle',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const active = Boolean(req.body.active);
      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM api_keys WHERE id = ?', [id])) {
        return res.status(404).json({
          ok: false,
          message: 'Clé API introuvable.'
        });
      }

      run('UPDATE api_keys SET active = ? WHERE id = ?', [
        active ? 1 : 0,
        id
      ]);

      res.json({
        ok: true,
        message: active ? 'Clé API activée.' : 'Clé API désactivée.'
      });
    }
  );

  app.delete(
    '/api/api-center/keys/:id',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM api_keys WHERE id = ?', [id])) {
        return res.status(404).json({
          ok: false,
          message: 'Clé API introuvable.'
        });
      }

      run('DELETE FROM api_keys WHERE id = ?', [id]);

      res.json({
        ok: true,
        message: 'Clé API supprimée.'
      });
    }
  );

  // API REST publique v1
  app.get('/api/v1/status', apiKeyRequired('status.read'), (_req, res) => {
    const { getMaintenanceState } = require('./maintenance');
    const state = getMaintenanceState();

    res.json({
      ok: true,
      data: {
        mode: state.mode,
        label: state.label,
        message: state.message,
        returnUnknown: state.returnUnknown,
        returnAt: state.returnAt,
        timestamp: new Date().toISOString()
      }
    });
  });

  app.get('/api/v1/employees', apiKeyRequired('employees.read'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT id, discord_username, matricule, grade,
             department, status, created_at, last_login_at
      FROM users
      WHERE status != 'archived'
      ORDER BY discord_username COLLATE NOCASE
    `);

    res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        username: row.discord_username,
        matricule: row.matricule,
        grade: row.grade,
        department: row.department,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at
      }))
    });
  });

  app.get('/api/v1/departments', apiKeyRequired('departments.read'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT id, name, color, icon, description, active
      FROM departments
      ORDER BY name COLLATE NOCASE
    `);

    res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        description: row.description,
        active: Boolean(row.active)
      }))
    });
  });

  app.get('/api/v1/planning', apiKeyRequired('planning.read'), (req, res) => {
    const from = clean(req.query.from);
    const to = clean(req.query.to);
    const params = [];
    const clauses = [];

    if (from) {
      clauses.push('start_at >= ?');
      params.push(from);
    }

    if (to) {
      clauses.push('start_at <= ?');
      params.push(to);
    }

    const { all } = getDatabaseHelpers();
    const rows = all(`
      SELECT id, title, start_at, end_at,
             location, color, notes
      FROM planning_shifts
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY start_at
      LIMIT 500
    `, params);

    res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        startAt: row.start_at,
        endAt: row.end_at,
        location: row.location,
        color: row.color,
        notes: row.notes
      }))
    });
  });

  app.get('/api/v1/reports', apiKeyRequired('reports.read'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT ar.id, ar.report_number, ar.title, ar.priority,
             ar.status, ar.target_departments, ar.created_at,
             author.discord_username AS author_name
      FROM advanced_reports ar
      JOIN users author ON author.id = ar.author_user_id
      ORDER BY ar.updated_at DESC
      LIMIT 500
    `);

    res.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        reportNumber: row.report_number,
        title: row.title,
        priority: row.priority,
        status: row.status,
        departments: row.target_departments
          ? JSON.parse(row.target_departments)
          : [],
        authorName: row.author_name,
        createdAt: row.created_at
      }))
    });
  });
}

module.exports = {
  registerApiCenterRoutes,
  apiKeyRequired
};
