'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { getDatabaseHelpers } = require('./database');

function safeCheck(one, sql, params = []) {
  try {
    one(sql, params);
    return true;
  } catch {
    return false;
  }
}

function registerReleaseCenterRoutes(app) {
  app.get('/api/release-center', (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({
        ok: false,
        message: 'Session expirée.'
      });
    }

    const { one } = getDatabaseHelpers();
    const databaseFile = path.join(
      __dirname,
      '..',
      'database',
      'abyss-nexus.sqlite'
    );

    const checks = [
      {
        key: 'database',
        label: 'Base SQLite',
        ok: fs.existsSync(databaseFile)
      },
      {
        key: 'users',
        label: 'Table utilisateurs',
        ok: safeCheck(one, 'SELECT COUNT(*) AS count FROM users')
      },
      {
        key: 'notifications',
        label: 'Table notifications',
        ok: safeCheck(one, 'SELECT COUNT(*) AS count FROM notifications')
      },
      {
        key: 'documents',
        label: 'Bibliothèque documentaire',
        ok: safeCheck(one, 'SELECT COUNT(*) AS count FROM library_documents')
      },
      {
        key: 'communications',
        label: 'Centre de communication',
        ok: safeCheck(one, 'SELECT COUNT(*) AS count FROM communication_campaigns')
      }
    ];

    res.json({
      ok: true,
      product: {
        name: 'Abyss Nexus',
        version: '1.0.0',
        channel: 'Stable',
        core: 'Core v1.0',
        releaseDate: '2026-08-04'
      },
      system: {
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.release()}`,
        architecture: os.arch(),
        uptimeSeconds: Math.round(process.uptime()),
        processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        databaseBytes: fs.existsSync(databaseFile)
          ? fs.statSync(databaseFile).size
          : 0
      },
      checks,
      modules: [
        'Authentification et permissions',
        'Gestion du personnel',
        'Rapports et sanctions',
        'Messagerie et chat interne',
        'Notifications en temps réel',
        'Planning, congés et carrière',
        'Formations et évaluations',
        'Dashboard Direction',
        'Configuration globale',
        'Administration avancée',
        'Statistiques avancées',
        'Bibliothèque documentaire',
        'Centre de communication'
      ]
    });
  });
}

module.exports = { registerReleaseCenterRoutes };
