require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function inspect() {
  const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  console.log('=== TABLES ===');
  tables.rows.forEach(r => console.log('  -', r.tablename));

  const views = await pool.query(`SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname`);
  console.log('=== VIEWS ===');
  views.rows.forEach(r => console.log('  -', r.viewname));

  const funcs = await pool.query(`SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' ORDER BY routine_name`);
  console.log('=== STORED FUNCTIONS ===');
  funcs.rows.forEach(r => console.log('  -', r.routine_name));

  console.log('\n=== ROW COUNTS ===');
  for (const t of ['active_match','matches','player_stats','team_stats','match_balls','points_table']) {
    try {
      const r = await pool.query('SELECT COUNT(*) FROM ' + t);
      console.log('  -', t + ':', r.rows[0].count, 'rows');
    } catch(e) { console.log('  -', t + ': N/A'); }
  }

  const pts = await pool.query('SELECT * FROM points_table_view');
  console.log('\n=== POINTS TABLE CURRENT DATA ===');
  console.log(JSON.stringify(pts.rows, null, 2));

  // Show points_table column structure
  const cols = await pool.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'points_table' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  console.log('\n=== POINTS TABLE COLUMNS ===');
  cols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (default: ${r.column_default})`));

  await pool.end();
}
inspect().catch(e => { console.error('ERROR:', e.message); pool.end(); });
