'use strict';

const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

const DATABASE_DIR = path.join(__dirname, '..', 'database');
const DATABASE_FILE = path.join(DATABASE_DIR, 'abyss-nexus.sqlite');

let dbPromise;
let database;

function persistDatabase() {
  if (!database) return;
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  fs.writeFileSync(DATABASE_FILE, Buffer.from(database.export()));
}

function one(sql, params = []) {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function all(sql, params = []) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function run(sql, params = []) {
  database.run(sql, params);
  persistDatabase();
}

async function createInitialDirectionAccount() {
  const existing = one('SELECT id FROM users LIMIT 1');
  if (existing) return;

  const matricule =
    process.env.INITIAL_DIRECTION_MATRICULE || 'ABY-DIR-0001';
  const identifier =
    process.env.INITIAL_DIRECTION_IDENTIFIER || 'direction';
  const password =
    process.env.INITIAL_DIRECTION_PASSWORD || 'Abyss@2026';

  const passwordHash = await bcrypt.hash(password, 12);

  run(
    `INSERT INTO users (
      discord_id, discord_username, avatar_url, matricule, identifier,
      password_hash, account_type, grade, department, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      null,
      'Direction Abyss',
      null,
      matricule.toUpperCase(),
      identifier.toLowerCase(),
      passwordHash,
      'direction',
      'Équipe de Direction',
      'Équipe de Direction',
      'active'
    ]
  );
}

async function initializeDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const SQL = await initSqlJs();
    fs.mkdirSync(DATABASE_DIR, { recursive: true });

    database = fs.existsSync(DATABASE_FILE)
      ? new SQL.Database(fs.readFileSync(DATABASE_FILE))
      : new SQL.Database();

    database.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE,
        discord_username TEXT NOT NULL,
        avatar_url TEXT,
        matricule TEXT NOT NULL UNIQUE,
        identifier TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('personnel', 'direction')),
        grade TEXT NOT NULL,
        department TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        permission_key TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, permission_key),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS staff_profiles (
        user_id INTEGER PRIMARY KEY,
        signature TEXT,
        force_password_change INTEGER NOT NULL DEFAULT 0,
        first_login_notification INTEGER NOT NULL DEFAULT 1,
        created_by_user_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS personnel_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(actor_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        image_url TEXT,
        global_visible INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'published',
        publish_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(author_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS announcement_departments (
        announcement_id INTEGER NOT NULL,
        department TEXT NOT NULL,
        PRIMARY KEY(announcement_id, department),
        FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uploader_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        folder TEXT NOT NULL DEFAULT 'Commun',
        version INTEGER NOT NULL DEFAULT 1,
        global_visible INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        FOREIGN KEY(uploader_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS document_departments (
        document_id INTEGER NOT NULL,
        department TEXT NOT NULL,
        PRIMARY KEY(document_id, department),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
    `);

    persistDatabase();
    await createInitialDirectionAccount();
    return { one, all, run };
  })();

  return dbPromise;
}

module.exports = {
  initializeDatabase,
  getDatabaseHelpers() {
    if (!database) {
      throw new Error('La base de données n’est pas initialisée.');
    }
    return { one, all, run };
  }
};
