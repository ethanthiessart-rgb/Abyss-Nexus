'use strict';

const bcrypt = require('bcryptjs');
const { getDatabaseHelpers } = require('./database');
const {
  DEPARTMENTS,
  PERMISSIONS,
  getEffectivePermissions,
  requirePermission
} = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function nextMatricule(one) {
  // Les matricules sont permanents : on ne recycle jamais un ancien numéro.
  // On prend le plus grand ABY-000001... existant, même si le compte est archivé,
  // puis on ajoute 1. Les matricules ABY-DIR-... sont ignorés.
  const row = one(`
    SELECT MAX(
      CASE
        WHEN matricule GLOB 'ABY-[0-9][0-9][0-9][0-9][0-9][0-9]'
        THEN CAST(SUBSTR(matricule, 5) AS INTEGER)
        ELSE 0
      END
    ) AS max_number
    FROM users
  `);

  const nextNumber = Number(row?.max_number || 0) + 1;
  return `ABY-${String(nextNumber).padStart(6, '0')}`;
}

function publicUser(user) {
  return {
    id: user.id,
    discordId: user.discord_id,
    username: user.discord_username,
    avatarUrl: user.avatar_url,
    matricule: user.matricule,
    identifier: user.identifier,
    accountType: user.account_type,
    grade: user.grade,
    department: user.department,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    signature: user.signature || '',
    forcePasswordChange: Boolean(user.force_password_change)
  };
}

