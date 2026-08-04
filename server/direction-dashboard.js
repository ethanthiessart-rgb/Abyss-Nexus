'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function safeOne(one, sql, params = []) {
  try {
    return one(sql, params) || {};
  } catch {
    return {};
  }
}

function safeAll(all, sql, params = []) {
  try {
    return all(sql, params) || [];
  } catch {
    return [];
  }
}

function number(value) {
  return Number(value || 0);
}

function registerDirectionDashboardRoutes(app) {
  app.get(
    '/api/direction-dashboard',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { one, all } = getDatabaseHelpers();
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 6);
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      const users = safeOne(one, `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN datetime(created_at) >= datetime(?) THEN 1 ELSE 0 END) AS new_this_month
        FROM users
        WHERE status != 'archived'
      `, [monthStart.toISOString()]);

      const leaveToday = safeOne(one, `
        SELECT
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM leave_requests
        WHERE datetime(start_at) < datetime(?)
          AND datetime(end_at) >= datetime(?)
      `, [tomorrowStart.toISOString(), todayStart.toISOString()]);

      const reports = safeOne(one, `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) AS validated,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'changes_requested' THEN 1 ELSE 0 END) AS corrections
        FROM advanced_reports
      `);

      const sanctions = safeOne(one, `
        SELECT
          SUM(CASE WHEN datetime(created_at) >= datetime(?) THEN 1 ELSE 0 END) AS today,
          SUM(CASE WHEN datetime(created_at) >= datetime(?) THEN 1 ELSE 0 END) AS week,
          SUM(CASE WHEN datetime(created_at) >= datetime(?) THEN 1 ELSE 0 END) AS month,
          SUM(CASE WHEN status = 'pending_validation' THEN 1 ELSE 0 END) AS pending_validation
        FROM advanced_sanctions
      `, [
        todayStart.toISOString(),
        weekStart.toISOString(),
        monthStart.toISOString()
      ]);

      const planning = safeOne(one, `
        SELECT
          COUNT(*) AS shifts_today,
          COALESCE(SUM(
            (SELECT COUNT(*)
             FROM planning_shift_members psm
             WHERE psm.shift_id = ps.id)
          ), 0) AS assigned_today
        FROM planning_shifts ps
        WHERE datetime(ps.start_at) < datetime(?)
          AND datetime(ps.end_at) >= datetime(?)
      `, [tomorrowStart.toISOString(), todayStart.toISOString()]);

      const training = safeOne(one, `
        SELECT
          SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS ongoing,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM employee_training
      `);

      const unreadNotifications = safeOne(one, `
        SELECT COUNT(*) AS count
        FROM notifications
        WHERE read_at IS NULL
      `);

      const departments = safeAll(all, `
        SELECT department, COUNT(*) AS count
        FROM users
        WHERE status = 'active'
        GROUP BY department
        ORDER BY count DESC, department COLLATE NOCASE
      `).map((row) => ({
        department: row.department || 'Non défini',
        count: number(row.count)
      }));

      const reportTrend = safeAll(all, `
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
        FROM advanced_reports
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day
      `, [weekStart.toISOString()]);

      const sanctionTrend = safeAll(all, `
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
        FROM advanced_sanctions
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day
      `, [weekStart.toISOString()]);

      const recentAlerts = safeAll(all, `
        SELECT action, details, created_at
        FROM audit_logs
        WHERE action IN (
          'MAINTENANCE_UPDATE',
          'BACKUP_RESTORE_REQUESTED',
          'EMERGENCY_LOGIN_FAILED',
          'EMERGENCY_LOGIN_DENIED',
          'EVALUATION_CREATE',
          'MAIL_SEND'
        )
        ORDER BY created_at DESC
        LIMIT 12
      `).map((row) => ({
        action: row.action,
        details: row.details,
        createdAt: row.created_at
      }));

      const latestBackup = safeOne(one, `
        SELECT file_name, size_bytes, created_at
        FROM backup_history
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const databaseFile = path.join(
        __dirname,
        '..',
        'database',
        'abyss-nexus.sqlite'
      );

      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();

      res.json({
        ok: true,
        generatedAt: now.toISOString(),
        personnel: {
          total: number(users.total),
          active: number(users.active),
          absentToday: number(leaveToday.approved),
          suspended: number(users.suspended),
          newThisMonth: number(users.new_this_month)
        },
        requests: {
          leavePending: number(leaveToday.pending),
          reportsPending: number(reports.pending),
          sanctionsPending: number(sanctions.pending_validation)
        },
        reports: {
          total: number(reports.total),
          pending: number(reports.pending),
          validated: number(reports.validated),
          rejected: number(reports.rejected),
          corrections: number(reports.corrections)
        },
        sanctions: {
          today: number(sanctions.today),
          week: number(sanctions.week),
          month: number(sanctions.month),
          pendingValidation: number(sanctions.pending_validation)
        },
        planning: {
          shiftsToday: number(planning.shifts_today),
          assignedToday: number(planning.assigned_today)
        },
        training: {
          ongoing: number(training.ongoing),
          completed: number(training.completed),
          failed: number(training.failed)
        },
        system: {
          nodeVersion: process.version,
          processUptimeSeconds: Math.round(process.uptime()),
          processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          systemMemoryPercent: Math.round(
            ((totalMemory - freeMemory) / totalMemory) * 100
          ),
          databaseBytes: fs.existsSync(databaseFile)
            ? fs.statSync(databaseFile).size
            : 0,
          unreadNotifications: number(unreadNotifications.count),
          latestBackup: latestBackup.file_name
            ? {
                fileName: latestBackup.file_name,
                sizeBytes: number(latestBackup.size_bytes),
                createdAt: latestBackup.created_at
              }
            : null
        },
        departments,
        trends: {
          reports: reportTrend.map((row) => ({
            day: row.day,
            count: number(row.count)
          })),
          sanctions: sanctionTrend.map((row) => ({
            day: row.day,
            count: number(row.count)
          }))
        },
        recentAlerts
      });
    }
  );
}

module.exports = { registerDirectionDashboardRoutes };
