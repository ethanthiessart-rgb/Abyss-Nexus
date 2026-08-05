'use strict';

const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DATABASE_DIR = path.join(__dirname, '..', 'database');
const DATABASE_FILE = path.join(DATABASE_DIR, 'abyss-nexus.sqlite');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const SNAPSHOT_TABLE = 'abyss_nexus_sqlite_snapshot';

let dbPromise;
let database;
let pool;
let saveTimer = null;
let saveChain = Promise.resolve();
let shuttingDown = false;

function isNeonEnabled() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

function createPool() {
  if (!isNeonEnabled()) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000
  });

  pool.on('error', (error) => {
    console.error('Erreur inattendue de connexion Neon :', error);
  });

  return pool;
}

async function initializeSnapshotStorage() {
  const client = createPool();
  if (!client) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      sqlite_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadRemoteSnapshot() {
  if (!isNeonEnabled()) return null;

  await initializeSnapshotStorage();
  const result = await pool.query(
    `SELECT sqlite_data FROM ${SNAPSHOT_TABLE} WHERE id = 1`
  );

  if (!result.rows.length || !result.rows[0].sqlite_data) return null;
  return Buffer.from(result.rows[0].sqlite_data);
}

function exportDatabase() {
  if (!database) return null;
  return Buffer.from(database.export());
}

function persistLocalSnapshot(buffer = exportDatabase()) {
  if (!buffer) return;
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  fs.writeFileSync(DATABASE_FILE, buffer);
}

async function saveRemoteSnapshot(buffer) {
  if (!isNeonEnabled() || !buffer) return;

  await initializeSnapshotStorage();
  await pool.query(
    `INSERT INTO ${SNAPSHOT_TABLE} (id, sqlite_data, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET
       sqlite_data = EXCLUDED.sqlite_data,
       updated_at = NOW()`,
    [buffer]
  );
}

function queueRemoteSave(delayMs = 150) {
  if (!isNeonEnabled() || shuttingDown) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const buffer = exportDatabase();

    saveChain = saveChain
      .then(() => saveRemoteSnapshot(buffer))
      .catch((error) => {
        console.error('Impossible de sauvegarder la base dans Neon :', error);
      });
  }, delayMs);
}

function persistDatabase() {
  const buffer = exportDatabase();
  if (!buffer) return;
  persistLocalSnapshot(buffer);
  queueRemoteSave();
}

async function flushDatabase() {
  if (!database) return;

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const buffer = exportDatabase();
  persistLocalSnapshot(buffer);

  if (isNeonEnabled()) {
    saveChain = saveChain.then(() => saveRemoteSnapshot(buffer));
    await saveChain;
  }
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

function applySchema() {
  if (!fs.existsSync(SCHEMA_FILE)) {
    throw new Error(`Schéma SQL introuvable : ${SCHEMA_FILE}`);
  }

  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  database.run(schema);

  database.run(`
    INSERT OR IGNORE INTO maintenance_settings (
      id, mode, message, return_unknown, return_at
    ) VALUES (1, 'operational', '', 0, NULL);

    INSERT OR IGNORE INTO global_settings (
      id, settings_json
    ) VALUES (1, '{}');
  `);
}

async function createInitialDirectionAccount() {
  const existing = one(
    `SELECT id FROM users
     WHERE account_type = 'direction'
     ORDER BY id ASC
     LIMIT 1`
  );
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

    let initialBuffer = null;

    if (isNeonEnabled()) {
      try {
        initialBuffer = await loadRemoteSnapshot();
        if (initialBuffer) {
          console.log('Base Abyss Nexus chargée depuis Neon.');
        }
      } catch (error) {
        console.error('Impossible de charger la base depuis Neon :', error);
        throw error;
      }
    }

    if (!initialBuffer && fs.existsSync(DATABASE_FILE)) {
      initialBuffer = fs.readFileSync(DATABASE_FILE);
      console.log('Base Abyss Nexus chargée depuis le disque local.');
    }

    database = initialBuffer
      ? new SQL.Database(initialBuffer)
      : new SQL.Database();

    applySchema();
    await createInitialDirectionAccount();
    await flushDatabase();

    console.log(
      isNeonEnabled()
        ? 'Persistance Neon activée pour Abyss Nexus.'
        : 'Mode SQLite local activé (DATABASE_URL absente).'
    );

    return { one, all, run, flushDatabase };
  })();

  return dbPromise;
}

async function closeDatabase() {
  shuttingDown = true;
  await flushDatabase();
  if (pool) await pool.end();
}

module.exports = {
  initializeDatabase,
  flushDatabase,
  closeDatabase,
  getDatabaseHelpers() {
    if (!database) {
      throw new Error('La base de données n’est pas initialisée.');
    }
    return { one, all, run };
  }
};
