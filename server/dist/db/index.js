import Database from 'better-sqlite3';
export const db = new Database('wc3connector.db');
// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_ip TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

  CREATE TABLE IF NOT EXISTS pending_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    ip TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,              -- 'register' | 'reset'
    identifier TEXT NOT NULL,        -- username (register) | email (reset)
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_codes_lookup ON verification_codes(type, identifier);
`);
// ── Migrations (for existing DBs from before email verification) ─────────────
function runMigrations() {
    try {
        const cols = db.prepare("PRAGMA table_info(users)").all();
        const hasEmail = cols.some(col => col.name === 'email');
        const hasEmailVerified = cols.some(col => col.name === 'email_verified');
        if (!hasEmail) {
            console.log('[DB] Adding email column to users table');
            db.exec('ALTER TABLE users ADD COLUMN email TEXT');
        }
        if (!hasEmailVerified) {
            console.log('[DB] Adding email_verified column to users table');
            db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
        }
        // Create email index after ensuring column exists
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    }
    catch (err) {
        console.error('[DB] Migration error:', err.message);
        throw err;
    }
}
runMigrations();
// ── Users ───────────────────────────────────────────────────────────────────
const stmtGetByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const stmtGetByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtGetById = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtCreateUser = db.prepare('INSERT INTO users (username, password_hash, email, email_verified, created_at, last_ip) VALUES (?, ?, ?, 1, ?, ?)');
const stmtUpdatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const stmtCountUsersByIp = db.prepare('SELECT COUNT(*) as n FROM users WHERE last_ip = ? AND created_at > ?');
const stmtSetLastIp = db.prepare('UPDATE users SET last_ip = ? WHERE id = ?');
export const dbGetUserByUsername = (username) => stmtGetByUsername.get(username);
export const dbGetUserByEmail = (email) => stmtGetByEmail.get(email);
export const dbGetUserById = (id) => stmtGetById.get(id);
export const dbCreateUser = (username, passwordHash, email, ip) => {
    const info = stmtCreateUser.run(username, passwordHash, email, Date.now(), ip);
    return stmtGetById.get(info.lastInsertRowid);
};
export const dbUpdatePassword = (userId, passwordHash) => {
    stmtUpdatePassword.run(passwordHash, userId);
};
export const dbCountUsersFromIpToday = (ip) => {
    const row = stmtCountUsersByIp.get(ip, Date.now() - 24 * 60 * 60 * 1000);
    return row.n;
};
export const dbSetLastIp = (userId, ip) => {
    stmtSetLastIp.run(ip, userId);
};
// ── Pending registrations ───────────────────────────────────────────────────
const stmtUpsertPending = db.prepare(`
  INSERT INTO pending_registrations (username, password_hash, email, ip, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET
    password_hash = excluded.password_hash,
    email = excluded.email,
    ip = excluded.ip,
    created_at = excluded.created_at
`);
const stmtUpsertPendingByEmail = db.prepare(`
  INSERT INTO pending_registrations (username, password_hash, email, ip, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    username = excluded.username,
    password_hash = excluded.password_hash,
    ip = excluded.ip,
    created_at = excluded.created_at
`);
const stmtGetPendingByUsername = db.prepare('SELECT * FROM pending_registrations WHERE username = ?');
const stmtGetPendingByEmail = db.prepare('SELECT * FROM pending_registrations WHERE email = ?');
const stmtDeletePending = db.prepare('DELETE FROM pending_registrations WHERE id = ?');
const stmtCountPendingByIpToday = db.prepare('SELECT COUNT(*) as n FROM pending_registrations WHERE ip = ? AND created_at > ?');
const stmtDeleteStalePending = db.prepare('DELETE FROM pending_registrations WHERE created_at < ?');
export const dbSavePendingRegistration = (username, passwordHash, email, ip) => {
    // UPSERT по username; если такой email уже занят другой незавершённой регистрацией — перезапишем её
    try {
        stmtUpsertPending.run(username, passwordHash, email, ip, Date.now());
    }
    catch {
        stmtUpsertPendingByEmail.run(username, passwordHash, email, ip, Date.now());
    }
};
export const dbGetPendingByUsername = (username) => stmtGetPendingByUsername.get(username);
export const dbGetPendingByEmail = (email) => stmtGetPendingByEmail.get(email);
export const dbDeletePending = (id) => {
    stmtDeletePending.run(id);
};
export const dbCountPendingFromIpToday = (ip) => {
    const row = stmtCountPendingByIpToday.get(ip, Date.now() - 24 * 60 * 60 * 1000);
    return row.n;
};
// ── Verification codes ───────────────────────────────────────────────────────
const stmtInsertCode = db.prepare('INSERT INTO verification_codes (type, identifier, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)');
const stmtGetLatestCode = db.prepare('SELECT * FROM verification_codes WHERE type = ? AND identifier = ? ORDER BY created_at DESC LIMIT 1');
const stmtDeleteCodes = db.prepare('DELETE FROM verification_codes WHERE type = ? AND identifier = ?');
const stmtDeleteExpiredCodes = db.prepare('DELETE FROM verification_codes WHERE expires_at < ?');
export const dbSaveVerificationCode = (type, identifier, code) => {
    // при каждом новом коде старые для этого identifier инвалидируются
    stmtDeleteCodes.run(type, identifier);
    stmtInsertCode.run(type, identifier, code, Date.now() + 10 * 60 * 1000, Date.now());
};
export const dbGetLatestCode = (type, identifier) => stmtGetLatestCode.get(type, identifier);
export const dbInvalidateCode = (id) => {
    stmtDeleteCodes.run(id);
};
// ── Periodic cleanup ────────────────────────────────────────────────────────
export function startDbCleanup() {
    const hourMs = 60 * 60 * 1000;
    setInterval(() => {
        try {
            stmtDeleteExpiredCodes.run(Date.now());
            stmtDeleteStalePending.run(Date.now() - 24 * 60 * 60 * 1000);
        }
        catch (err) {
            console.error('[DB] cleanup error:', err);
        }
    }, hourMs).unref();
}
//# sourceMappingURL=index.js.map