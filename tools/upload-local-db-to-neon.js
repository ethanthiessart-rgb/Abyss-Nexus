'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const databaseFile = path.join(
  __dirname,
  '..',
  'database',
  'abyss-nexus.sqlite'
);

const SNAPSHOT_TABLE = 'abyss_nexus_sqlite_snapshot_v2';

async function ensureSnapshotTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (
      id INTEGER PRIMARY KEY,
      sqlite_blob BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL absente. Définis-la temporairement dans PowerShell avant de lancer ce script.'
    );
  }

  if (!fs.existsSync(databaseFile)) {
    throw new Error(`Base locale introuvable : ${databaseFile}`);
  }

  const buffer = fs.readFileSync(databaseFile);

  if (!buffer.length) {
    throw new Error('La base locale est vide, import annulé.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });

  try {
    await ensureSnapshotTable(pool);

    // IMPORTANT :
    // On utilise une nouvelle table V2 pour ne supprimer/modifier aucune
    // ancienne table Neon incompatible.
    await pool.query(
      `INSERT INTO ${SNAPSHOT_TABLE} (id, sqlite_blob, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         sqlite_blob = EXCLUDED.sqlite_blob,
         updated_at = NOW()`,
      [buffer]
    );

    const verify = await pool.query(
      `SELECT octet_length(sqlite_blob) AS size_bytes, updated_at
       FROM ${SNAPSHOT_TABLE}
       WHERE id = 1`
    );

    const row = verify.rows[0];

    if (!row || Number(row.size_bytes) !== buffer.length) {
      throw new Error(
        `Vérification échouée : local=${buffer.length}, Neon=${row?.size_bytes ?? 'absent'}`
      );
    }

    console.log('✅ Table Neon V2 prête.');
    console.log('✅ Base locale Abyss Nexus envoyée dans Neon.');
    console.log(`✅ Taille vérifiée : ${row.size_bytes} octets.`);
    console.log(`✅ Sauvegarde Neon : ${row.updated_at}`);
    console.log('✅ Aucune ancienne table Neon n’a été supprimée.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Import Neon impossible :', error.message);
  process.exit(1);
});