function registerPersonnelRoutes(app) {
  app.get('/api/personnel/meta', requirePermission('personnel.view'), (req, res) => {
    res.json({
      ok: true,
      departments: DEPARTMENTS,
      permissions: PERMISSIONS,
      currentPermissions: req.session.user.permissions
    });
  });

  app.get('/api/personnel', requirePermission('personnel.view'), (_req, res) => {
    const { all } = getDatabaseHelpers();
    const rows = all(`
      SELECT u.*, sp.signature, sp.force_password_change
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.status != 'archived'
      ORDER BY
        CASE WHEN u.account_type = 'direction' THEN 0 ELSE 1 END,
        u.discord_username COLLATE NOCASE
    `);

    res.json({ ok: true, users: rows.map(publicUser) });
  });

  app.get('/api/personnel/:id', requirePermission('personnel.view'), (req, res) => {
    const userId = Number(req.params.id);
    const { one, all } = getDatabaseHelpers();

    const user = one(`
      SELECT u.*, sp.signature, sp.force_password_change,
             sp.first_login_notification
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.id = ?
    `, [userId]);

    if (!user) {
      return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
    }

    const overrides = all(
      `SELECT permission_key, effect
       FROM user_permission_overrides
       WHERE user_id = ?`,
      [userId]
    );

    const history = all(`
      SELECT ph.id, ph.action, ph.details, ph.created_at,
             actor.discord_username AS actor_name
      FROM personnel_history ph
      LEFT JOIN users actor ON actor.id = ph.actor_user_id
      WHERE ph.target_user_id = ?
      ORDER BY ph.created_at DESC
      LIMIT 50
    `, [userId]);

    res.json({
      ok: true,
      user: publicUser(user),
      firstLoginNotification: Boolean(user.first_login_notification),
      overrides,
      effectivePermissions: getEffectivePermissions(
        user.id,
        user.department,
        one,
        all
      ),
      history: history.map((item) => ({
        id: item.id,
        action: item.action,
        details: item.details,
        createdAt: item.created_at,
        actorName: item.actor_name
      }))
    });
  });

  app.post('/api/personnel', requirePermission('personnel.create'), async (req, res) => {
    const discordId = clean(req.body.discordId) || null;
    const username = clean(req.body.username);
    const avatarUrl = clean(req.body.avatarUrl) || null;
    const identifier = clean(req.body.identifier).toLowerCase();
    const password = String(req.body.password || '');
    const grade = clean(req.body.grade);
    const department = clean(req.body.department);
    const signature = clean(req.body.signature) || null;
    const forcePasswordChange = Boolean(req.body.forcePasswordChange);
    const firstLoginNotification = req.body.firstLoginNotification !== false;

    if (!username || !identifier || !grade || !department || password.length < 8) {
      return res.status(400).json({
        ok: false,
        message: 'Tous les champs sont obligatoires et le mot de passe doit contenir 8 caractères minimum.'
      });
    }

    if (!DEPARTMENTS.includes(department)) {
      return res.status(400).json({ ok: false, message: 'Département invalide.' });
    }

    const { one, run } = getDatabaseHelpers();

    if (one('SELECT id FROM users WHERE identifier = ?', [identifier])) {
      return res.status(409).json({ ok: false, message: 'Identifiant déjà utilisé.' });
    }

    const matricule = nextMatricule(one);
    const passwordHash = await bcrypt.hash(password, 12);
    const accountType =
      department === 'Équipe de Direction' ? 'direction' : 'personnel';

    run(
      `INSERT INTO users (
        discord_id, discord_username, avatar_url, matricule, identifier,
        password_hash, account_type, grade, department, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        discordId,
        username,
        avatarUrl,
        matricule,
        identifier,
        passwordHash,
        accountType,
        grade,
        department
      ]
    );

    const created = one('SELECT id FROM users WHERE matricule = ?', [matricule]);

    run(
      `INSERT INTO staff_profiles (
        user_id, signature, force_password_change,
        first_login_notification, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        created.id,
        signature,
        forcePasswordChange ? 1 : 0,
        firstLoginNotification ? 1 : 0,
        req.session.user.id
      ]
    );

    run(
      `INSERT INTO personnel_history (
        target_user_id, actor_user_id, action, details
      ) VALUES (?, ?, 'ACCOUNT_CREATED', ?)`,
      [created.id, req.session.user.id, `Matricule=${matricule}`]
    );

    res.status(201).json({
      ok: true,
      message: 'Compte créé.',
      matricule
    });
  });

  app.patch('/api/personnel/:id', requirePermission('personnel.edit'), (req, res) => {
    const userId = Number(req.params.id);
    const grade = clean(req.body.grade);
    const department = clean(req.body.department);
    const status = clean(req.body.status);
    const signature = clean(req.body.signature) || null;
    const forcePasswordChange = Boolean(req.body.forcePasswordChange);

    if (!grade || !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ ok: false, message: 'Données invalides.' });
    }

    const { one, run } = getDatabaseHelpers();
    if (!one('SELECT id FROM users WHERE id = ?', [userId])) {
      return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
    }

    const accountType =
      department === 'Équipe de Direction' ? 'direction' : 'personnel';

    run(
      `UPDATE users
       SET grade = ?, department = ?, status = ?, account_type = ?
       WHERE id = ?`,
      [grade, department, status, accountType, userId]
    );

    run(
      `INSERT INTO staff_profiles (
        user_id, signature, force_password_change, created_by_user_id
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        signature = excluded.signature,
        force_password_change = excluded.force_password_change,
        updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        signature,
        forcePasswordChange ? 1 : 0,
        req.session.user.id
      ]
    );

    run(
      `INSERT INTO personnel_history (
        target_user_id, actor_user_id, action, details
      ) VALUES (?, ?, 'ACCOUNT_UPDATED', ?)`,
      [
        userId,
        req.session.user.id,
        `Grade=${grade}; Département=${department}; Statut=${status}`
      ]
    );

    res.json({ ok: true, message: 'Employé mis à jour.' });
  });

  app.post(
    '/api/personnel/:id/reset-password',
    requirePermission('personnel.reset_password'),
    async (req, res) => {
      const userId = Number(req.params.id);
      const password = String(req.body.password || '');

      if (password.length < 8) {
        return res.status(400).json({
          ok: false,
          message: 'Le mot de passe doit contenir 8 caractères minimum.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      if (!one('SELECT id FROM users WHERE id = ?', [userId])) {
        return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
      }

      run(
        `UPDATE users SET password_hash = ? WHERE id = ?`,
        [await bcrypt.hash(password, 12), userId]
      );

      run(
        `INSERT INTO personnel_history (
          target_user_id, actor_user_id, action, details
        ) VALUES (?, ?, 'PASSWORD_RESET', 'Mot de passe réinitialisé')`,
        [userId, req.session.user.id]
      );

      res.json({ ok: true, message: 'Mot de passe réinitialisé.' });
    }
  );


  app.delete(
    '/api/personnel/:id',
    requirePermission('personnel.edit'),
    async (req, res) => {
      const userId = Number(req.params.id);
      const actorId = Number(req.session.user.id);
      const { one, run, persistDatabaseNow } = getDatabaseHelpers();

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'Identifiant employé invalide.'
        });
      }

      if (userId === actorId) {
        return res.status(400).json({
          ok: false,
          message: 'Vous ne pouvez pas supprimer votre propre compte.'
        });
      }

      const target = one(
        `SELECT id, matricule, discord_username, account_type
         FROM users
         WHERE id = ?`,
        [userId]
      );

      if (!target) {
        return res.status(404).json({
          ok: false,
          message: 'Employé introuvable.'
        });
      }

      if (
        target.account_type === 'direction' &&
        target.matricule === 'ABY-DIR-0001'
      ) {
        return res.status(403).json({
          ok: false,
          message: 'Le compte Direction principal est protégé.'
        });
      }

      // On conserve les contenus publiés : la suppression est bloquée
      // si des annonces/documents appartiennent encore au compte.
      const announcement = one(
        'SELECT id FROM announcements WHERE author_id = ? LIMIT 1',
        [userId]
      );
      const document = one(
        'SELECT id FROM documents WHERE uploader_id = ? LIMIT 1',
        [userId]
      );

      if (announcement || document) {
        return res.status(409).json({
          ok: false,
          message:
            'Ce compte possède encore des annonces ou documents. Réattribuez-les avant la suppression définitive.'
        });
      }

      // Détache les références historiques facultatives.
      run('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', [userId]);
      run(
        'UPDATE personnel_history SET actor_user_id = NULL WHERE actor_user_id = ?',
        [userId]
      );
      run(
        'UPDATE staff_profiles SET created_by_user_id = NULL WHERE created_by_user_id = ?',
        [userId]
      );
      run(
        'UPDATE maintenance_settings SET updated_by_user_id = NULL WHERE updated_by_user_id = ?',
        [userId]
      );
      run(
        'UPDATE global_settings SET updated_by_user_id = NULL WHERE updated_by_user_id = ?',
        [userId]
      );
      run(
        'UPDATE global_settings_history SET changed_by_user_id = NULL WHERE changed_by_user_id = ?',
        [userId]
      );

      // Les tables liées avec ON DELETE CASCADE sont nettoyées automatiquement.
      run('DELETE FROM users WHERE id = ?', [userId]);

      // Confirmation immédiate de la nouvelle base dans Neon.
      await persistDatabaseNow();

      res.json({
        ok: true,
        message:
          `Compte ${target.discord_username} (${target.matricule}) supprimé définitivement.`
      });
    }
  );

  app.put(
    '/api/personnel/:id/permissions',
    requirePermission('permissions.manage'),
    (req, res) => {
      const userId = Number(req.params.id);
      const overrides = Array.isArray(req.body.overrides)
        ? req.body.overrides
        : [];
      const allowed = new Set(PERMISSIONS.map((item) => item.key));
      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM users WHERE id = ?', [userId])) {
        return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
      }

      run('DELETE FROM user_permission_overrides WHERE user_id = ?', [userId]);

      for (const item of overrides) {
        if (!allowed.has(item.permissionKey)) continue;
        if (!['allow', 'deny'].includes(item.effect)) continue;
        run(
          `INSERT INTO user_permission_overrides
           (user_id, permission_key, effect) VALUES (?, ?, ?)`,
          [userId, item.permissionKey, item.effect]
        );
      }

      run(
        `INSERT INTO personnel_history (
          target_user_id, actor_user_id, action, details
        ) VALUES (?, ?, 'PERMISSIONS_UPDATED', ?)`,
        [userId, req.session.user.id, `${overrides.length} exception(s)`]
      );

      res.json({ ok: true, message: 'Permissions enregistrées.' });
    }
  );
}

module.exports = { registerPersonnelRoutes };
