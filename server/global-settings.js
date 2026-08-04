'use strict';

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

const DEFAULTS = {
  branding: {
    organizationName: 'Abyss Nexus',
    portalSubtitle: 'Staff Management System',
    welcomeMessage: 'Bienvenue sur Abyss Nexus',
    loginMessage: 'Connectez-vous pour accéder au portail.',
    primaryColor: '#238fd3',
    secondaryColor: '#796cff',
    defaultTheme: 'abyss-blue',
    logoUrl: '/assets/logos/abyss-nexus-logo.png',
    bannerUrl: '',
    faviconUrl: ''
  },
  security: {
    passwordMinLength: 8,
    requireUppercase: true,
    requireNumber: true,
    requireSpecial: false,
    sessionDurationMinutes: 480,
    autoLockMinutes: 15,
    maxLoginAttempts: 5,
    temporaryBlockMinutes: 15,
    emergencyMaintenanceLogin: true
  },
  general: {
    locale: 'fr-FR',
    timezone: 'Europe/Paris',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    coreName: 'Core',
    versionLabel: 'v1.0',
    animationsEnabled: true,
    glowEnabled: true,
    notificationSoundsEnabled: false
  },
  modules: {
    chat: true,
    realtimeNotifications: true,
    advancedReports: true,
    advancedSanctions: true,
    training: true,
    evaluations: true,
    planning: true,
    career: true,
    archives: true,
    statistics: true
  },
  backup: {
    automaticEnabled: false,
    frequency: 'daily',
    hour: '03:00',
    retentionCount: 7,
    includeUploads: true
  },
  notifications: {
    browserEnabled: true,
    urgentEnabled: true,
    reportsEnabled: true,
    sanctionsEnabled: true,
    trainingEnabled: true,
    leaveEnabled: true,
    maintenanceEnabled: true,
    backupsEnabled: true
  }
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function deepMerge(base, incoming) {
  const output = { ...base };

  for (const [key, value] of Object.entries(incoming || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function getGlobalSettings() {
  const { one } = getDatabaseHelpers();
  const row = one(`
    SELECT settings_json
    FROM global_settings
    WHERE id = 1
  `);

  return deepMerge(
    cloneDefaults(),
    safeParse(row?.settings_json || '{}', {})
  );
}

function validateSettings(settings) {
  const errors = [];

  if (!settings.branding.organizationName?.trim()) {
    errors.push('Le nom de l’organisation est obligatoire.');
  }

  const minLength = Number(settings.security.passwordMinLength);
  if (!Number.isInteger(minLength) || minLength < 6 || minLength > 64) {
    errors.push('La longueur minimale du mot de passe doit être comprise entre 6 et 64.');
  }

  const sessionDuration = Number(settings.security.sessionDurationMinutes);
  if (!Number.isInteger(sessionDuration) || sessionDuration < 15 || sessionDuration > 10080) {
    errors.push('La durée de session doit être comprise entre 15 et 10080 minutes.');
  }

  const autoLock = Number(settings.security.autoLockMinutes);
  if (!Number.isInteger(autoLock) || autoLock < 1 || autoLock > 1440) {
    errors.push('Le verrouillage automatique doit être compris entre 1 et 1440 minutes.');
  }

  const attempts = Number(settings.security.maxLoginAttempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 25) {
    errors.push('Le nombre de tentatives doit être compris entre 1 et 25.');
  }

  const retention = Number(settings.backup.retentionCount);
  if (!Number.isInteger(retention) || retention < 1 || retention > 100) {
    errors.push('Le nombre de sauvegardes conservées doit être compris entre 1 et 100.');
  }

  return errors;
}

function registerGlobalSettingsRoutes(app) {
  app.get('/api/global-settings/public', (req, res) => {
    const settings = getGlobalSettings();

    res.json({
      ok: true,
      branding: settings.branding,
      general: settings.general,
      modules: settings.modules,
      notifications: {
        browserEnabled: settings.notifications.browserEnabled
      },
      session: {
        autoLockMinutes: settings.security.autoLockMinutes,
        emergencyMaintenanceLogin: settings.security.emergencyMaintenanceLogin
      }
    });
  });

  app.get(
    '/api/global-settings',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      res.json({
        ok: true,
        settings: getGlobalSettings()
      });
    }
  );

  app.put(
    '/api/global-settings',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const current = getGlobalSettings();
      const incoming = req.body?.settings || {};
      const next = deepMerge(current, incoming);
      const errors = validateSettings(next);

      if (errors.length) {
        return res.status(400).json({
          ok: false,
          message: errors[0],
          errors
        });
      }

      const { run } = getDatabaseHelpers();

      run(`
        INSERT INTO global_settings (
          id, settings_json, updated_by_user_id, updated_at
        ) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          settings_json = excluded.settings_json,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `, [
        JSON.stringify(next),
        req.session.user.id
      ]);

      run(`
        INSERT INTO global_settings_history (
          changed_by_user_id, old_settings_json,
          new_settings_json, ip_address
        ) VALUES (?, ?, ?, ?)
      `, [
        req.session.user.id,
        JSON.stringify(current),
        JSON.stringify(next),
        req.ip
      ]);

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'GLOBAL_SETTINGS_UPDATE', ?, ?)
      `, [
        req.session.user.id,
        'Configuration globale modifiée.',
        req.ip
      ]);

      res.json({
        ok: true,
        message: 'Configuration globale enregistrée.',
        settings: next
      });
    }
  );

  app.post(
    '/api/global-settings/reset',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const current = getGlobalSettings();
      const defaults = cloneDefaults();
      const { run } = getDatabaseHelpers();

      run(`
        INSERT INTO global_settings (
          id, settings_json, updated_by_user_id, updated_at
        ) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          settings_json = excluded.settings_json,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `, [
        JSON.stringify(defaults),
        req.session.user.id
      ]);

      run(`
        INSERT INTO global_settings_history (
          changed_by_user_id, old_settings_json,
          new_settings_json, ip_address
        ) VALUES (?, ?, ?, ?)
      `, [
        req.session.user.id,
        JSON.stringify(current),
        JSON.stringify(defaults),
        req.ip
      ]);

      res.json({
        ok: true,
        message: 'Configuration réinitialisée.',
        settings: defaults
      });
    }
  );

  app.get(
    '/api/global-settings/history',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const rows = all(`
        SELECT h.id, h.created_at, h.ip_address,
               u.discord_username AS actor_name
        FROM global_settings_history h
        LEFT JOIN users u ON u.id = h.changed_by_user_id
        ORDER BY h.created_at DESC
        LIMIT 100
      `);

      res.json({
        ok: true,
        history: rows.map((row) => ({
          id: row.id,
          actorName: row.actor_name || 'Système',
          ipAddress: row.ip_address,
          createdAt: row.created_at
        }))
      });
    }
  );
}

module.exports = {
  registerGlobalSettingsRoutes,
  getGlobalSettings
};
