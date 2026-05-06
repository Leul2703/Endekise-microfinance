const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = path.join(__dirname, 'backend', process.env.DB_PATH || 'database.sqlite');
if (!fs.existsSync(dbPath)) {
  console.error('Database not found at', dbPath);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

const q = `SELECT id, client_id, type, file_name, uploaded_at FROM documents WHERE (
  lower(type) LIKE '%organization%'
  OR lower(type) LIKE '%org%'
  OR lower(file_name) LIKE '%organization%'
  OR lower(file_name) LIKE '%org%'
  OR lower(type) LIKE '%letter%'
  OR lower(file_name) LIKE '%letter%'
) ORDER BY uploaded_at DESC`;

db.all(q, [], (err, rows) => {
  if (err) {
    console.error('Query error:', err.message || err);
    process.exit(2);
  }

  if (!rows || rows.length === 0) {
    console.log('No organization/letter-like documents found in the database.');
    process.exit(0);
  }

  console.log(`Found ${rows.length} matching documents:`);
  for (const r of rows) {
    console.log(`- id=${r.id} client_id=${r.client_id} type=${r.type} file_name=${r.file_name} uploaded_at=${r.uploaded_at}`);
  }
  process.exit(0);
});
