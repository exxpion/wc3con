import nodemailer from 'nodemailer';

const smtpConfigured =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const FROM = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@wc3con.local';

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

  await transporter.sendMail({ from: FROM, to: email, subject, html });
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

  await transporter.sendMail({ from: FROM, to: email, subject, html });
}
