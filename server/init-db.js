/**
 * init-db.js — Run once to create cricket_db and apply schema.sql
 * Usage: node init-db.js
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function init() {
  // ── Step 1: Create the database if it doesn't exist ─────────────────────
  const admin = new Client({
    host    : process.env.DB_HOST     || 'localhost',
    port    : parseInt(process.env.DB_PORT) || 5432,
    database: 'postgres',
    user    : process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  await admin.connect();

  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'cricket_db'`);
  if (exists.rows.length === 0) {
    await admin.query('CREATE DATABASE cricket_db');
    console.log('✅ Created database: cricket_db');
  } else {
    console.log('ℹ️  Database cricket_db already exists');
  }
  await admin.end();

  // ── Step 2: Connect to cricket_db and apply schema.sql ───────────────────
  const db = new Client({
    host    : process.env.DB_HOST     || 'localhost',
    port    : parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'cricket_db',
    user    : process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  await db.connect();
  console.log('✅ Connected to cricket_db');

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('✅ Schema applied (tables, stored functions, views)');

  await db.end();
  console.log('🎉 Database ready. Run: node server.js');
}

init().catch(err => {
  console.error('❌ Init failed:', err.message);
  process.exit(1);
});
