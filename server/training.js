'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerTrainingRoutes(app) {
  app.get('/api/training', requirePermission('personnel.view'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const trainings = all(`
      SELECT id, title, category, description, active, created_at
      FROM trainings
      ORDER BY active DESC, title COLLATE NOCASE
    `);

    const assignments = all(`
      SELECT et.id, et.employee_user_id, et.training_id, et.status,
             et.completed_at, et.comment,
             employee.discord_username AS employee_name,
             employee.matricule AS employee_matricule,
             t.title AS training_title
      FROM employee_training et
      JOIN users employee ON employee.id = et.employee_user_id
      JOIN trainings t ON t.id = et.training_id
      ORDER BY et.created_at DESC
      LIMIT 300
    `);

    res.json({
      ok: true,
      trainings: trainings.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        description: item.description,
        active: Boolean(item.active),
        createdAt: item.created_at
      })),
      assignments: assignments.map((item) => ({
        id: item.id,
        employeeUserId: item.employee_user_id,
        employeeName: item.employee_name,
        employeeMatricule: item.employee_matricule,
        trainingId: item.training_id,
        trainingTitle: item.training_title,
        status: item.status,
        completedAt: item.completed_at,
        comment: item.comment
      }))
    });
  });

  app.post('/api/training', requirePermission('personnel.edit'), (req, res) => {
    const title = clean(req.body.title);
    const category = clean(req.body.category) || 'Générale';
    const description = clean(req.body.description);

    if (title.length < 3) {
      return res.status(400).json({
        ok: false,
        message: 'Le titre de la formation est trop court.'
      });
    }

    const { run } = getDatabaseHelpers();

    run(`
      INSERT INTO trainings (
        title, category, description, created_by_user_id
      ) VALUES (?, ?, ?, ?)
    `, [
      title,
      category,
      description || null,
      req.session.user.id
    ]);

    res.status(201).json({
      ok: true,
      message: 'Formation créée.'
    });
  });

  app.post('/api/training/assign', requirePermission('personnel.edit'), (req, res) => {
    const employeeUserId = Number(req.body.employeeUserId);
    const trainingId = Number(req.body.trainingId);

    const { one, run } = getDatabaseHelpers();

    if (
      !one('SELECT id FROM users WHERE id = ?', [employeeUserId]) ||
      !one('SELECT id FROM trainings WHERE id = ?', [trainingId])
    ) {
      return res.status(404).json({
        ok: false,
        message: 'Employé ou formation introuvable.'
      });
    }

    run(`
      INSERT INTO employee_training (
        employee_user_id, training_id, assigned_by_user_id, status
      ) VALUES (?, ?, ?, 'assigned')
    `, [employeeUserId, trainingId, req.session.user.id]);

    run(`
      INSERT INTO notifications (
        user_id, type, title, message, link
      ) VALUES (?, 'training', 'Nouvelle formation', ?, '/training')
    `, [
      employeeUserId,
      'Une nouvelle formation vous a été attribuée.'
    ]);

    res.status(201).json({
      ok: true,
      message: 'Formation attribuée.'
    });
  });

  app.patch(
    '/api/training/assignments/:id',
    requirePermission('personnel.edit'),
    (req, res) => {
      const id = Number(req.params.id);
      const status = clean(req.body.status);
      const comment = clean(req.body.comment);

      if (!['assigned', 'in_progress', 'completed', 'failed'].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: 'Statut de formation invalide.'
        });
      }

      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM employee_training WHERE id = ?', [id])) {
        return res.status(404).json({
          ok: false,
          message: 'Attribution introuvable.'
        });
      }

      run(`
        UPDATE employee_training
        SET status = ?, comment = ?,
            completed_at = CASE
              WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP
              ELSE NULL
            END
        WHERE id = ?
      `, [status, comment || null, status, id]);

      res.json({
        ok: true,
        message: 'Statut de formation mis à jour.'
      });
    }
  );
}

module.exports = { registerTrainingRoutes };
