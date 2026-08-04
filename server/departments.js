'use strict';

const { getDatabaseHelpers } = require('./database');
const {
  PERMISSIONS,
  requirePermission
} = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerDepartmentRoutes(app) {
  app.get('/api/departments/meta', requirePermission('permissions.manage'), (_req, res) => {
    res.json({
      ok: true,
      permissions: PERMISSIONS
    });
  });

  app.get('/api/departments', requirePermission('permissions.manage'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const departments = all(`
      SELECT id, name, color, icon, description, active, created_at
      FROM departments
      ORDER BY name
    `);

    res.json({
      ok: true,
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        color: department.color,
        icon: department.icon,
        description: department.description,
        active: Boolean(department.active),
        createdAt: department.created_at
      }))
    });
  });

  app.get(
    '/api/departments/:id',
    requirePermission('permissions.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, all } = getDatabaseHelpers();

      const department = one(`
        SELECT id, name, color, icon, description, active, created_at
        FROM departments
        WHERE id = ?
      `, [id]);

      if (!department) {
        return res.status(404).json({
          ok: false,
          message: 'Département introuvable.'
        });
      }

      const permissions = all(`
        SELECT permission_key
        FROM department_permissions
        WHERE department_id = ?
        ORDER BY permission_key
      `).map((item) => item.permission_key);

      const members = all(`
        SELECT id, discord_username, matricule, grade, status
        FROM users
        WHERE department = ?
        ORDER BY discord_username COLLATE NOCASE
      `, [department.name]);

      res.json({
        ok: true,
        department: {
          id: department.id,
          name: department.name,
          color: department.color,
          icon: department.icon,
          description: department.description,
          active: Boolean(department.active),
          createdAt: department.created_at
        },
        permissions,
        members: members.map((member) => ({
          id: member.id,
          username: member.discord_username,
          matricule: member.matricule,
          grade: member.grade,
          status: member.status
        }))
      });
    }
  );

  app.post(
    '/api/departments',
    requirePermission('permissions.manage'),
    (req, res) => {
      const name = clean(req.body.name);
      const color = clean(req.body.color) || '#3aa9ff';
      const icon = clean(req.body.icon) || '🏢';
      const description = clean(req.body.description);
      const active = req.body.active !== false;

      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({
          ok: false,
          message: 'Le nom doit contenir entre 2 et 80 caractères.'
        });
      }

      const { one, run } = getDatabaseHelpers();

      if (one('SELECT id FROM departments WHERE name = ?', [name])) {
        return res.status(409).json({
          ok: false,
          message: 'Ce département existe déjà.'
        });
      }

      run(`
        INSERT INTO departments (
          name, color, icon, description, active, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        name,
        color,
        icon,
        description || null,
        active ? 1 : 0,
        req.session.user.id
      ]);

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'DEPARTMENT_CREATE', ?, ?)
      `, [req.session.user.id, `Département=${name}`, req.ip]);

      res.status(201).json({
        ok: true,
        message: 'Département créé.'
      });
    }
  );

  app.put(
    '/api/departments/:id',
    requirePermission('permissions.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const name = clean(req.body.name);
      const color = clean(req.body.color) || '#3aa9ff';
      const icon = clean(req.body.icon) || '🏢';
      const description = clean(req.body.description);
      const active = Boolean(req.body.active);
      const permissions = Array.isArray(req.body.permissions)
        ? req.body.permissions.map(String)
        : [];

      const allowedPermissions = new Set(
        PERMISSIONS.map((permission) => permission.key)
      );

      const { one, run } = getDatabaseHelpers();

      const current = one(
        'SELECT id, name FROM departments WHERE id = ?',
        [id]
      );

      if (!current) {
        return res.status(404).json({
          ok: false,
          message: 'Département introuvable.'
        });
      }

      if (
        one(
          'SELECT id FROM departments WHERE name = ? AND id != ?',
          [name, id]
        )
      ) {
        return res.status(409).json({
          ok: false,
          message: 'Un autre département porte déjà ce nom.'
        });
      }

      run(`
        UPDATE departments
        SET name = ?, color = ?, icon = ?, description = ?,
            active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        name,
        color,
        icon,
        description || null,
        active ? 1 : 0,
        id
      ]);

      if (current.name !== name) {
        run(
          'UPDATE users SET department = ? WHERE department = ?',
          [name, current.name]
        );
      }

      run(
        'DELETE FROM department_permissions WHERE department_id = ?',
        [id]
      );

      for (const permission of permissions) {
        if (!allowedPermissions.has(permission)) continue;

        run(`
          INSERT INTO department_permissions (
            department_id, permission_key
          ) VALUES (?, ?)
        `, [id, permission]);
      }

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'DEPARTMENT_UPDATE', ?, ?)
      `, [
        req.session.user.id,
        `Département=${name}; Permissions=${permissions.length}`,
        req.ip
      ]);

      res.json({
        ok: true,
        message: 'Département mis à jour.'
      });
    }
  );

  app.delete(
    '/api/departments/:id',
    requirePermission('permissions.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, run } = getDatabaseHelpers();

      const department = one(
        'SELECT id, name FROM departments WHERE id = ?',
        [id]
      );

      if (!department) {
        return res.status(404).json({
          ok: false,
          message: 'Département introuvable.'
        });
      }

      const members = Number(
        one(
          'SELECT COUNT(*) AS count FROM users WHERE department = ?',
          [department.name]
        )?.count || 0
      );

      if (members > 0) {
        return res.status(409).json({
          ok: false,
          message:
            'Impossible de supprimer ce département tant que des employés y sont affectés.'
        });
      }

      run('DELETE FROM department_permissions WHERE department_id = ?', [id]);
      run('DELETE FROM departments WHERE id = ?', [id]);

      res.json({
        ok: true,
        message: 'Département supprimé.'
      });
    }
  );
}

module.exports = { registerDepartmentRoutes };
