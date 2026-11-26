import nodemailer from 'nodemailer';

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[MAILER] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) — codes will be logged to console only');
    return null;
  }

  const port   = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true';

  console.log(`[MAILER] Configuring SMTP: ${host}:${port} secure=${secure} user=${user}`);

  const t = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

  // Verify connection at startup so errors appear in logs immediately
  t.verify().then(() => {
    console.log('[MAILER] SMTP connection verified OK');
  }).catch((err: any) => {
    console.error('[MAILER] SMTP connection FAILED:', err.message);
  });

  return t;
}

// Called from index.ts after .env is loaded
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function initMailer() {
  transporter = createTransporter();
}

function getFrom() {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@wc3con.local';
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const subject = 'WC3 Connector — подтверждение регистрации';
  const html = `
    <div style="font-family:sans-serif;max-width:420px">
      <h2 style="color:#2563eb">WC3 Connector</h2>
      <p>Ваш код подтверждения:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f0f0f0;text-align:center;border-radius:8px">${code}</div>
      <p style="color:#888;font-size:13px">Код действителен 10 минут. Если вы не регистрировались — просто проигнорируйте это письмо.</p>
    </div>`;

  if (!transporter) {
    console.log(`[MAILER] SMTP not configured. Verification code for ${email}: ${code}`);
    return;
  }

  console.log(`[MAILER] Sending verification code to ${email}`);
  await transporter.sendMail({ from: getFrom(), to: email, subject, html });
  console.log(`[MAILER] Verification code sent to ${email}`);
}

export async function sendPasswordResetCode(email: string, code: string): Promise<void> {
  const subject = 'WC3 Connector — сброс пароля';
  const html = `
    <div style="font-family:sans-serif;max-width:420px">
      <h2 style="color:#2563eb">WC3 Connector</h2>
      <p>Код для сброса пароля:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f0f0f0;text-align:center;border-radius:8px">${code}</div>
      <p style="color:#888;font-size:13px">Код действителен 10 минут. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>
    </div>`;

  if (!transporter) {
    console.log(`[MAILER] SMTP not configured. Password reset code for ${email}: ${code}`);
    return;
  }

  console.log(`[MAILER] Sending password reset code to ${email}`);
  await transporter.sendMail({ from: getFrom(), to: email, subject, html });
  console.log(`[MAILER] Password reset code sent to ${email}`);
}
