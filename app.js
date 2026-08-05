'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');

const { initializeDatabase, closeDatabase } = require('./server/database');
const { registerAuthRoutes } = require('./server/auth');
const { registerPersonnelRoutes } = require('./server/personnel');
const { registerReportRoutes } = require('./server/reports');
const { registerMailRoutes } = require('./server/mail');
const { registerDisciplineRoutes } = require('./server/discipline');
const { registerAnnouncementRoutes } = require('./server/announcements');
const { registerDocumentRoutes } = require('./server/documents');
const { registerPermissionCenterRoutes } = require('./server/permission-center');
const { registerAuditRoutes } = require('./server/audit');
const { registerNotificationCenterRoutes } = require('./server/notification-center');
const { registerAccountRoutes } = require('./server/account');
const { registerStatisticsRoutes } = require('./server/statistics');
const { registerArchiveRoutes } = require('./server/archives');
const { registerSystemCenterRoutes } = require('./server/system-center');
const { registerMaintenanceRoutes, maintenanceGate } = require('./server/maintenance');
const { registerBackupRoutes } = require('./server/backups');
const { registerDepartmentRoutes } = require('./server/departments');
const { registerEmployeeHubRoutes } = require('./server/employee-hub');
const { registerEvaluationRoutes } = require('./server/evaluations');
const { registerTrainingRoutes } = require('./server/training');
const { registerCareerRoutes } = require('./server/career');
const { registerPlanningRoutes } = require('./server/planning');
const { registerLeaveRoutes } = require('./server/leave');
const { registerAdvancedSanctionRoutes } = require('./server/sanctions-advanced');
const { registerAdvancedReportRoutes } = require('./server/reports-advanced');
const { registerRealtimeNotificationRoutes } = require('./server/realtime-notifications');
const { registerChatRoutes } = require('./server/chat');
const { registerDirectionDashboardRoutes } = require('./server/direction-dashboard');
const { registerGlobalSettingsRoutes } = require('./server/global-settings');
const { registerAdminCenterRoutes } = require('./server/admin-center');
const { registerAnalyticsCenterRoutes } = require('./server/analytics-center');
const { registerDocumentLibraryRoutes } = require('./server/document-library');
const { registerCommunicationCenterRoutes } = require('./server/communication-center');
const { registerReleaseCenterRoutes } = require('./server/release-center');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'abyss-nexus-dev-secret-change-me';

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: 'anx.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/status', async (_req, res) => {
  const { getMaintenanceState } = require('./server/maintenance');
  const state = getMaintenanceState();

  res.json({
    status: state.mode,
    label: state.label,
    message: state.message,
    returnUnknown: state.returnUnknown,
    returnAt: state.returnAt,
    core: 'Core v1.0',
    timestamp: new Date().toISOString()
  });
});

registerAuthRoutes(app);
registerPersonnelRoutes(app);
registerReportRoutes(app);
registerMailRoutes(app);
registerDisciplineRoutes(app);
registerAnnouncementRoutes(app);
registerDocumentRoutes(app);
registerPermissionCenterRoutes(app);
registerAuditRoutes(app);
registerNotificationCenterRoutes(app);
registerAccountRoutes(app);
registerStatisticsRoutes(app);
registerArchiveRoutes(app);
registerSystemCenterRoutes(app);
registerMaintenanceRoutes(app);
registerBackupRoutes(app);
registerDepartmentRoutes(app);
registerEmployeeHubRoutes(app);
registerEvaluationRoutes(app);
registerTrainingRoutes(app);
registerCareerRoutes(app);
registerPlanningRoutes(app);
registerLeaveRoutes(app);
registerAdvancedSanctionRoutes(app);
registerAdvancedReportRoutes(app);
registerRealtimeNotificationRoutes(app);
registerChatRoutes(app);
registerDirectionDashboardRoutes(app);
registerGlobalSettingsRoutes(app);
registerAdminCenterRoutes(app);
registerAnalyticsCenterRoutes(app);
registerDocumentLibraryRoutes(app);
registerCommunicationCenterRoutes(app);
registerReleaseCenterRoutes(app);

