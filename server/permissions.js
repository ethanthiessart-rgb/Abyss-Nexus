'use strict';

const DEPARTMENTS = [
  'Animateur',
  'Morpheur',
  'Builder',
  'Développeur',
  'Scripter',
  'Assistant',
  'Modération',
  'Administration',
  'Administration supérieure',
  'Direction Modération',
  'Équipe de Direction'
];

const PERMISSIONS = [
  { key: 'personnel.view', label: 'Voir le personnel' },
  { key: 'personnel.create', label: 'Créer un compte' },
  { key: 'personnel.edit', label: 'Modifier un employé' },
  { key: 'personnel.disable', label: 'Désactiver ou suspendre un compte' },
  { key: 'personnel.reset_password', label: 'Réinitialiser un mot de passe' },
  { key: 'permissions.manage', label: 'Modifier les permissions' },
  { key: 'reports.view_all', label: 'Voir tous les rapports' },
  { key: 'reports.create', label: 'Créer un rapport' },
  { key: 'announcements.global', label: 'Publier une annonce globale' },
  { key: 'documents.manage', label: 'Gérer les documents' },
  { key: 'discipline.manage', label: 'Gérer les sanctions internes' },
  { key: 'maintenance.manage', label: 'Gérer le centre de maintenance' }
];

const BASE = {
  Animateur: ['reports.create'],
  Morpheur: ['reports.create'],
  Builder: ['reports.create'],
  Développeur: ['reports.create'],
  Scripter: ['reports.create'],
  Assistant: ['reports.create'],
  Modération: ['reports.create'],
  Administration: ['reports.create', 'personnel.view'],
  'Administration supérieure': ['reports.create', 'personnel.view', 'reports.view_all'],
  'Direction Modération': [
    'reports.create',
    'reports.view_all',
    'personnel.view',
    'personnel.edit',
    'personnel.disable',
    'personnel.reset_password',
    'announcements.global',
    'documents.manage',
    'discipline.manage'
  ],
  'Équipe de Direction': PERMISSIONS.map((permission) => permission.key)
};

function getDefaultPermissions(department) {
  return new Set(BASE[department] || ['reports.create']);
}

function getEffectivePermissions(userId, department, one, all) {
  const effective = getDefaultPermissions(department);
  const rows = all(
    'SELECT permission_key, effect FROM user_permission_overrides WHERE user_id = ?',
    [userId]
  );

  for (const row of rows) {
    if (row.effect === 'allow') effective.add(row.permission_key);
    if (row.effect === 'deny') effective.delete(row.permission_key);
  }

  return [...effective];
}

function hasPermission(req, permissionKey) {
  const permissions = req.session.user?.permissions || [];
  return permissions.includes(permissionKey);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ ok: false, message: 'Session expirée.' });
    }
    if (!hasPermission(req, permissionKey)) {
      return res.status(403).json({ ok: false, message: 'Permission insuffisante.' });
    }
    return next();
  };
}

module.exports = {
  DEPARTMENTS,
  PERMISSIONS,
  getDefaultPermissions,
  getEffectivePermissions,
  hasPermission,
  requirePermission
};
