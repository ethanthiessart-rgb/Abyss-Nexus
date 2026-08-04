'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function registerEmployeeHubRoutes(app) {
  app.get('/api/employees', requirePermission('personnel.view'), (_req, res) => {
    const { all } = getDatabaseHelpers();
    const rows = all(`
      SELECT u.id, u.discord_username, u.avatar_url, u.matricule,
             u.grade, u.department, u.status, u.created_at, u.last_login_at,
             sp.signature
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.status != 'archived'
      ORDER BY u.discord_username COLLATE NOCASE
    `);

    res.json({
      ok: true,
      employees: rows.map((row) => ({
        id: row.id,
        username: row.discord_username,
        avatarUrl: row.avatar_url,
        matricule: row.matricule,
        grade: row.grade,
        department: row.department,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        signature: row.signature || ''
      }))
    });
  });

  app.get('/api/employees/:id', requirePermission('personnel.view'), (req, res) => {
    const id = Number(req.params.id);
    const { one, all } = getDatabaseHelpers();

    const user = one(`
      SELECT u.id, u.discord_username, u.avatar_url, u.matricule,
             u.identifier, u.grade, u.department, u.status,
             u.created_at, u.last_login_at, sp.signature
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.id = ?
    `, [id]);

    if (!user) {
      return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
    }

    const reports = all(`
      SELECT id, report_number, title, status, created_at
      FROM reports
      WHERE author_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [id]);

    const sanctions = all(`
      SELECT id, sanction_number, sanction_type, status, created_at
      FROM sanctions
      WHERE target_user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [id]);

    const evaluations = all(`
      SELECT e.id, e.overall_score, e.comment, e.created_at,
             evaluator.discord_username AS evaluator_name
      FROM employee_evaluations e
      LEFT JOIN users evaluator ON evaluator.id = e.evaluator_user_id
      WHERE e.employee_user_id = ?
      ORDER BY e.created_at DESC
      LIMIT 50
    `, [id]);

    const training = all(`
      SELECT et.id, et.status, et.completed_at,
             t.title, t.category
      FROM employee_training et
      JOIN trainings t ON t.id = et.training_id
      WHERE et.employee_user_id = ?
      ORDER BY et.created_at DESC
      LIMIT 50
    `, [id]);

    const career = all(`
      SELECT id, event_type, title, description, event_date
      FROM career_events
      WHERE employee_user_id = ?
      ORDER BY event_date DESC, id DESC
      LIMIT 100
    `, [id]);

    const history = all(`
      SELECT ph.action, ph.details, ph.created_at,
             actor.discord_username AS actor_name
      FROM personnel_history ph
      LEFT JOIN users actor ON actor.id = ph.actor_user_id
      WHERE ph.target_user_id = ?
      ORDER BY ph.created_at DESC
      LIMIT 100
    `, [id]);

    res.json({
      ok: true,
      employee: {
        id: user.id,
        username: user.discord_username,
        avatarUrl: user.avatar_url,
        matricule: user.matricule,
        identifier: user.identifier,
        grade: user.grade,
        department: user.department,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        signature: user.signature || ''
      },
      reports,
      sanctions,
      evaluations,
      training,
      career,
      history
    });
  });
}

module.exports = { registerEmployeeHubRoutes };