app.use(maintenanceGate);

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  return res.sendFile(path.join(__dirname, 'index.html'));
});

function requireAuthentication(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

function injectSharedShell(html) {
  const headAssets = `
    <link rel="stylesheet" href="/css/shared-shell.css">
  `;

  const bodyAssets = `
    <script src="/js/core/navigation.js" defer></script>
    <script src="/js/core/session-lock.js" defer></script>
    <script src="/js/core/global-settings-runtime.js" defer></script>
  `;

  let output = html;

  if (!output.includes('/css/shared-shell.css')) {
    output = output.replace('</head>', `${headAssets}</head>`);
  }

  if (!output.includes('/js/core/navigation.js')) {
    output = output.replace('</body>', `${bodyAssets}</body>`);
  }

  return output;
}

function protectedHtml(...segments) {
  return [
    requireAuthentication,
    (_req, res, next) => {
      try {
        const filePath = path.join(__dirname, ...segments);
        const html = fs.readFileSync(filePath, 'utf8');
        res.type('html').send(injectSharedShell(html));
      } catch (error) {
        next(error);
      }
    }
  ];
}

const pages = {
  '/dashboard': ['pages', 'dashboard', 'index.html'],
  '/personnel': ['pages', 'personnel', 'index.html'],
  '/reports': ['pages', 'reports', 'index.html'],
  '/mail': ['pages', 'mail', 'index.html'],
  '/discipline': ['pages', 'discipline', 'index.html'],
  '/announcements': ['pages', 'announcements', 'index.html'],
  '/documents': ['pages', 'documents', 'index.html'],
  '/permissions': ['pages', 'permissions', 'index.html'],
  '/audit': ['pages', 'audit', 'index.html'],
  '/notifications': ['pages', 'notifications', 'index.html'],
  '/settings': ['pages', 'settings', 'index.html'],
  '/statistics': ['pages', 'statistics', 'index.html'],
  '/archives': ['pages', 'archives', 'index.html'],
  '/system': ['pages', 'system', 'index.html'],
  '/maintenance': ['pages', 'maintenance', 'index.html'],
  '/backups': ['pages', 'backups', 'index.html'],
  '/departments': ['pages', 'departments', 'index.html'],
  '/employees': ['pages', 'employees', 'index.html'],
  '/evaluations': ['pages', 'evaluations', 'index.html'],
  '/training': ['pages', 'training', 'index.html'],
  '/career': ['pages', 'career', 'index.html'],
  '/planning': ['pages', 'planning', 'index.html'],
  '/leave': ['pages', 'leave', 'index.html'],
  '/sanctions-advanced': ['pages', 'sanctions-advanced', 'index.html'],
  '/reports-advanced': ['pages', 'reports-advanced', 'index.html'],
  '/realtime-notifications': ['pages', 'realtime-notifications', 'index.html'],
  '/chat': ['pages', 'chat', 'index.html'],
  '/direction-dashboard': ['pages', 'direction-dashboard', 'index.html'],
  '/global-settings': ['pages', 'global-settings', 'index.html'],
  '/admin-center': ['pages', 'admin-center', 'index.html'],
  '/analytics-center': ['pages', 'analytics-center', 'index.html'],
  '/document-library': ['pages', 'document-library', 'index.html'],
  '/communication-center': ['pages', 'communication-center', 'index.html'],
  '/about': ['pages', 'about', 'index.html']
};

for (const [route, file] of Object.entries(pages)) {
  app.get(route, ...protectedHtml(...file));
}

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, message: 'Route API introuvable.' });
});

app.use((_req, res) => res.redirect('/'));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send('Une erreur interne est survenue.');
});

let httpServer;
let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;

  console.log(`${signal} reçu : sauvegarde de la base avant arrêt...`);

  const forceExit = setTimeout(() => {
    console.error('Arrêt forcé après expiration du délai de sauvegarde.');
    process.exit(1);
  }, 12_000);
  forceExit.unref();

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    await closeDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('Erreur pendant l’arrêt propre :', error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

initializeDatabase()
  .then(() => {
    httpServer = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Abyss Nexus disponible sur http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Impossible de démarrer Abyss Nexus :', error);
    process.exit(1);
  });
