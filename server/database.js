'use strict';

const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DATABASE_DIR = path.join(__dirname, '..', 'database');
const DATABASE_FILE = path.join(DATABASE_DIR, 'abyss-nexus.sqlite');

let dbPromise;
let database;
let neonPool = null;
let pendingNeonSnapshot = null;
let neonFlushRunning = false;
let databaseDirty = false;
let autoPersistenceTimer = null;
let shutdownHookInstalled = false;

function neonEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

async function initializeNeonSnapshotStore() {
  if (!neonEnabled()) return null;

  neonPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2
  });

  await neonPool.query(`
    CREATE TABLE IF NOT EXISTS abyss_nexus_sqlite_snapshot_v2 (
      id INTEGER PRIMARY KEY,
      sqlite_blob BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('Stockage persistant Neon V2 prêt.');

  return neonPool;
}

async function loadSnapshotFromNeon() {
  if (!neonPool) return null;

  const result = await neonPool.query(
    'SELECT sqlite_blob, updated_at FROM abyss_nexus_sqlite_snapshot_v2 WHERE id = 1'
  );

  if (!result.rows.length || !result.rows[0].sqlite_blob) return null;

  return {
    buffer: Buffer.from(result.rows[0].sqlite_blob),
    updatedAt: result.rows[0].updated_at
      ? new Date(result.rows[0].updated_at)
      : null
  };
}

async function writeSnapshotToNeon(buffer) {
  if (!neonPool || !buffer) return;

  await neonPool.query(
    `INSERT INTO abyss_nexus_sqlite_snapshot_v2 (id, sqlite_blob, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id)
     DO UPDATE SET sqlite_blob = EXCLUDED.sqlite_blob, updated_at = NOW()`,
    [buffer]
  );
}

function queueNeonSnapshot(buffer) {
  if (!neonPool || !buffer) return;

  pendingNeonSnapshot = Buffer.from(buffer);

  if (neonFlushRunning) return;
  neonFlushRunning = true;

  (async () => {
    try {
      while (pendingNeonSnapshot) {
        const snapshot = pendingNeonSnapshot;
        pendingNeonSnapshot = null;
        await writeSnapshotToNeon(snapshot);
      }
    } catch (error) {
      console.error('Impossible de sauvegarder la base Abyss Nexus dans Neon :', error);
    } finally {
      neonFlushRunning = false;
      if (pendingNeonSnapshot) queueNeonSnapshot(pendingNeonSnapshot);
    }
  })();
}

function persistDatabase() {
  if (!database) return;

  const snapshot = Buffer.from(database.export());

  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  fs.writeFileSync(DATABASE_FILE, snapshot);

  databaseDirty = true;

  // Envoi immédiat en arrière-plan + filet de sécurité périodique.
  queueNeonSnapshot(snapshot);
}

async function persistDatabaseNow() {
  if (!database) return;

  const snapshot = Buffer.from(database.export());

  fs.mkdirSync(DATABASE_DIR, { recursive: true });
  fs.writeFileSync(DATABASE_FILE, snapshot);

  if (neonPool) {
    await writeSnapshotToNeon(snapshot);
  }

  databaseDirty = false;
}

function installPersistenceSafetyNet() {
  if (autoPersistenceTimer) return;

  // Toutes les 2 secondes, on confirme la dernière version dans Neon.
  autoPersistenceTimer = setInterval(() => {
    if (!databaseDirty || !database || !neonPool) return;

    persistDatabaseNow().catch((error) => {
      console.error('Sauvegarde périodique Neon impossible :', error);
    });
  }, 2000);

  autoPersistenceTimer.unref?.();

  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;

  const flushAndExit = async (signal) => {
    try {
      if (database && neonPool) {
        await persistDatabaseNow();
        console.log(`Dernière sauvegarde Neon confirmée avant ${signal}.`);
      }
    } catch (error) {
      console.error(`Échec sauvegarde finale Neon avant ${signal} :`, error);
    } finally {
      try {
        await neonPool?.end();
      } catch {}
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => flushAndExit('SIGTERM'));
  process.once('SIGINT', () => flushAndExit('SIGINT'));
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

    let initialBuffer = null;

    if (neonEnabled()) {
      try {
        await initializeNeonSnapshotStore();
        const neonSnapshot = await loadSnapshotFromNeon();

        if (neonSnapshot?.buffer) {
          const localExists = fs.existsSync(DATABASE_FILE);
          const localModifiedAt = localExists
            ? fs.statSync(DATABASE_FILE).mtime
            : null;

          // Sur le PC, on évite qu'une vieille sauvegarde Neon écrase une base
          // locale plus récente. Sur Render, le fichier local n'existe normalement
          // pas au démarrage, donc Neon reste la source durable.
          const localIsNewer =
            localModifiedAt &&
            neonSnapshot.updatedAt &&
            localModifiedAt > neonSnapshot.updatedAt;

          if (!localIsNewer) {
            initialBuffer = neonSnapshot.buffer;
            console.log('Base Abyss Nexus restaurée depuis Neon.');
          } else {
            console.log(
              'Base locale plus récente que Neon : conservation de la version locale.'
            );
          }
        }
      } catch (error) {
        console.error(
          'Neon indisponible au démarrage, utilisation du stockage local :',
          error
        );
      }
    }

    if (!initialBuffer && fs.existsSync(DATABASE_FILE)) {
      initialBuffer = fs.readFileSync(DATABASE_FILE);
    }

    database = initialBuffer
      ? new SQL.Database(initialBuffer)
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


      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        theme TEXT NOT NULL DEFAULT 'abyss-blue',
        animations_enabled INTEGER NOT NULL DEFAULT 1,
        sounds_enabled INTEGER NOT NULL DEFAULT 0,
        glow_enabled INTEGER NOT NULL DEFAULT 1,
        desktop_notifications_enabled INTEGER NOT NULL DEFAULT 0,
        auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications(user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
        ON notifications(user_id, read_at);

      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#238fd3',
        icon TEXT NOT NULL DEFAULT '🏢',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS maintenance_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        mode TEXT NOT NULL DEFAULT 'operational',
        message TEXT NOT NULL DEFAULT '',
        return_unknown INTEGER NOT NULL DEFAULT 0,
        return_at TEXT,
        updated_by_user_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS maintenance_allowed_departments (
        department TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS global_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_by_user_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS global_settings_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        changed_by_user_id INTEGER,
        old_settings_json TEXT NOT NULL DEFAULT '{}',
        new_settings_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(changed_by_user_id) REFERENCES users(id)
      );

      INSERT OR IGNORE INTO maintenance_settings (
        id, mode, message, return_unknown, return_at
      ) VALUES (
        1, 'operational', '', 0, NULL
      );

      INSERT OR IGNORE INTO global_settings (
        id, settings_json
      ) VALUES (
        1, '{}'
      );

      INSERT OR IGNORE INTO departments (name, color, icon, active)
      VALUES
        ('Administration', '#238fd3', '🏢', 1),
        ('Administration Supérieure', '#8b5cf6', '🏛️', 1),
        ('Animateur', '#f59e0b', '🎉', 1),
        ('Assistant', '#14b8a6', '🤝', 1),
        ('Builder', '#84cc16', '🧱', 1),
        ('Direction Modération', '#ef4444', '👑', 1),
        ('Développeur', '#6366f1', '💻', 1),
        ('Modération', '#f97316', '🛡️', 1),
        ('Morpheur', '#ec4899', '🎭', 1),
        ('Scripter', '#06b6d4', '📜', 1),
        ('Équipe de Direction', '#dc2626', '👑', 1);
    `);


    // Normalisation des matricules personnels :
    // - les comptes archivés libèrent les numéros ABY-xxxxxx
    // - les comptes actifs hors Direction repartent de ABY-000001
    try {
      const standardActiveUsers = all(`
        SELECT id, matricule
        FROM users
        WHERE status != 'archived'
          AND account_type != 'direction'
        ORDER BY id ASC
      `);

      const archivedStandardUsers = all(`
        SELECT id, matricule
        FROM users
        WHERE status = 'archived'
          AND matricule GLOB 'ABY-[0-9][0-9][0-9][0-9][0-9][0-9]'
        ORDER BY id ASC
      `);

      for (const user of archivedStandardUsers) {
        database.run(
          'UPDATE users SET matricule = ? WHERE id = ?',
          [`ABY-ARCH-${String(user.id).padStart(6, '0')}`, user.id]
        );
      }

      for (const user of standardActiveUsers) {
        database.run(
          'UPDATE users SET matricule = ? WHERE id = ?',
          [`TMP-ABY-${user.id}`, user.id]
        );
      }

      let matriculeNumber = 1;
      for (const user of standardActiveUsers) {
        database.run(
          'UPDATE users SET matricule = ? WHERE id = ?',
          [`ABY-${String(matriculeNumber).padStart(6, '0')}`, user.id]
        );
        matriculeNumber += 1;
      }

      if (standardActiveUsers.length || archivedStandardUsers.length) {
        console.log(
          `Matricules normalisés : ${standardActiveUsers.length} actif(s), ${archivedStandardUsers.length} archivé(s).`
        );
      }
    } catch (error) {
      console.error('Impossible de normaliser les matricules :', error);
    }

    // Migration légère : ajoute le code d'alerte global aux anciennes bases.
    const maintenanceColumns = all('PRAGMA table_info(maintenance_settings)');
    if (!maintenanceColumns.some((column) => column.name === 'alert_code')) {
      database.run("ALTER TABLE maintenance_settings ADD COLUMN alert_code TEXT NOT NULL DEFAULT 'green'");
    }

    persistDatabase();
    await createInitialDirectionAccount();

    // Après les migrations / compte initial, on force une copie durable.
    persistDatabase();

    if (neonPool) {
      try {
        await writeSnapshotToNeon(Buffer.from(database.export()));
        console.log('Persistance Neon active pour Abyss Nexus.');
        installPersistenceSafetyNet();
      } catch (error) {
        console.error('Impossible de finaliser la sauvegarde Neon :', error);
      }
    }

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
    return { one, all, run, persistDatabaseNow };
  }
};
