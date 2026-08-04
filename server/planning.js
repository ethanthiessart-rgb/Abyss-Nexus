'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function clean(value) {
  return String(value ?? '').trim();
}

function registerPlanningRoutes(app) {
  app.get('/api/planning', requirePermission('personnel.view'), (req, res) => {
    const from = clean(req.query.from);
    const to = clean(req.query.to);
    const { all } = getDatabaseHelpers();

    const clauses = [];
    const params = [];

    if (from) {
      clauses.push('ps.start_at >= ?');
      params.push(from);
    }

    if (to) {
      clauses.push('ps.start_at <= ?');
      params.push(to);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const shifts = all(`
      SELECT ps.id, ps.title, ps.start_at, ps.end_at, ps.location,
             ps.color, ps.notes, ps.created_at,
             creator.discord_username AS creator_name,
             GROUP_CONCAT(u.discord_username, '||') AS assignees,
             GROUP_CONCAT(u.id, '||') AS assignee_ids
      FROM planning_shifts ps
      LEFT JOIN users creator ON creator.id = ps.created_by_user_id
      LEFT JOIN planning_shift_members psm ON psm.shift_id = ps.id
      LEFT JOIN users u ON u.id = psm.user_id
      ${where}
      GROUP BY ps.id
      ORDER BY ps.start_at
    `, params);

    res.json({
      ok: true,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        title: shift.title,
        startAt: shift.start_at,
        endAt: shift.end_at,
        location: shift.location,
        color: shift.color,
        notes: shift.notes,
        creatorName: shift.creator_name || 'Système',
        assignees: shift.assignees
          ? String(shift.assignees).split('||')
          : [],
        assigneeIds: shift.assignee_ids
          ? String(shift.assignee_ids).split('||').map(Number)
          : []
      }))
    });
  });

  app.post('/api/planning', requirePermission('personnel.edit'), (req, res) => {
    const title = clean(req.body.title);
    const startAt = clean(req.body.startAt);
    const endAt = clean(req.body.endAt);
    const location = clean(req.body.location);
    const color = clean(req.body.color) || '#3aa9ff';
    const notes = clean(req.body.notes);
    const memberIds = Array.isArray(req.body.memberIds)
      ? [...new Set(req.body.memberIds.map(Number).filter(Number.isInteger))]
      : [];

    if (!title || !startAt || !endAt || new Date(endAt) <= new Date(startAt)) {
      return res.status(400).json({
        ok: false,
        message: 'Titre ou horaires invalides.'
      });
    }

    const { one, run } = getDatabaseHelpers();

    run(`
      INSERT INTO planning_shifts (
        title, start_at, end_at, location, color,
        notes, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      title,
      startAt,
      endAt,
      location || null,
      color,
      notes || null,
      req.session.user.id
    ]);

    const created = one('SELECT MAX(id) AS id FROM planning_shifts');
    const shiftId = Number(created.id);

    for (const userId of memberIds) {
      run(`
        INSERT OR IGNORE INTO planning_shift_members (
          shift_id, user_id
        ) VALUES (?, ?)
      `, [shiftId, userId]);

      run(`
        INSERT INTO notifications (
          user_id, type, title, message, link
        ) VALUES (?, 'planning', 'Nouveau service', ?, '/planning')
      `, [userId, title]);
    }

    run(`
      INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, 'PLANNING_CREATE', ?, ?)
    `, [
      req.session.user.id,
      `Service=${shiftId}; Membres=${memberIds.length}`,
      req.ip
    ]);

    res.status(201).json({
      ok: true,
      message: 'Service ajouté au planning.'
    });
  });

  app.delete(
    '/api/planning/:id',
    requirePermission('personnel.edit'),
    (req, res) => {
      const id = Number(req.params.id);
      const { one, run } = getDatabaseHelpers();

      if (!one('SELECT id FROM planning_shifts WHERE id = ?', [id])) {
        return res.status(404).json({
          ok: false,
          message: 'Service introuvable.'
        });
      }

      run('DELETE FROM planning_shift_members WHERE shift_id = ?', [id]);
      run('DELETE FROM planning_shifts WHERE id = ?', [id]);

      res.json({ ok: true, message: 'Service supprimé.' });
    }
  );
}

module.exports = { registerPlanningRoutes };
