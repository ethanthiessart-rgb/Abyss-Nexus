'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}j ${hours}h ${minutes}m`;
}

function folderSize(folderPath) {
  if (!fs.existsSync(folderPath)) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      total += folderSize(fullPath);
    } else {
      total += fs.statSync(fullPath).size;
    }
  }

  return total;
}

function registerSystemCenterRoutes(app) {
  app.get(
    '/api/system-center',
    requirePermission('maintenance.manage'),
    (_req, res) => {
      const { one } = getDatabaseHelpers();
      const databaseFile = path.join(
        __dirname,
        '..',
        'database',
        'abyss-nexus.sqlite'
      );

      const uploadsPath = path.join(__dirname, '..', 'uploads');

      const memory = process.memoryUsage();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();

      const counts = {
        users: Number(one('SELECT COUNT(*) AS count FROM users')?.count || 0),
        audit: Number(one('SELECT COUNT(*) AS count FROM audit_logs')?.count || 0),
        notifications: Number(
          one('SELECT COUNT(*) AS count FROM notifications')?.count || 0
        )
      };

      res.json({
        ok: true,
        service: {
          nodeVersion: process.version,
          platform: `${os.platform()} ${os.arch()}`,
          processUptime: formatUptime(process.uptime()),
          systemUptime: formatUptime(os.uptime()),
          pid: process.pid
        },
        memory: {
          processMb: Math.round(memory.rss / 1024 / 1024),
          usedSystemMb: Math.round((totalMemory - freeMemory) / 1024 / 1024),
          totalSystemMb: Math.round(totalMemory / 1024 / 1024),
          usagePercent: Math.round(
            ((totalMemory - freeMemory) / totalMemory) * 100
          )
        },
        storage: {
          databaseBytes: fs.existsSync(databaseFile)
            ? fs.statSync(databaseFile).size
            : 0,
          uploadsBytes: folderSize(uploadsPath)
        },
        counts,
        timestamp: new Date().toISOString()
      });
    }
  );
}

module.exports = { registerSystemCenterRoutes };
