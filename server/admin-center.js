'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission, PERMISSIONS } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    : [];
}

function registerAdminCenterRoutes(app) {
  app.get(
    '/api/admin-center/meta',
    requirePermission('permissions.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const departments = all(`
        SELECT id, name, color, icon, description, active
        FROM departments
        ORDER BY name COLLATE NOCASE
      `);

      const grades = all(`
        SELECT g.id, g.name, g.level, g.color, g.description,
               g.department_id, d.name AS department_name,
               g.active, g.created_at
        FROM staff_grades g
        LEFT JOIN departments d ON d.id = g.department_id
        ORDER BY g.level DESC, g.name COLLATE NOCASE
      `);

      const gradePermissions = all(`
        SELECT grade_id, permission_key
        FROM staff_grade_permissions
        ORDER BY grade_id, permission_key
      `);

      res.json({
        ok: true,
        permissions: PERMISSIONS,
        departments: departments.map((item) => ({
          id: item.id,
          name: item.name,
          color: item.color,
          icon: item.icon,
          description: item.description,
          active: Boolean(item.active)
        })),
        grades: grades.map((grade) => ({
          id: grade.id,
          name: grade.name,
          level: Number(grade.level || 0),
          color: grade.color,
          description: grade.description,
          departmentId: grade.department_id,
          departmentName: grade.department_name,
          active: Boolean(grade.active),
          permissions: gradePermissions
            .filter((item) => item.grade_id === grade.id)
            .map((item) => item.permission_key)
        }))
      });
    }
  );

  app.post(
    '/api/admin-center/grades',
    requirePermission('permissions.manage'),
    (req, res) => {
      const name = clean(req.body.name);
      const level = Number(req.body.level || 0);
      const color = clean(req.body.color) || '#3aa9ff';
      const description = clean(req.body.description);
      const departmentId = req.body.departmentId
        ? Number(req.body.departmentId)
        : null;
      const active = req.body.active !== false;
      const permissions = normalizeList(req.body.permissions);

      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({
          ok: false,
          message: 'Le nom du grade doit contenir entre 2 et 80 caractères.'
        });
      }

      if (!Number.isInteger(level) || level < 0 || level > 999) {
        return res.status(400).json({
          ok: false,
          message: 'Le niveau hiérarchique doit être compris entre 0 et 999.'
        });
      }

      const validPermissions = new Set(PERMISSIONS.map((item) => item.key));
      const { one, run } = getDatabaseHelpers();

      if (one('SELECT id FROM staff_grades WHERE name = ?', [name])) {
        return res.status(409).json({
          ok: false,
          message: 'Ce grade existe déjà.'
        });
      }

      run(`
        INSERT INTO staff_grades (
          name, level, color, description, department_id,
          active, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        name,
        level,
        color,
        description || null,
        departmentId,
        active ? 1 : 0,
        req.session.user.id
      ]);

      const gradeId = Number(
        one('SELECT MAX(id) AS id FROM staff_grades')?.id
      );

      for (const permission of permissions) {
        if (!validPermissions.has(permission)) continue;

        run(`
          INSERT OR IGNORE INTO staff_grade_permissions (
            grade_id, permission_key
          ) VALUES (?, ?)
        `, [gradeId, permission]);
      }

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'GRADE_CREATE', ?, ?)
      `, [
        req.session.user.id,
        `Grade=${name}; Niveau=${level}`,
        req.ip
      ]);

      res.status(201).json({
        ok: true,
        message: 'Grade créé.',
        gradeId
      });
    }
  );

  app.put(
    '/api/admin-center/grades/:id',
    requirePermission('permissions.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const name = clean(req.body.name);
      const level = Number(req.body.level || 0);
      const color = clean(req.body.color) || '#3aa9ff';
      const description = clean(req.body.description);
      const departmentId = req.body.departmentId
        ? Number(req.body.departmentId)
        : null;
      const active = Boolean(req.body.active);
      const permissions = normalizeList(req.body.permissions);

      const validPermissions = new Set(PERMISSIONS.map((item) => item.key));
      const { one, run } = getDatabaseHelpers();

      const grade = one('SELECT id FROM staff_grades WHERE id = ?', [id]);

      if (!grade) {
        return res.status(404).json({
          ok: false,
          message: 'Grade introuvable.'
        });
      }

      run(`
        UPDATE staff_grades
        SET name = ?, level = ?, color = ?, description = ?,
            department_id = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        name,
        level,
        color,
        description || null,
        departmentId,
        active ? 1 : 0,
        id
      ]);

      run('DELETE FROM staff_grade_permissions WHERE grade_id = ?', [id]);

      for (const permission of permissions) {
        if (!validPermissions.has(permission)) continue;

        run(`
          INSERT OR IGNORE INTO staff_grade_permissions (
            grade_id, permission_key
          ) VALUES (?, ?)
        `, [id, permission]);
      }

      res.json({
        ok: true,
        message: 'Grade mis à jour.'
      });
    }
  );

  app.delete(
    '/api/admin-center/grades/:id',
    requirePermission('permissions.manage'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, run } = getDatabaseHelpers();

      const grade = one('SELECT id, name FROM staff_grades WHERE id = ?', [id]);

      if (!grade) {
        return res.status(404).json({
          ok: false,
          message: 'Grade introuvable.'
        });
      }

      const assigned = Number(
        one('SELECT COUNT(*) AS count FROM user_grade_assignments WHERE grade_id = ?', [id])?.count || 0
      );

      if (assigned > 0) {
        return res.status(409).json({
          ok: false,
          message: 'Ce grade est encore attribué à un ou plusieurs employés.'
        });
      }

      run('DELETE FROM staff_grade_permissions WHERE grade_id = ?', [id]);
      run('DELETE FROM staff_grades WHERE id = ?', [id]);

      res.json({
        ok: true,
        message: 'Grade supprimé.'
      });
    }
  );

  app.get(
    '/api/admin-center/users/:id/effective-rights',
    requirePermission('permissions.manage'),
    (req, res) => {
      const userId = Number(req.params.id);
      const { one, all } = getDatabaseHelpers();

      const user = one(`
        SELECT id, discord_username, matricule, grade, department
        FROM users
        WHERE id = ?
      `, [userId]);

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: 'Employé introuvable.'
        });
      }

      const direct = all(`
        SELECT permission_key, allowed
        FROM user_permissions
        WHERE user_id = ?
      `, [userId]);

      const departmentPermissions = all(`
        SELECT dp.permission_key
        FROM department_permissions dp
        JOIN departments d ON d.id = dp.department_id
        WHERE d.name = ?
      `, [user.department]).map((item) => item.permission_key);

      const grades = all(`
        SELECT g.id, g.name, g.level
        FROM user_grade_assignments uga
        JOIN staff_grades g ON g.id = uga.grade_id
        WHERE uga.user_id = ? AND g.active = 1
        ORDER BY g.level DESC
      `, [userId]);

      const gradePermissions = grades.length
        ? all(`
            SELECT DISTINCT sgp.permission_key
            FROM staff_grade_permissions sgp
            WHERE sgp.grade_id IN (${grades.map(() => '?').join(',')})
          `, grades.map((grade) => grade.id)).map((item) => item.permission_key)
        : [];

      const effective = new Set([
        ...departmentPermissions,
        ...gradePermissions
      ]);

      for (const permission of direct) {
        if (permission.allowed) effective.add(permission.permission_key);
        else effective.delete(permission.permission_key);
      }

      res.json({
        ok: true,
        user,
        grades,
        sources: {
          department: departmentPermissions,
          grades: gradePermissions,
          direct
        },
        effectivePermissions: [...effective].sort()
      });
    }
  );

  app.post(
    '/api/admin-center/users/:id/grades',
    requirePermission('permissions.manage'),
    (req, res) => {
      const userId = Number(req.params.id);
      const gradeIds = Array.isArray(req.body.gradeIds)
        ? [...new Set(req.body.gradeIds.map(Number).filter(Number.isInteger))]
        : [];

      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM users WHERE id = ?', [userId])) {
        return res.status(404).json({
          ok: false,
          message: 'Employé introuvable.'
        });
      }

      run('DELETE FROM user_grade_assignments WHERE user_id = ?', [userId]);

      for (const gradeId of gradeIds) {
        if (!one('SELECT id FROM staff_grades WHERE id = ?', [gradeId])) continue;

        run(`
          INSERT OR IGNORE INTO user_grade_assignments (
            user_id, grade_id, assigned_by_user_id
          ) VALUES (?, ?, ?)
        `, [userId, gradeId, req.session.user.id]);
      }

      res.json({
        ok: true,
        message: 'Grades attribués.'
      });
    }
  );
}

module.exports = { registerAdminCenterRoutes };
