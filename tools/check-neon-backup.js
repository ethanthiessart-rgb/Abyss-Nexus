'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const SNAPSHOT_TABLE = 'abyss_nexus_sqlite_snapshot_v2';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL absente.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });

  try {
    const table = await pool.query(
      `SELECT to_regclass($1) AS table_name`,
      [`public.${SNAPSHOT_TABLE}`]
    );

    if (!table.rows[0]?.table_name) {
      console.log('❌ La table de sauvegarde Neon V2 n’existe pas encore.');
      console.log('Lance d’abord : node tools\\upload-local-db-to-neon.js');
      process.exitCode = 2;
      return;
    }

    const result = await pool.query(`
      SELECT
        id,
        octet_length(sqlite_blob) AS size_bytes,
        updated_at
      FROM ${SNAPSHOT_TABLE}
      WHERE id = 1
    `);

    if (!result.rows.length) {
      console.log('❌ La table V2 existe, mais aucune sauvegarde n’y est enregistrée.');
      process.exitCode = 2;
      return;
    }

    const row = result.rows[0];
    console.log('✅ Sauvegarde Neon V2 trouvée.');
    console.log(`✅ Taille : ${row.size_bytes} octets`);
    console.log(`✅ Dernière sauvegarde : ${row.updated_at}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Vérification impossible :', error.message);
  process.exit(1);
});
