'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const bcrypt = require('bcryptjs');

const { getDatabaseHelpers } = require('./database');
const { requirePermission } = require('./permissions');

const ROOT = path.join(__dirname, '..');
const DATABASE_FILE = path.join(ROOT, 'database', 'abyss-nexus.sqlite');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const BACKUP_DIR = path.join(ROOT, 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

function sanitizeFileName(name) {
  return path.basename(String(name || ''));
}

function createBackupName() {
  const stamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace('T', '_')
    .replace(/\..+$/, '');

  return `Abyss-Nexus_${stamp}_${crypto.randomBytes(3).toString('hex')}.zip`;
}

function registerBackupRoutes(app) {
  app.get('/api/backups', requirePermission('maintenance.manage'), (_req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT b.id, b.file_name, b.size_bytes, b.created_at,
             u.discord_username AS author_name
      FROM backup_history b
      LEFT JOIN users u ON u.id = b.created_by_user_id
      ORDER BY b.created_at DESC
    `);

    res.json({
      ok: true,
      backups: rows.map((row) => ({
        id: row.id,
        fileName: row.file_name,
        sizeBytes: Number(row.size_bytes || 0),
        createdAt: row.created_at,
        authorName: row.author_name || 'Système'
      }))
    });
  });

  app.post('/api/backups', requirePermission('maintenance.manage'), (req, res) => {
    const fileName = createBackupName();
    const filePath = path.join(BACKUP_DIR, fileName);
    const includeUploads = req.body.includeUploads !== false;

    const inputs = ['database'];
    if (includeUploads && fs.existsSync(UPLOADS_DIR)) {
      inputs.push('uploads');
    }

    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path ${inputs.map((item) => `"${path.join(ROOT, item)}"`).join(',')} -DestinationPath "${filePath}" -Force`
        ],
        { cwd: ROOT, stdio: 'ignore' }
      );
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: 'Impossible de créer la sauvegarde avec PowerShell.'
      });
    }

    const sizeBytes = fs.statSync(filePath).size;
    const { run } = getDatabaseHelpers();

    run(`
      INSERT INTO backup_history (
        file_name, size_bytes, created_by_user_id
      ) VALUES (?, ?, ?)
    `, [fileName, sizeBytes, req.session.user.id]);

    run(`
      INSERT INTO audit_logs (
        user_id, action, details, ip_address
      ) VALUES (?, 'BACKUP_CREATE', ?, ?)
    `, [req.session.user.id, `Fichier=${fileName}; Taille=${sizeBytes}`, req.ip]);

    res.status(201).json({
      ok: true,
      message: 'Sauvegarde créée.',
      fileName
    });
  });

  app.get(
    '/api/backups/:name/download',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const fileName = sanitizeFileName(req.params.name);
      const filePath = path.join(BACKUP_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          ok: false,
          message: 'Sauvegarde introuvable.'
        });
      }

      res.download(filePath, fileName);
    }
  );

  app.delete(
    '/api/backups/:name',
    requirePermission('maintenance.manage'),
    (req, res) => {
      const fileName = sanitizeFileName(req.params.name);
      const filePath = path.join(BACKUP_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          ok: false,
          message: 'Sauvegarde introuvable.'
        });
      }

      fs.unlinkSync(filePath);

      const { run } = getDatabaseHelpers();

      run('DELETE FROM backup_history WHERE file_name = ?', [fileName]);

      run(`
        INSERT INTO audit_logs (
          user_id, action, details, ip_address
        ) VALUES (?, 'BACKUP_DELETE', ?, ?)
      `, [req.session.user.id, `Fichier=${fileName}`, req.ip]);

      res.json({
        ok: true,
        message: 'Sauvegarde supprimée.'
      });
    }
  );

  app.post(
    '/api/backups/:name/restore',
    requirePermission('maintenance.manage'),
    async (req, res) => {
      const password = String(req.body.password || '');
      const fileName = sanitizeFileName(req.params.name);
      const filePath = path.join(BACKUP_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          ok: false,
          message: 'Sauvegarde introuvable.'
        });
      }

      const { one, run } = getDatabaseHelpers();
      const user = one(
        'SELECT password_hash FROM users WHERE id = ?',
        [req.session.user.id]
      );

      const valid = user
        ? await bcrypt.compare(password, user.password_hash)
        : false;

      if (!valid) {
        return res.status(401).json({
          ok: false,
          message: 'Mot de passe incorrect.'
        });
      }

      const restoreDir = path.join(
        BACKUP_DIR,
        `restore-${Date.now()}`
      );

      fs.mkdirSync(restoreDir, { recursive: true });

      try {
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path "${filePath}" -DestinationPath "${restoreDir}" -Force`
          ],
          { stdio: 'ignore' }
        );

        const restoredDatabase = path.join(
          restoreDir,
          'database',
          'abyss-nexus.sqlite'
        );

        if (!fs.existsSync(restoredDatabase)) {
          throw new Error('La sauvegarde ne contient pas la base.');
        }

        const safetyCopy = `${DATABASE_FILE}.before-restore-${Date.now()}`;
        fs.copyFileSync(DATABASE_FILE, safetyCopy);
        fs.copyFileSync(restoredDatabase, DATABASE_FILE);

        const restoredUploads = path.join(restoreDir, 'uploads');
        if (fs.existsSync(restoredUploads)) {
          fs.cpSync(restoredUploads, UPLOADS_DIR, {
            recursive: true,
            force: true
          });
        }

        run(`
          INSERT INTO audit_logs (
            user_id, action, details, ip_address
          ) VALUES (?, 'BACKUP_RESTORE_REQUESTED', ?, ?)
        `, [req.session.user.id, `Fichier=${fileName}`, req.ip]);

        return res.json({
          ok: true,
          message:
            'Restauration effectuée. Redémarrez immédiatement Abyss Nexus avec Ctrl+C puis npm start.'
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          message: `Restauration impossible : ${error.message}`
        });
      } finally {
        fs.rmSync(restoreDir, { recursive: true, force: true });
      }
    }
  );
}

module.exports = { registerBackupRoutes };
