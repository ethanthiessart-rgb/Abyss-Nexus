'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerCareerRoutes(app) {
  app.get('/api/career', requirePermission('personnel.view'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const events = all(`
      SELECT c.id, c.employee_user_id, c.event_type, c.title,
             c.description, c.event_date,
             employee.discord_username AS employee_name,
             employee.matricule AS employee_matricule,
             actor.discord_username AS actor_name
      FROM career_events c
      JOIN users employee ON employee.id = c.employee_user_id
      LEFT JOIN users actor ON actor.id = c.created_by_user_id
      ORDER BY c.event_date DESC, c.id DESC
      LIMIT 300
    `);

    res.json({
      ok: true,
      events: events.map((item) => ({
        id: item.id,
        employeeUserId: item.employee_user_id,
        employeeName: item.employee_name,
        employeeMatricule: item.employee_matricule,
        actorName: item.actor_name || 'Système',
        eventType: item.event_type,
        title: item.title,
        description: item.description,
        eventDate: item.event_date
      }))
    });
  });

  app.post('/api/career', requirePermission('personnel.edit'), (req, res) => {
    const employeeUserId = Number(req.body.employeeUserId);
    const eventType = clean(req.body.eventType);
    const title = clean(req.body.title);
    const description = clean(req.body.description);
    const eventDate = clean(req.body.eventDate) || new Date().toISOString();

    const allowedTypes = new Set([
      'promotion',
      'grade_change',
      'department_change',
      'reward',
      'distinction',
      'recruitment',
      'other'
    ]);

    if (
      !Number.isInteger(employeeUserId) ||
      !allowedTypes.has(eventType) ||
      title.length < 3
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Données de carrière invalides.'
      });
    }

    const { one, run } = getDatabaseHelpers();

    if (!one('SELECT id FROM users WHERE id = ?', [employeeUserId])) {
      return res.status(404).json({
        ok: false,
        message: 'Employé introuvable.'
      });
    }

    run(`
      INSERT INTO career_events (
        employee_user_id, event_type, title, description,
        event_date, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      employeeUserId,
      eventType,
      title,
      description || null,
      eventDate,
      req.session.user.id
    ]);

    run(`
      INSERT INTO notifications (
        user_id, type, title, message, link
      ) VALUES (?, 'career', 'Évolution de carrière', ?, '/employees')
    `, [employeeUserId, title]);

    res.status(201).json({
      ok: true,
      message: 'Évènement de carrière enregistré.'
    });
  });
}

module.exports = { registerCareerRoutes };
