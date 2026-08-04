'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerEvaluationRoutes(app) {
  app.get('/api/evaluations', requirePermission('personnel.view'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const evaluations = all(`
      SELECT e.id, e.employee_user_id, e.overall_score, e.comment,
             e.created_at, employee.discord_username AS employee_name,
             employee.matricule AS employee_matricule,
             evaluator.discord_username AS evaluator_name
      FROM employee_evaluations e
      JOIN users employee ON employee.id = e.employee_user_id
      LEFT JOIN users evaluator ON evaluator.id = e.evaluator_user_id
      ORDER BY e.created_at DESC
      LIMIT 250
    `);

    res.json({
      ok: true,
      evaluations: evaluations.map((item) => ({
        id: item.id,
        employeeUserId: item.employee_user_id,
        employeeName: item.employee_name,
        employeeMatricule: item.employee_matricule,
        evaluatorName: item.evaluator_name || 'Système',
        overallScore: Number(item.overall_score || 0),
        comment: item.comment,
        createdAt: item.created_at
      }))
    });
  });

  app.post('/api/evaluations', requirePermission('personnel.edit'), (req, res) => {
    const employeeUserId = Number(req.body.employeeUserId);
    const professionalism = Number(req.body.professionalism);
    const activity = Number(req.body.activity);
    const respect = Number(req.body.respect);
    const communication = Number(req.body.communication);
    const comment = clean(req.body.comment);

    const scores = [
      professionalism,
      activity,
      respect,
      communication
    ];

    if (
      !Number.isInteger(employeeUserId) ||
      scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Employé ou notes invalides.'
      });
    }

    const overallScore =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;

    const { one, run } = getDatabaseHelpers();

    if (!one('SELECT id FROM users WHERE id = ?', [employeeUserId])) {
      return res.status(404).json({ ok: false, message: 'Employé introuvable.' });
    }

    run(`
      INSERT INTO employee_evaluations (
        employee_user_id, evaluator_user_id,
        professionalism, activity, respect, communication,
        overall_score, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      employeeUserId,
      req.session.user.id,
      professionalism,
      activity,
      respect,
      communication,
      overallScore,
      comment || null
    ]);

    run(`
      INSERT INTO notifications (
        user_id, type, title, message, link
      ) VALUES (?, 'evaluation', 'Nouvelle évaluation', ?, '/employees')
    `, [
      employeeUserId,
      `Votre nouvelle évaluation a obtenu ${overallScore.toFixed(2)}/5.`
    ]);

    run(`
      INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, 'EVALUATION_CREATE', ?, ?)
    `, [
      req.session.user.id,
      `Employé=${employeeUserId}; Score=${overallScore.toFixed(2)}`,
      req.ip
    ]);

    res.status(201).json({
      ok: true,
      message: 'Évaluation enregistrée.'
    });
  });
}

module.exports = { registerEvaluationRoutes };
