'use strict';

const bcrypt = require('bcryptjs');

const { getDatabaseHelpers } = require('./database');
const {
  getEffectivePermissions,
  requirePermission
} = require('./permissions');

let cachedState = {
  mode: 'operational',
  label: 'Opérationnel',
  message: '',
  returnUnknown: false,
  returnAt: null,
  allowedDepartments: [],
  alertCode: 'green',
  alert: { code: 'green', label: 'Code Vert', icon: '🟢', description: 'Site calme. Aucune surveillance renforcée requise.' }
};

const ALERT_CODES = {
  green: { label: 'Code Vert', icon: '🟢', description: 'Site calme. Aucune surveillance renforcée requise.' },
  yellow: { label: 'Code Jaune', icon: '🟡', description: 'Vigilance légère. Une surveillance minimale est recommandée.' },
  orange: { label: 'Code Orange', icon: '🟠', description: 'Site en alerte. Une surveillance renforcée est requise.' },
  red: { label: 'Code Rouge', icon: '🔴', description: 'Alerte majeure. Un dispositif de haute sécurité est requis.' },
  black: { label: 'Code Noir', icon: '⚫', description: 'Menaces multiples ou critiques. Niveau maximal de sécurité requis.' }
};

function alertForCode(code) {
  const normalized = Object.hasOwn(ALERT_CODES, code) ? code : 'green';
  return { code: normalized, ...ALERT_CODES[normalized] };
}

function labelForMode(mode) {
  return {
    operational: 'Opérationnel',
    minor_bug: 'Bug mineur',
    maintenance: 'Maintenance',
    offline: 'Hors ligne'
  }[mode] || 'Opérationnel';
}

function normalizeDepartment(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR');
}

function loadMaintenanceState() {
  try {
    const { one, all } = getDatabaseHelpers();

    const row = one(`
      SELECT mode, message, return_unknown, return_at, alert_code
      FROM maintenance_settings
      WHERE id = 1
    `);

    const departments = all(`
      SELECT department
      FROM maintenance_allowed_departments
      ORDER BY department
    `).map((item) => String(item.department || '').trim());

    cachedState = {
      mode: row?.mode || 'operational',
      label: labelForMode(row?.mode || 'operational'),
      message: row?.message || '',
      returnUnknown: Boolean(row?.return_unknown),
      returnAt: row?.return_at || null,
      allowedDepartments: departments,
      alertCode: alertForCode(row?.alert_code || 'green').code,
      alert: alertForCode(row?.alert_code || 'green')
    };
  } catch (error) {
    console.error('Impossible de charger l’état de maintenance :', error);
  }

  return cachedState;
}

function getMaintenanceState() {
  return loadMaintenanceState();
}

function getLiveUser(userId) {
  if (!userId) return null;

  try {
    const { one } = getDatabaseHelpers();

    return one(`
      SELECT id, discord_username, avatar_url, matricule,
             identifier, password_hash, grade, department,
             status, account_type
      FROM users
      WHERE id = ?
    `, [userId]);
  } catch (error) {
    console.error('Impossible de vérifier le compte connecté :', error);
    return null;
  }
}

function buildSessionUser(user) {
  const { one, all } = getDatabaseHelpers();

  return {
    id: user.id,
    username: user.discord_username,
    avatarUrl: user.avatar_url,
    matricule: user.matricule,
    identifier: user.identifier,
    grade: user.grade,
    department: user.department,
    status: user.status,
    accountType: user.account_type,
    permissions: getEffectivePermissions(
      user.id,
      user.department,
      one,
      all
    ),
    emergencyAccess: true
  };
}

function isDepartmentAllowed(department, state) {
  const normalized = normalizeDepartment(department);

  return state.allowedDepartments
    .map(normalizeDepartment)
    .includes(normalized);
}

function userHasEmergencyAccess(user, permissions, state) {
  if (!user || user.status !== 'active') return false;

  if (user.account_type === 'direction') return true;
  if (permissions.includes('maintenance.manage')) return true;

  return isDepartmentAllowed(user.department, state);
}

