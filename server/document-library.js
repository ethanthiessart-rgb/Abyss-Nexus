'use strict';

const { getDatabaseHelpers } = require('./database');

function requireSession(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      ok: false,
      message: 'Session expirée.'
    });
  }
  next();
}

function canManage(req) {
  const permissions = req.session.user.permissions || [];

  return (
    req.session.user.accountType === 'direction' ||
    permissions.includes('documents.manage') ||
    permissions.includes('maintenance.manage')
  );
}

function clean(value) {
  return String(value ?? '').trim();
}

function userCanReadDocument(document, user) {
  if (document.visibility === 'public') return true;
  if (user.accountType === 'direction') return true;

  if (document.visibility === 'department') {
    return document.department === user.department;
  }

  return document.created_by_user_id === user.id;
}

function registerDocumentLibraryRoutes(app) {
  app.get('/api/document-library/folders', requireSession, (req, res) => {
    const { all } = getDatabaseHelpers();

    const rows = all(`
      SELECT id, name, department, description, created_at
      FROM document_folders
      ORDER BY name COLLATE NOCASE
    `);

    res.json({
      ok: true,
      canManage: canManage(req),
      folders: rows.filter((folder) =>
        !folder.department ||
        folder.department === req.session.user.department ||
        req.session.user.accountType === 'direction'
      )
    });
  });

  app.post('/api/document-library/folders', requireSession, (req, res) => {
    if (!canManage(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Permission insuffisante.'
      });
    }

    const name = clean(req.body.name);
    const department = clean(req.body.department);
    const description = clean(req.body.description);

    if (name.length < 2) {
      return res.status(400).json({
        ok: false,
        message: 'Nom du dossier trop court.'
      });
    }

    const { run } = getDatabaseHelpers();

    run(`
      INSERT INTO document_folders (
        name, department, description, created_by_user_id
      ) VALUES (?, ?, ?, ?)
    `, [
      name,
      department || null,
      description || null,
      req.session.user.id
    ]);

    res.status(201).json({
      ok: true,
      message: 'Dossier créé.'
    });
  });

  app.get('/api/document-library/documents', requireSession, (req, res) => {
    const folderId = req.query.folderId
      ? Number(req.query.folderId)
      : null;
    const search = clean(req.query.search);
    const { all } = getDatabaseHelpers();

    const clauses = [];
    const params = [];

    if (folderId) {
      clauses.push('d.folder_id = ?');
      params.push(folderId);
    }

    if (search) {
      clauses.push('(d.title LIKE ? OR d.summary LIKE ? OR d.tags LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const rows = all(`
      SELECT d.id, d.folder_id, d.title, d.summary, d.tags,
             d.visibility, d.department, d.current_version,
             d.created_by_user_id, d.created_at, d.updated_at,
             f.name AS folder_name,
             u.discord_username AS author_name
      FROM library_documents d
      LEFT JOIN document_folders f ON f.id = d.folder_id
      LEFT JOIN users u ON u.id = d.created_by_user_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY d.updated_at DESC
      LIMIT 500
    `, params);

    res.json({
      ok: true,
      canManage: canManage(req),
      documents: rows.filter((document) =>
        userCanReadDocument(document, req.session.user)
      ).map((document) => ({
        id: document.id,
        folderId: document.folder_id,
        folderName: document.folder_name,
        title: document.title,
        summary: document.summary,
        tags: document.tags
          ? document.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [],
        visibility: document.visibility,
        department: document.department,
        currentVersion: Number(document.current_version || 1),
        authorName: document.author_name || 'Système',
        createdAt: document.created_at,
        updatedAt: document.updated_at
      }))
    });
  });

  app.get('/api/document-library/documents/:id', requireSession, (req, res) => {
    const id = Number(req.params.id);
    const { one, all } = getDatabaseHelpers();

    const document = one(`
      SELECT d.*, f.name AS folder_name,
             u.discord_username AS author_name
      FROM library_documents d
      LEFT JOIN document_folders f ON f.id = d.folder_id
      LEFT JOIN users u ON u.id = d.created_by_user_id
      WHERE d.id = ?
    `, [id]);

    if (!document || !userCanReadDocument(document, req.session.user)) {
      return res.status(404).json({
        ok: false,
        message: 'Document introuvable.'
      });
    }

    const versions = all(`
      SELECT v.id, v.version_number, v.content,
             v.change_note, v.created_at,
             u.discord_username AS author_name
      FROM library_document_versions v
      LEFT JOIN users u ON u.id = v.created_by_user_id
      WHERE v.document_id = ?
      ORDER BY v.version_number DESC
    `, [id]);

    res.json({
      ok: true,
      canManage: canManage(req),
      document: {
        id: document.id,
        folderId: document.folder_id,
        folderName: document.folder_name,
        title: document.title,
        summary: document.summary,
        tags: document.tags
          ? document.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [],
        visibility: document.visibility,
        department: document.department,
        currentVersion: Number(document.current_version || 1),
        authorName: document.author_name || 'Système',
        createdAt: document.created_at,
        updatedAt: document.updated_at
      },
      versions: versions.map((version) => ({
        id: version.id,
        versionNumber: Number(version.version_number),
        content: version.content,
        changeNote: version.change_note,
        authorName: version.author_name || 'Système',
        createdAt: version.created_at
      }))
    });
  });

  app.post('/api/document-library/documents', requireSession, (req, res) => {
    if (!canManage(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Permission insuffisante.'
      });
    }

    const folderId = req.body.folderId
      ? Number(req.body.folderId)
      : null;
    const title = clean(req.body.title);
    const summary = clean(req.body.summary);
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map(String).map((tag) => tag.trim()).filter(Boolean)
      : [];
    const visibility = clean(req.body.visibility) || 'public';
    const department = clean(req.body.department);
    const content = clean(req.body.content);

    if (title.length < 3 || content.length < 3) {
      return res.status(400).json({
        ok: false,
        message: 'Titre ou contenu trop court.'
      });
    }

    if (!['public', 'department', 'private'].includes(visibility)) {
      return res.status(400).json({
        ok: false,
        message: 'Visibilité invalide.'
      });
    }

    const { one, run } = getDatabaseHelpers();

    run(`
      INSERT INTO library_documents (
        folder_id, title, summary, tags, visibility,
        department, current_version, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      folderId,
      title,
      summary || null,
      tags.join(','),
      visibility,
      department || null,
      req.session.user.id
    ]);

    const documentId = Number(
      one('SELECT MAX(id) AS id FROM library_documents')?.id
    );

    run(`
      INSERT INTO library_document_versions (
        document_id, version_number, content,
        change_note, created_by_user_id
      ) VALUES (?, 1, ?, 'Création du document', ?)
    `, [
      documentId,
      content,
      req.session.user.id
    ]);

    res.status(201).json({
      ok: true,
      message: 'Document créé.',
      documentId
    });
  });

  app.post(
    '/api/document-library/documents/:id/versions',
    requireSession,
    (req, res) => {
      if (!canManage(req)) {
        return res.status(403).json({
          ok: false,
          message: 'Permission insuffisante.'
        });
      }

      const id = Number(req.params.id);
      const content = clean(req.body.content);
      const changeNote = clean(req.body.changeNote);
      const { one, run } = getDatabaseHelpers();

      const document = one(`
        SELECT id, current_version
        FROM library_documents
        WHERE id = ?
      `, [id]);

      if (!document) {
        return res.status(404).json({
          ok: false,
          message: 'Document introuvable.'
        });
      }

      const nextVersion = Number(document.current_version || 0) + 1;

      run(`
        INSERT INTO library_document_versions (
          document_id, version_number, content,
          change_note, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        id,
        nextVersion,
        content,
        changeNote || null,
        req.session.user.id
      ]);

      run(`
        UPDATE library_documents
        SET current_version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [nextVersion, id]);

      res.status(201).json({
        ok: true,
        message: `Version ${nextVersion} créée.`
      });
    }
  );
}

module.exports = { registerDocumentLibraryRoutes };
