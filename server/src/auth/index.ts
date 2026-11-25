import bcrypt from 'bcrypt';
import { FastifyInstance, FastifyRequest } from 'fastify';
import {
  dbGetUserByUsername,
  dbGetUserByEmail,
  dbCreateUser,
  dbUpdatePassword,
  dbCountUsersFromIpToday,
  dbCountPendingFromIpToday,
  dbSavePendingRegistration,
  dbGetPendingByUsername,
  dbSaveVerificationCode,
  dbGetLatestCode,
} from '../db/index.js';
import { sendVerificationCode, sendPasswordResetCode } from '../mailer.js';

const SALT_ROUNDS = 10;
const CODE_LENGTH = 6;
const IP_DAILY_LIMIT = 3;

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return request.ip ?? '0.0.0.0';
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export async function setupAuthRoutes(app: FastifyInstance) {

  // ── POST /api/auth/register/start ─────────────────────────────────────────
  app.post<{
    Body: { username: string; password: string; email: string };
  }>('/api/auth/register/start', async (request, reply) => {
    const { username, password, email } = request.body ?? {};
    const ip = getClientIp(request);

    if (!username || !password || !email) {
      return reply.code(400).send({ error: 'Укажите логин, пароль и email' });
    }
    if (username.length < 3 || username.length > 20) {
      return reply.code(400).send({ error: 'Логин: от 3 до 20 символов' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return reply.code(400).send({ error: 'Логин: только латиница, цифры и _' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'Пароль: минимум 6 символов' });
    }
    if (!validateEmail(email)) {
      return reply.code(400).send({ error: 'Укажите корректный email' });
    }

    // Дубли
    if (dbGetUserByUsername(username)) {
      return reply.code(409).send({ error: 'Такой логин уже занят' });
    }
    if (dbGetUserByEmail(email)) {
      return reply.code(409).send({ error: 'Этот email уже используется' });
    }

    // Rate limit: не более IP_DAILY_LIMIT завершённых + незавершённых регистраций с одного IP за 24ч
    const completedToday = dbCountUsersFromIpToday(ip);
    const pendingToday = dbCountPendingFromIpToday(ip);
    if (completedToday + pendingToday >= IP_DAILY_LIMIT) {
      return reply.code(429).send({ error: `С одного IP можно создать не более ${IP_DAILY_LIMIT} аккаунтов в сутки` });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    dbSavePendingRegistration(username, passwordHash, email, ip);

    const code = generateCode();
    dbSaveVerificationCode('register', username, code);

    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error('[MAIL] Failed to send verification code:', err);
      return reply.code(500).send({ error: 'Не удалось отправить письмо. Проверьте email.' });
    }

    return reply.send({ ok: true });
  });

  // ── POST /api/auth/register/confirm ──────────────────────────────────────
  app.post<{
    Body: { username: string; code: string };
  }>('/api/auth/register/confirm', async (request, reply) => {
    const { username, code } = request.body ?? {};
    const ip = getClientIp(request);

    if (!username || !code) {
      return reply.code(400).send({ error: 'Укажите логин и код' });
    }

    const pending = dbGetPendingByUsername(username);
    if (!pending) {
      return reply.code(400).send({ error: 'Регистрация не найдена. Начните заново.' });
    }

    const record = dbGetLatestCode('register', username);
    if (!record) {
      return reply.code(400).send({ error: 'Код не найден. Начните регистрацию заново.' });
    }
    if (Date.now() > record.expires_at) {
      return reply.code(400).send({ error: 'Код истёк. Начните регистрацию заново.' });
    }
    if (record.code !== code.trim()) {
      return reply.code(400).send({ error: 'Неверный код' });
    }

    // Финальная проверка дублей (могло измениться пока ждали)
    if (dbGetUserByUsername(username)) {
      return reply.code(409).send({ error: 'Такой логин уже занят' });
    }
    if (dbGetUserByEmail(pending.email)) {
      return reply.code(409).send({ error: 'Этот email уже используется' });
    }

    const user = dbCreateUser(username, pending.password_hash, pending.email, ip);
    const token = app.jwt.sign({ userId: user.id, username: user.username });

    return reply.send({ token, user: { id: user.id, username: user.username } });
  });

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  app.post<{
    Body: { username: string; password: string };
  }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || !password) {
      return reply.code(400).send({ error: 'Укажите логин и пароль' });
    }

    const user = dbGetUserByUsername(username);
    if (!user) {
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    const token = app.jwt.sign({ userId: user.id, username: user.username });
    return reply.send({ token, user: { id: user.id, username: user.username } });
  });

  // ── POST /api/auth/forgot-password ───────────────────────────────────────
  app.post<{
    Body: { email: string };
  }>('/api/auth/forgot-password', async (request, reply) => {
    const { email } = request.body ?? {};

    if (!email || !validateEmail(email)) {
      return reply.code(400).send({ error: 'Укажите корректный email' });
    }

    const user = dbGetUserByEmail(email);
    // Не раскрываем, есть ли email в базе
    if (!user) {
      return reply.send({ ok: true });
    }

    const code = generateCode();
    dbSaveVerificationCode('reset', email, code);

    try {
      await sendPasswordResetCode(email, code);
    } catch (err) {
      console.error('[MAIL] Failed to send password reset code:', err);
      return reply.code(500).send({ error: 'Не удалось отправить письмо' });
    }

    return reply.send({ ok: true });
  });

  // ── POST /api/auth/reset-password ────────────────────────────────────────
  app.post<{
    Body: { email: string; code: string; newPassword: string };
  }>('/api/auth/reset-password', async (request, reply) => {
    const { email, code, newPassword } = request.body ?? {};

    if (!email || !code || !newPassword) {
      return reply.code(400).send({ error: 'Укажите email, код и новый пароль' });
    }
    if (newPassword.length < 6) {
      return reply.code(400).send({ error: 'Новый пароль: минимум 6 символов' });
    }

    const user = dbGetUserByEmail(email);
    if (!user) {
      return reply.code(400).send({ error: 'Аккаунт с таким email не найден' });
    }

    const record = dbGetLatestCode('reset', email);
    if (!record) {
      return reply.code(400).send({ error: 'Код не найден. Запросите новый.' });
    }
    if (Date.now() > record.expires_at) {
      return reply.code(400).send({ error: 'Код истёк. Запросите новый.' });
    }
    if (record.code !== code.trim()) {
      return reply.code(400).send({ error: 'Неверный код' });
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    dbUpdatePassword(user.id, hash);

    return reply.send({ ok: true });
  });

  // ── GET /api/auth/verify ──────────────────────────────────────────────────
  app.get('/api/auth/verify', async (request, reply) => {
    try {
      await request.jwtVerify();
      return reply.send({ valid: true, user: request.user });
    } catch {
      return reply.code(401).send({ valid: false });
    }
  });
}