function userCanBypass(req, state) {
  const liveUser = getLiveUser(req.session?.user?.id);

  if (!liveUser || liveUser.status !== 'active') return false;

  const permissions = Array.isArray(req.session.user.permissions)
    ? req.session.user.permissions
    : [];

  return userHasEmergencyAccess(liveUser, permissions, state);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function maintenancePage(state) {
  const returnText = state.returnUnknown
    ? 'Retour inconnu'
    : state.returnAt
      ? `Retour estimé : ${new Date(state.returnAt).toLocaleString('fr-FR')}`
      : 'Aucune heure de retour indiquée';

  return `
    <!doctype html>
    <html lang="fr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Abyss Nexus — ${escapeHtml(state.label)}</title>
      <style>
        :root {
          color-scheme: dark;
          --border: #263849;
          --surface: #0a131d;
          --surface-2: #07101a;
          --text: #ffffff;
          --muted: #a9b9c8;
          --accent: #38a9f5;
          --danger: #ff768a;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 28px 16px;
          background:
            radial-gradient(circle at 50% 18%, rgba(33,130,196,.13), transparent 32rem),
            #050a10;
          color: var(--text);
          font-family: Arial, sans-serif;
        }

        main {
          width: min(660px, 100%);
          padding: 32px;
          border: 1px solid var(--border);
          border-radius: 18px;
          background: rgba(10,19,29,.97);
          text-align: center;
          box-shadow: 0 28px 90px rgba(0,0,0,.42);
        }

        .logo {
          width: 110px;
          height: 110px;
          border-radius: 50%;
          object-fit: cover;
          animation: spin 8s linear infinite;
        }

        h1 {
          margin: 22px 0 8px;
          letter-spacing: .14em;
        }

        h2 { margin: 14px 0; }

        .message {
          color: var(--muted);
          line-height: 1.6;
          white-space: pre-wrap;
        }

        .return {
          color: #71c8ff;
          font-weight: 700;
        }

        .divider {
          height: 1px;
          margin: 26px 0;
          background: rgba(255,255,255,.08);
        }

        .emergency-title {
          margin: 0 0 6px;
          font-size: 1rem;
          letter-spacing: .09em;
          color: #7bc9ff;
        }

        .emergency-description {
          margin: 0 0 18px;
          color: var(--muted);
          font-size: .9rem;
        }

        form {
          display: grid;
          gap: 12px;
          text-align: left;
        }

        label {
          display: grid;
          gap: 7px;
          color: #dbe8f1;
          font-size: .86rem;
        }

        input {
          width: 100%;
          padding: 12px 13px;
          border: 1px solid var(--border);
          border-radius: 10px;
          outline: none;
          background: var(--surface-2);
          color: white;
        }

        input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(56,169,245,.12);
        }

        button {
          margin-top: 6px;
          padding: 12px 14px;
          border: 1px solid #2e9ce9;
          border-radius: 10px;
          background: linear-gradient(180deg,#228ed5,#176ea8);
          color: white;
          font-weight: 700;
          cursor: pointer;
        }

        button:disabled {
          opacity: .65;
          cursor: wait;
        }

        .feedback {
          min-height: 22px;
          margin: 2px 0 0;
          color: var(--danger);
          text-align: center;
          font-size: .85rem;
        }

        .emergency-note {
          margin: 12px 0 0;
          color: #72889a;
          font-size: .74rem;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <main>
        <img class="logo"
             src="/assets/logos/abyss-nexus-logo.png"
             alt="Logo Abyss Nexus">

        <h1>ABYSS NEXUS</h1>
        <h2>${escapeHtml(state.label)}</h2>

        <p class="message">${
          escapeHtml(
            state.message ||
            'Le portail est temporairement indisponible.'
          )
        }</p>

        <p class="return">${escapeHtml(returnText)}</p>

        <div class="divider"></div>

        <p class="emergency-title">ACCÈS AUTORISÉ EN MODE MAINTENANCE</p>
        <p class="emergency-description">
          Saisissez vos trois informations de connexion. L’accès sera accordé
          uniquement aux comptes Direction, aux détenteurs de la permission
          de maintenance ou aux départements autorisés.
        </p>

        <form id="emergency-login-form">
          <label>
            Matricule
            <input id="emergency-matricule"
                   name="matricule"
                   autocomplete="off"
                   required>
          </label>

          <label>
            Identifiant
            <input id="emergency-identifier"
                   name="identifier"
                   autocomplete="username"
                   required>
          </label>

          <label>
            Mot de passe
            <input id="emergency-password"
                   name="password"
                   type="password"
                   autocomplete="current-password"
                   required>
          </label>

          <p id="emergency-feedback"
             class="feedback"
             role="alert"></p>

          <button id="emergency-submit" type="submit">
            Accéder malgré la maintenance
          </button>
        </form>

        <p class="emergency-note">
          Les tentatives et connexions d’urgence sont enregistrées dans le
          journal d’audit.
        </p>
      </main>

      <script>
        (() => {
          const form = document.querySelector('#emergency-login-form');
          const button = document.querySelector('#emergency-submit');
          const feedback = document.querySelector('#emergency-feedback');

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            feedback.textContent = '';
            button.disabled = true;
            button.textContent = 'Vérification...';

            try {
              const response = await fetch('/api/maintenance/emergency-login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({
                  matricule: document.querySelector('#emergency-matricule').value,
                  identifier: document.querySelector('#emergency-identifier').value,
                  password: document.querySelector('#emergency-password').value
                })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(
                  data.message || 'Connexion d’urgence refusée.'
                );
              }

              button.textContent = 'Accès autorisé';
              location.assign(data.redirect || '/dashboard');
            } catch (error) {
              feedback.textContent = error.message;
              button.disabled = false;
              button.textContent = 'Accéder malgré la maintenance';
            }
          });
        })();
      </script>
    </body>
    </html>
  `;
}

function maintenanceGate(req, res, next) {
  const state = getMaintenanceState();

  if (
    state.mode === 'operational' ||
    state.mode === 'minor_bug' ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/assets/') ||
    req.path === '/'
  ) {
    return next();
  }

  if (userCanBypass(req, state)) {
    return next();
  }

  return res.status(503).send(maintenancePage(state));
}

function registerMaintenanceRoutes(app) {
  app.post('/api/maintenance/emergency-login', async (req, res) => {
    const matricule = String(req.body.matricule || '').trim();
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');

    if (!matricule || !identifier || !password) {
      return res.status(400).json({
        ok: false,
        message: 'Matricule, identifiant et mot de passe obligatoires.'
      });
    }

    const state = getMaintenanceState();
    const { one, all, run } = getDatabaseHelpers();

    const user = one(`
      SELECT id, discord_username, avatar_url, matricule,
             identifier, password_hash, grade, department,
             status, account_type
      FROM users
      WHERE LOWER(matricule) = LOWER(?)
        AND LOWER(identifier) = LOWER(?)
      LIMIT 1
    `, [matricule, identifier]);

    const passwordValid = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !passwordValid || user.status !== 'active') {
      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (NULL, 'EMERGENCY_LOGIN_FAILED', ?, ?)
      `, [
        `Matricule=${matricule}; Identifiant=${identifier}`,
        req.ip
      ]);

      return res.status(401).json({
        ok: false,
        message: 'Informations de connexion incorrectes.'
      });
    }

    const permissions = getEffectivePermissions(
      user.id,
      user.department,
      one,
      all
    );

    if (!userHasEmergencyAccess(user, permissions, state)) {
      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'EMERGENCY_LOGIN_DENIED', ?, ?)
      `, [
        user.id,
        `Département=${user.department}; Mode=${state.mode}`,
        req.ip
      ]);

      return res.status(403).json({
        ok: false,
        message:
          'Votre compte est valide, mais il n’est pas autorisé pendant cet état du portail.'
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        console.error('Impossible de régénérer la session :', error);

        return res.status(500).json({
          ok: false,
          message: 'Impossible de créer la session d’urgence.'
        });
      }

      req.session.user = {
        id: user.id,
        username: user.discord_username,
        avatarUrl: user.avatar_url,
        matricule: user.matricule,
        identifier: user.identifier,
        grade: user.grade,
        department: user.department,
        status: user.status,
        accountType: user.account_type,
        permissions,
        emergencyAccess: true
      };

      req.session.save((saveError) => {
        if (saveError) {
          console.error('Impossible d’enregistrer la session :', saveError);

          return res.status(500).json({
            ok: false,
            message: 'Impossible d’enregistrer la session d’urgence.'
          });
        }

        run(`
          INSERT INTO audit_logs (
            user_id, action, details, ip_address
          ) VALUES (?, 'EMERGENCY_LOGIN_SUCCESS', ?, ?)
        `, [
          user.id,
          `Département=${user.department}; Mode=${state.mode}`,
          req.ip
        ]);

        return res.json({
          ok: true,
          message: 'Accès d’urgence autorisé.',
          redirect: '/dashboard'
        });
      });
    });
  });

  app.get(
    '/api/maintenance',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { all } = getDatabaseHelpers();

      const departments = all(`
        SELECT name, color, icon, active
        FROM departments
        ORDER BY name
      `);

      res.json({
        ok: true,
        state: getMaintenanceState(),
        departments: departments.map((department) => ({
          name: department.name,
          color: department.color,
          icon: department.icon,
          active: Boolean(department.active)
        }))
      });
    }
  );

  app.put(
    '/api/maintenance',
    requirePermission('maintenance.manage'),
    async (req, res) => {
      const modes = new Set([
        'operational',
        'minor_bug',
        'maintenance',
        'offline'
      ]);

      const mode = String(req.body.mode || '');
      const alertCode = String(req.body.alertCode || 'green').toLowerCase();
      const message = String(req.body.message || '').trim();
      const returnUnknown = Boolean(req.body.returnUnknown);
      const returnAt = String(req.body.returnAt || '').trim() || null;
      const allowedDepartments = Array.isArray(req.body.allowedDepartments)
        ? [...new Set(
            req.body.allowedDepartments
              .map((value) => String(value || '').trim())
              .filter(Boolean)
          )]
        : [];

      if (!modes.has(mode)) {
        return res.status(400).json({ ok: false, message: 'État du portail invalide.' });
      }

      if (!Object.hasOwn(ALERT_CODES, alertCode)) {
        return res.status(400).json({ ok: false, message: "Code d'alerte invalide." });
      }

      const { run, persistDatabaseNow } = getDatabaseHelpers();

      run(`
        INSERT INTO maintenance_settings (
          id, mode, message, return_unknown, return_at, alert_code,
          updated_by_user_id, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          message = excluded.message,
          return_unknown = excluded.return_unknown,
          return_at = excluded.return_at,
          alert_code = excluded.alert_code,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `, [
        mode,
        message,
        returnUnknown ? 1 : 0,
        returnUnknown ? null : returnAt,
        alertCode,
        req.session.user.id
      ]);

      run('DELETE FROM maintenance_allowed_departments');

      for (const department of allowedDepartments) {
        run(`
          INSERT OR IGNORE INTO maintenance_allowed_departments (department)
          VALUES (?)
        `, [department]);
      }

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'MAINTENANCE_UPDATE', ?, ?)
      `, [
        req.session.user.id,
        `Mode=${mode}; Alerte=${alertForCode(alertCode).label}; Départements=${allowedDepartments.join(', ') || 'aucun'}`,
        req.ip
      ]);

      loadMaintenanceState();

      try {
        // On ne répond "sauvegardé" qu'après confirmation de la copie durable Neon.
        await persistDatabaseNow();
      } catch (error) {
        console.error("Impossible de confirmer la sauvegarde durable de l'état du portail :", error);

        return res.status(503).json({
          ok: false,
          message:
            "L'état a été modifié localement, mais la sauvegarde permanente Neon a échoué. Réessayez avant de redémarrer Render."
        });
      }

      res.json({
        ok: true,
        message: 'État du portail sauvegardé durablement.',
        state: cachedState
      });
    }
  );
}

module.exports = {
  registerMaintenanceRoutes,
  maintenanceGate,
  getMaintenanceState
};
