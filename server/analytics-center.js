'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function number(value) {
  return Number(value || 0);
}

function safeAll(all, sql, params = []) {
  try {
    return all(sql, params);
  } catch {
    return [];
  }
}

function safeOne(one, sql, params = []) {
  try {
    return one(sql, params) || {};
  } catch {
    return {};
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function registerAnalyticsCenterRoutes(app) {
  app.get(
    '/api/analytics-center',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const days = Math.min(
        365,
        Math.max(7, Number(req.query.days || 30))
      );
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      from.setHours(0, 0, 0, 0);

      const { one, all } = getDatabaseHelpers();

      const overview = {
        employees: number(safeOne(one, `
          SELECT COUNT(*) AS count
          FROM users
          WHERE status != 'archived'
        `).count),
        reports: number(safeOne(one, `
          SELECT COUNT(*) AS count
          FROM advanced_reports
          WHERE datetime(created_at) >= datetime(?)
        `, [from.toISOString()]).count),
        sanctions: number(safeOne(one, `
          SELECT COUNT(*) AS count
          FROM advanced_sanctions
          WHERE datetime(created_at) >= datetime(?)
        `, [from.toISOString()]).count),
        completedTraining: number(safeOne(one, `
          SELECT COUNT(*) AS count
          FROM employee_training
          WHERE status = 'completed'
            AND datetime(COALESCE(completed_at, created_at)) >= datetime(?)
        `, [from.toISOString()]).count)
      };

      const departments = safeAll(all, `
        SELECT department, COUNT(*) AS employees
        FROM users
        WHERE status = 'active'
        GROUP BY department
        ORDER BY employees DESC
      `).map((row) => ({
        department: row.department || 'Non défini',
        employees: number(row.employees)
      }));

      const reportsByDepartment = safeAll(all, `
        SELECT u.department, COUNT(*) AS count
        FROM advanced_reports ar
        JOIN users u ON u.id = ar.author_user_id
        WHERE datetime(ar.created_at) >= datetime(?)
        GROUP BY u.department
        ORDER BY count DESC
      `, [from.toISOString()]).map((row) => ({
        department: row.department || 'Non défini',
        count: number(row.count)
      }));

      const sanctionsByType = safeAll(all, `
        SELECT sanction_type, COUNT(*) AS count
        FROM advanced_sanctions
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY sanction_type
        ORDER BY count DESC
      `, [from.toISOString()]).map((row) => ({
        type: row.sanction_type,
        count: number(row.count)
      }));

      const dailyActivity = safeAll(all, `
        SELECT day,
               SUM(reports) AS reports,
               SUM(sanctions) AS sanctions,
               SUM(messages) AS messages
        FROM (
          SELECT substr(created_at,1,10) AS day,
                 COUNT(*) AS reports, 0 AS sanctions, 0 AS messages
          FROM advanced_reports
          WHERE datetime(created_at) >= datetime(?)
          GROUP BY substr(created_at,1,10)

          UNION ALL

          SELECT substr(created_at,1,10) AS day,
                 0, COUNT(*), 0
          FROM advanced_sanctions
          WHERE datetime(created_at) >= datetime(?)
          GROUP BY substr(created_at,1,10)

          UNION ALL

          SELECT substr(created_at,1,10) AS day,
                 0, 0, COUNT(*)
          FROM chat_messages
          WHERE datetime(created_at) >= datetime(?)
          GROUP BY substr(created_at,1,10)
        )
        GROUP BY day
        ORDER BY day
      `, [
        from.toISOString(),
        from.toISOString(),
        from.toISOString()
      ]).map((row) => ({
        day: row.day,
        reports: number(row.reports),
        sanctions: number(row.sanctions),
        messages: number(row.messages)
      }));

      const topEmployees = safeAll(all, `
        SELECT u.id, u.discord_username, u.matricule, u.department,
               (
                 SELECT COUNT(*) FROM advanced_reports ar
                 WHERE ar.author_user_id = u.id
                   AND datetime(ar.created_at) >= datetime(?)
               ) AS reports,
               (
                 SELECT COUNT(*) FROM chat_messages cm
                 WHERE cm.sender_user_id = u.id
                   AND datetime(cm.created_at) >= datetime(?)
               ) AS messages,
               (
                 SELECT COUNT(*) FROM employee_training et
                 WHERE et.employee_user_id = u.id
                   AND et.status = 'completed'
               ) AS training
        FROM users u
        WHERE u.status = 'active'
        ORDER BY (reports + messages + training) DESC
        LIMIT 15
      `, [
        from.toISOString(),
        from.toISOString()
      ]).map((row) => ({
        id: row.id,
        username: row.discord_username,
        matricule: row.matricule,
        department: row.department,
        reports: number(row.reports),
        messages: number(row.messages),
        training: number(row.training),
        score: number(row.reports) * 3 +
          number(row.messages) +
          number(row.training) * 2
      }));

      res.json({
        ok: true,
        days,
        from: from.toISOString(),
        overview,
        departments,
        reportsByDepartment,
        sanctionsByType,
        dailyActivity,
        topEmployees
      });
    }
  );

  app.get(
    '/api/analytics-center/export.csv',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const { all } = getDatabaseHelpers();

      const rows = safeAll(all, `
        SELECT u.discord_username, u.matricule, u.department, u.grade,
               u.status,
               (SELECT COUNT(*) FROM advanced_reports ar
                WHERE ar.author_user_id = u.id) AS reports,
               (SELECT COUNT(*) FROM chat_messages cm
                WHERE cm.sender_user_id = u.id) AS messages,
               (SELECT COUNT(*) FROM employee_training et
                WHERE et.employee_user_id = u.id
                  AND et.status = 'completed') AS completed_training
        FROM users u
        WHERE u.status != 'archived'
        ORDER BY u.department, u.discord_username
      `);

      const header = [
        'Employé',
        'Matricule',
        'Département',
        'Grade',
        'Statut',
        'Rapports',
        'Messages',
        'Formations terminées'
      ];

      const csv = [
        header.map(csvEscape).join(';'),
        ...rows.map((row) => [
          row.discord_username,
          row.matricule,
          row.department,
          row.grade,
          row.status,
          row.reports,
          row.messages,
          row.completed_training
        ].map(csvEscape).join(';'))
      ].join('\r\n');

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="abyss-nexus-statistiques.csv"'
      );
      res.type('text/csv; charset=utf-8');
      res.send(`\ufeff${csv}`);
    }
  );
}

module.exports = { registerAnalyticsCenterRoutes };
