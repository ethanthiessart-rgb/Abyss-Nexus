'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const { getDatabaseHelpers } = require('./database');
const { hasPermission } = require('./permissions');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'documents');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.mp4'
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(
      ALLOWED_EXTENSIONS.has(extension)
        ? null
        : new Error('Type de fichier non autorisé.'),
      ALLOWED_EXTENSIONS.has(extension)
    );
  }
});

function clean(value) {
  return String(value ?? '').trim();
}

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ ok: false, message: 'Session expirée.' });
  }
  next();
}

function canManage(req) {
  return req.session.user.accountType === 'direction' ||
    hasPermission(req, 'documents.manage');
}

function canSeeDocument(req, documentId) {
  const { one } = getDatabaseHelpers();
  if (canManage(req)) return true;

  const visible = one(
    `SELECT d.id
     FROM documents d
     LEFT JOIN document_departments dd ON dd.document_id = d.id
     WHERE d.id = ? AND d.archived_at IS NULL
       AND (d.global_visible = 1 OR dd.department = ?)
     LIMIT 1`,
    [documentId, req.session.user.department]
  );

  return Boolean(visible);
}

function registerDocumentRoutes(app) {
  app.get('/api/documents/meta', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const departments = all(
      `SELECT DISTINCT department FROM users ORDER BY department`
    ).map((row) => row.department);

    res.json({
      ok: true,
      departments,
      canManage: canManage(req),
      currentUser: req.session.user
    });
  });

  app.get('/api/documents', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();
    const rows = canManage(req)
      ? all(`
          SELECT d.*, u.discord_username AS uploader_name
          FROM documents d
          JOIN users u ON u.id = d.uploader_id
          WHERE d.archived_at IS NULL
          ORDER BY d.created_at DESC
        `)
      : all(`
          SELECT DISTINCT d.*, u.discord_username AS uploader_name
          FROM documents d
          JOIN users u ON u.id = d.uploader_id
          LEFT JOIN document_departments dd ON dd.document_id = d.id
          WHERE d.archived_at IS NULL
            AND (d.global_visible = 1 OR dd.department = ?)
          ORDER BY d.created_at DESC
        `, [req.session.user.department]);

    res.json({
      ok: true,
      documents: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        originalName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        folder: row.folder,
        version: row.version,
        globalVisible: Boolean(row.global_visible),
        createdAt: row.created_at,
        uploaderName: row.uploader_name
      }))
    });
  });

  app.post(
    '/api/documents',
    requireSession,
    upload.single('file'),
    (req, res) => {
      if (!canManage(req)) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ ok: false, message: 'Permission insuffisante.' });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, message: 'Fichier obligatoire.' });
      }

      const title = clean(req.body.title) || req.file.originalname;
      const description = clean(req.body.description) || null;
      const folder = clean(req.body.folder) || 'Commun';
      const globalVisible = req.body.globalVisible === 'true';
      let departments = [];

      try {
        departments = JSON.parse(req.body.departments || '[]');
      } catch {
        departments = [];
      }

      if (!globalVisible && departments.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          ok: false,
          message: 'Choisissez au moins un département ou activez la visibilité globale.'
        });
      }

      const { one, all, run } = getDatabaseHelpers();
      run(
        `INSERT INTO documents (
          uploader_id, original_name, stored_name, mime_type, size_bytes,
          title, description, folder, version, global_visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          req.session.user.id,
          req.file.originalname,
          req.file.filename,
          req.file.mimetype,
          req.file.size,
          title,
          description,
          folder,
          globalVisible ? 1 : 0
        ]
      );

      const created = one('SELECT MAX(id) AS id FROM documents');
      const documentId = Number(created.id);

      for (const department of departments) {
        run(
          `INSERT OR IGNORE INTO document_departments
           (document_id, department) VALUES (?, ?)`,
          [documentId, clean(department)]
        );
      }

      const recipients = globalVisible
        ? all(`SELECT id FROM users WHERE status = 'active'`)
        : all(
            `SELECT id FROM users
             WHERE status = 'active'
               AND department IN (${departments.map(() => '?').join(',')})`,
            departments
          );

      for (const recipient of recipients) {
        if (recipient.id === req.session.user.id) continue;
        run(
          `INSERT INTO notifications
           (user_id, type, title, message, link)
           VALUES (?, 'document', 'Nouveau document', ?, '/documents')`,
          [recipient.id, title]
        );
      }

      run(
        `INSERT INTO audit_logs (user_id, action, details, ip_address)
         VALUES (?, 'DOCUMENT_UPLOAD', ?, ?)`,
        [req.session.user.id, `Document=${documentId}; Nom=${title}`, req.ip]
      );

      res.status(201).json({ ok: true, message: 'Document importé.' });
    }
  );

  app.get('/api/documents/:id/download', requireSession, (req, res) => {
    const id = Number(req.params.id);
    if (!canSeeDocument(req, id)) {
      return res.status(403).json({ ok: false, message: 'Accès refusé.' });
    }

    const { one } = getDatabaseHelpers();
    const document = one(
      `SELECT original_name, stored_name FROM documents WHERE id = ?`,
      [id]
    );

    if (!document) {
      return res.status(404).json({ ok: false, message: 'Document introuvable.' });
    }

    const filePath = path.join(UPLOAD_DIR, document.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, message: 'Fichier manquant.' });
    }

    res.download(filePath, document.original_name);
  });

  app.post('/api/documents/:id/archive', requireSession, (req, res) => {
    if (!canManage(req)) {
      return res.status(403).json({ ok: false, message: 'Permission insuffisante.' });
    }

    const id = Number(req.params.id);
    const { one, run } = getDatabaseHelpers();
    if (!one('SELECT id FROM documents WHERE id = ?', [id])) {
      return res.status(404).json({ ok: false, message: 'Document introuvable.' });
    }

    run(
      `UPDATE documents SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    res.json({ ok: true, message: 'Document archivé.' });
  });
}

module.exports = { registerDocumentRoutes };
