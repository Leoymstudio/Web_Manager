// server.js - minimal local API for bookmarks manager
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'db.sqlite3');
const db = new Database(DB_PATH);

// 初始化表
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT,
  parentId TEXT,
  "order" INTEGER,
  expanded INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  description TEXT,
  favicon TEXT,
  category TEXT,
  tags TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  visitCount INTEGER DEFAULT 0
);
`);

const run = (sql, params=[]) => db.prepare(sql).run(params);
const all = (sql, params=[]) => db.prepare(sql).all(params);
const get = (sql, params=[]) => db.prepare(sql).get(params);

// 快照 API
app.get('/api/snapshot', (req, res) => {
  try {
    const categories = all('SELECT * FROM categories ORDER BY "order" ASC');
    const bookmarks = all('SELECT * FROM bookmarks ORDER BY createdAt DESC');
    const parsed = bookmarks.map(b => ({ ...b, tags: b.tags ? JSON.parse(b.tags) : [] }));
    res.json({ categories, bookmarks: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/snapshot', (req, res) => {
  const { categories = [], bookmarks = [] } = req.body;
  const tx = db.transaction(() => {
    run('DELETE FROM categories');
    run('DELETE FROM bookmarks');
    const catStmt = db.prepare('INSERT INTO categories(id,name,parentId,"order",expanded) VALUES (@id,@name,@parentId,@order,@expanded)');
    const bmStmt = db.prepare('INSERT INTO bookmarks(id,title,url,description,favicon,category,tags,createdAt,updatedAt,visitCount) VALUES (@id,@title,@url,@description,@favicon,@category,@tags,@createdAt,@updatedAt,@visitCount)');
    categories.forEach(c => catStmt.run({
      id: c.id, name: c.name, parentId: c.parentId || null, order: c.order || 0, expanded: c.expanded ? 1 : 0
    }));
    bookmarks.forEach(b => bmStmt.run({
      id: b.id, title: b.title, url: b.url, description: b.description || '', favicon: b.favicon || '',
      category: b.category || '', tags: JSON.stringify(b.tags || []), createdAt: b.createdAt || new Date().toISOString(),
      updatedAt: b.updatedAt || new Date().toISOString(), visitCount: b.visitCount || 0
    }));
  });
  try {
    tx();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bookmarks CRUD
app.get('/api/bookmarks', (req, res) => {
  const rows = all('SELECT * FROM bookmarks ORDER BY createdAt DESC').map(b => ({ ...b, tags: b.tags ? JSON.parse(b.tags) : [] }));
  res.json(rows);
});
app.post('/api/bookmarks', (req, res) => {
  const b = req.body;
  try {
    run(`INSERT INTO bookmarks(id,title,url,description,favicon,category,tags,createdAt,updatedAt,visitCount)
      VALUES (@id,@title,@url,@description,@favicon,@category,@tags,@createdAt,@updatedAt,@visitCount)`, {
      id: b.id, title: b.title, url: b.url, description: b.description || '', favicon: b.favicon || '',
      category: b.category || '', tags: JSON.stringify(b.tags || []), createdAt: b.createdAt || new Date().toISOString(),
      updatedAt: b.updatedAt || new Date().toISOString(), visitCount: b.visitCount || 0
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/bookmarks/:id', (req, res) => {
  const id = req.params.id;
  const b = req.body;
  try {
    run(`UPDATE bookmarks SET title=@title,url=@url,description=@description,favicon=@favicon,category=@category,tags=@tags,updatedAt=@updatedAt,visitCount=@visitCount WHERE id=@id`, {
      id, title: b.title, url: b.url, description: b.description || '', favicon: b.favicon || '', category: b.category || '',
      tags: JSON.stringify(b.tags || []), updatedAt: new Date().toISOString(), visitCount: b.visitCount || 0
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/bookmarks/:id', (req, res) => {
  try {
    run('DELETE FROM bookmarks WHERE id=@id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categories: GET/POST/PUT/DELETE (基本支持)
app.get('/api/categories', (req, res) => {
  res.json(all('SELECT * FROM categories ORDER BY "order" ASC'));
});
app.post('/api/categories', (req, res) => {
  const c = req.body;
  try {
    run('INSERT OR IGNORE INTO categories(id,name,parentId,"order",expanded) VALUES (@id,@name,@parentId,@order,@expanded)', {
      id: c.id, name: c.name, parentId: c.parentId || null, order: c.order || 0, expanded: c.expanded ? 1 : 0
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/categories/:id', (req, res) => {
  const id = req.params.id; const c = req.body;
  try {
    run('UPDATE categories SET name=@name,parentId=@parentId,"order"=@order,expanded=@expanded WHERE id=@id', {
      id, name: c.name, parentId: c.parentId || null, order: c.order || 0, expanded: c.expanded ? 1 : 0
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/categories/:id', (req, res) => {
  try { run('DELETE FROM categories WHERE id=@id', { id: req.params.id }); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// 合并导入接口：用于迁移 localStorage
app.post('/api/import', (req, res) => {
  const { categories = [], bookmarks = [] } = req.body;
  const tx = db.transaction(() => {
    const catStmt = db.prepare('INSERT OR IGNORE INTO categories(id,name,parentId,"order",expanded) VALUES (@id,@name,@parentId,@order,@expanded)');
    const bmStmt = db.prepare('INSERT OR IGNORE INTO bookmarks(id,title,url,description,favicon,category,tags,createdAt,updatedAt,visitCount) VALUES (@id,@title,@url,@description,@favicon,@category,@tags,@createdAt,@updatedAt,@visitCount)');
    categories.forEach(c => catStmt.run({ id: c.id, name: c.name, parentId: c.parentId || null, order: c.order || 0, expanded: c.expanded ? 1 : 0 }));
    bookmarks.forEach(b => bmStmt.run({ id: b.id, title: b.title, url: b.url, description: b.description || '', favicon: b.favicon || '', category: b.category || '', tags: JSON.stringify(b.tags || []), createdAt: b.createdAt || new Date().toISOString(), updatedAt: b.updatedAt || new Date().toISOString(), visitCount: b.visitCount || 0 }));
  });
  try { tx(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

const port = process.env.PORT || 3000;
const srv = app.listen(port, () => console.log(`Bookmarks API listening on http://localhost:${port}`));

// handle low-level client errors (e.g. aborted requests)
srv.on('clientError', (err, socket) => {
  console.warn('HTTP clientError', err && err.message);
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
});

// prevent process from exiting on unexpected errors triggered by aborted requests
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});
