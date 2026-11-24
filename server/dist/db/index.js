import Database from 'better-sqlite3';
export const db = new Database('wc3connector.db');
// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);
export const dbGetUserByUsername = (username) => {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
};
export const dbGetUserById = (id) => {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
};
export const dbCreateUser = (username, passwordHash) => {
    const stmt = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
    const info = stmt.run(username, passwordHash, Date.now());
    return {
        id: info.lastInsertRowid,
        username,
        password_hash: passwordHash,
        created_at: Date.now(),
    };
};
//# sourceMappingURL=index.js.map