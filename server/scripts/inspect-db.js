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
  for (const t of ['active_match','matches','tournaments','teams','players','tournament_teams','tournament_players','innings','deliveries','player_stats','team_stats','match_balls','tournament_standings']) {
    try {
      const r = await pool.query('SELECT COUNT(*) FROM ' + t);
      console.log('  -', t + ':', r.rows[0].count, 'rows');
    } catch(e) { console.log('  -', t + ': N/A'); }
  }

  const legacyPoints = await pool.query(`SELECT to_regclass('public.points_table_view') AS name`);
  if (legacyPoints.rows[0].name) {
    const pts = await pool.query('SELECT * FROM points_table_view');
    console.log('\n=== LEGACY POINTS TABLE CURRENT DATA ===');
    console.log(JSON.stringify(pts.rows, null, 2));
  } else {
    console.log('\n=== POINTS TABLE ===');
    console.log('  Legacy points_table_view is not installed; use tournament_standings during the transition.');
  }

  await pool.end();
}
inspect().catch(e => { console.error('ERROR:', e.message); pool.end(); });
