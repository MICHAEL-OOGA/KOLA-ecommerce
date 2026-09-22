import nodemailer from "nodemailer";

/*
|--------------------------------------------------------------------------
| Shared KOLA transactional email service
|--------------------------------------------------------------------------
|
| One transport is shared by:
|
| - email-verification OTPs
| - password-reset links
|
| In development, email delivery may be left unconfigured while the
| development-only token/code preview is enabled.
|
| In production, SMTP configuration is required.
*/

const isProduction = process.env.NODE_ENV === "production";

const readOptionalBoolean = (name, fallback) => {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  if (["true", "1", "yes"].includes(rawValue)) {
    return true;
  }

  if (["false", "0", "no"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
};

const readSmtpConfiguration = () => {
  const host = process.env.SMTP_HOST?.trim() || "";
  const portRaw = process.env.SMTP_PORT?.trim() || "";
  const from = process.env.EMAIL_FROM?.trim() || "";
  const user = process.env.SMTP_USER?.trim() || "";
  const password = process.env.SMTP_PASSWORD?.trim() || "";

  const hasAnyConfiguration = Boolean(
    host || portRaw || from || user || password,
  );

  if (!hasAnyConfiguration) {
    if (isProduction) {
      throw new Error(
        "SMTP_HOST, SMTP_PORT and EMAIL_FROM are required in production.",
      );
    }

    return null;
  }

  if (!host || !portRaw || !from) {
    throw new Error(
      "SMTP_HOST, SMTP_PORT and EMAIL_FROM must all be configured together.",
    );
  }

  const port = Number(portRaw);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }

  if (Boolean(user) !== Boolean(password)) {
    throw new Error(
      "SMTP_USER and SMTP_PASSWORD must either both be configured or both be omitted.",
    );
  }

  return {
    host,
    port,
    from,

    secure: readOptionalBoolean("SMTP_SECURE", port === 465),

    auth:
      user && password
        ? {
            user,
            pass: password,
          }
        : undefined,
  };
};

const smtpConfiguration = readSmtpConfiguration();

let transporter = null;

const getTransporter = () => {
  if (!smtpConfiguration) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpConfiguration.host,
      port: smtpConfiguration.port,
      secure: smtpConfiguration.secure,
      auth: smtpConfiguration.auth,
    });
  }

  return transporter;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const sendMail = async ({ to, subject, text, html }) => {
  const mailer = getTransporter();

  /*
   * Local development may intentionally rely on the existing
   * development-only OTP/reset-token preview instead of SMTP.
   */
  if (!mailer) {
    return {
      sent: false,
      skipped: true,
    };
  }

  const result = await mailer.sendMail({
    from: smtpConfiguration.from,
    to,
    subject,
    text,
    html,
  });

  return {
    sent: true,
    skipped: false,
    messageId: result.messageId,
  };
};

/*
|--------------------------------------------------------------------------
| Verification OTP email
|--------------------------------------------------------------------------
*/

export const sendVerificationEmail = async ({ to, code, expiresInMinutes }) => {
  const safeCode = escapeHtml(code);

  return sendMail({
    to,

    subject: "Verify your KOLA email address",

    text: [
      "Welcome to KOLA.",
      "",
      `Your email-verification code is: ${code}`,
      "",
      `This code expires in ${expiresInMinutes} minute${
        expiresInMinutes === 1 ? "" : "s"
      }.`,
      "",
      "If you did not create a KOLA account, you can ignore this email.",
    ].join("\n"),

    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a; line-height: 1.6;">
        <p style="font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #059669;">
          KOLA account verification
        </p>

        <h1 style="font-size: 28px; margin: 12px 0;">
          Verify your email address
        </h1>

        <p>Enter this code in KOLA:</p>

        <div style="margin: 24px 0; padding: 18px; border-radius: 16px; background: #f1f5f9; text-align: center;">
          <span style="font-family: monospace; font-size: 30px; font-weight: 800; letter-spacing: 0.22em;">
            ${safeCode}
          </span>
        </div>

        <p>
          This code expires in
          <strong>${escapeHtml(expiresInMinutes)} minute${
            expiresInMinutes === 1 ? "" : "s"
          }</strong>.
        </p>

        <p style="color: #64748b;">
          If you did not create a KOLA account, you can ignore this email.
        </p>
      </div>
    `,
  });
};

/*
|--------------------------------------------------------------------------
| Password-reset email
|--------------------------------------------------------------------------
*/

export const sendPasswordResetEmail = async ({
  to,
  resetUrl,
  expiresInMinutes,
}) => {
  const safeResetUrl = escapeHtml(resetUrl);

  return sendMail({
    to,

    subject: "Reset your KOLA password",

    text: [
      "A password reset was requested for your KOLA account.",
      "",
      "Open this link to choose a new password:",
      resetUrl,
      "",
      `This link expires in ${expiresInMinutes} minute${
        expiresInMinutes === 1 ? "" : "s"
      }.`,
      "",
      "If you did not request this password reset, you can ignore this email.",
    ].join("\n"),

    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a; line-height: 1.6;">
        <p style="font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #059669;">
          KOLA account security
        </p>

        <h1 style="font-size: 28px; margin: 12px 0;">
          Reset your password
        </h1>

        <p>
          A password reset was requested for your KOLA account.
        </p>

        <p style="margin: 28px 0;">
          <a
            href="${safeResetUrl}"
            style="display: inline-block; padding: 14px 22px; border-radius: 999px; background: #020617; color: #ffffff; text-decoration: none; font-weight: 800;"
          >
            Reset password
          </a>
        </p>

        <p>
          This link expires in
          <strong>${escapeHtml(expiresInMinutes)} minute${
            expiresInMinutes === 1 ? "" : "s"
          }</strong>.
        </p>

        <p style="color: #64748b;">
          If you did not request this password reset, you can ignore this email.
        </p>
      </div>
    `,
  });
};
