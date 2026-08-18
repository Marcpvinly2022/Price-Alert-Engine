import nodemailer from "nodemailer";

// One pooled SMTP transport for the whole process (created once, reused for every
// send). WHY: nodemailer reuses TCP/TLS connections instead of reconnecting per
// email — that matters when the worker drains a burst of jobs. All config comes
// from env, so Gmail today or Brevo/SendGrid/any SMTP later is a .env change with
// NO code change (same "config not code" rule the sender map already follows).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  // 465 = implicit TLS (secure:true); 587 = STARTTLS (secure:false, then upgraded).
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD, // Gmail App Password, NOT the account password
  },
  pool: true, // reuse connections across sends
  maxConnections: 5,
  maxMessages: 100,

  // TLS chain validation. Defaults to STRICT (reject untrusted certs) — the safe
  // production behavior. Some antivirus/corporate proxies intercept the SMTP TLS
  // handshake and present their OWN root cert, which Node's bundled CA list
  // doesn't trust → "self-signed certificate in certificate chain". Setting
  // SMTP_TLS_REJECT_UNAUTHORIZED=false in dev lets the handshake proceed. The
  // connection is STILL encrypted — we only skip chain verification, and only for
  // SMTP, and only when explicitly opted in. NEVER set false in production (it
  // would accept a man-in-the-middle cert).
  tls: {
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
  },
});

// Build the HTML body. WHY tables + inline styles (not a stylesheet/flexbox):
// email clients — Gmail especially — strip <style> blocks and don't support
// modern CSS layout, so table layout with inline styles is the only thing that
// renders consistently everywhere. Accent color reflects direction: green when
// the rate rose ABOVE the target, red when it fell BELOW.
const buildEmailHtml = (alert) => {
  const isAbove = alert.condition === "ABOVE";
  const accent = isAbove ? "#16a34a" : "#dc2626";
  const arrow = isAbove ? "▲" : "▼";
  const direction = isAbove ? "risen to or above" : "fallen to or below";
  const pair = alert.currencyPair.replace("_", " / ");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;margin:0;padding:24px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Brand header -->
          <tr>
            <td style="background-color:#0f172a;padding:24px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;">Price Alert Engine</span>
            </td>
          </tr>

          <!-- Status strip (color = direction) -->
          <tr>
            <td style="background-color:${accent};padding:14px 32px;">
              <span style="color:#ffffff;font-size:15px;font-weight:600;">${arrow}&nbsp; Alert Triggered</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:700;">${pair} has ${direction} your target.</p>
              <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">Here are the details of the alert you set.</p>

              <!-- Target rate highlight -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;text-align:center;">
                    <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Target Rate</div>
                    <div style="color:${accent};font-size:34px;font-weight:800;line-height:1;">${alert.targetRate.toString()}</div>
                    <div style="color:#94a3b8;font-size:13px;margin-top:6px;">${pair}</div>
                  </td>
                </tr>
              </table>

              <!-- Detail rows -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px;">Currency Pair</td>
                  <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${alert.currencyPair}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px;">Condition</td>
                  <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${alert.condition}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;color:#64748b;font-size:14px;">Alert ID</td>
                  <td style="padding:12px 0;color:#94a3b8;font-size:12px;font-family:'Courier New',monospace;text-align:right;">${alert.id}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">You received this email because you set a price alert on Price Alert Engine. This is an automated message — please do not reply.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>`;
};

export const sendEmailNotification = async (notification) => {
  // Fail fast on missing config so a misconfigured env surfaces as a clear error
  // (which the worker audits + retries), not a silent undefined.
  if (!process.env.MAIL_FROM) {
    throw new Error("MAIL_FROM is not configured");
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error("SMTP transport is not configured (SMTP_HOST / SMTP_USER)");
  }

  const alert = notification.alert;

  if (!alert) {
    throw new Error("Alert data is missing from notification");
  }

  if (!alert.userEmail) {
    throw new Error("Notification recipient email is missing");
  }

  // nodemailer's sendMail REJECTS on failure, so a throw here propagates to the
  // worker for retry/backoff/terminal-FAILED — no manual error-check needed.
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM,

    to: alert.userEmail,

    subject: "Price Alert Triggered 🚨",

    // Plain-text fallback alongside HTML improves deliverability (Gmail scores
    // multipart mail lower for spam than HTML-only).
    text:
      `PRICE ALERT TRIGGERED\n\n` +
      `${alert.currencyPair} has ${
        alert.condition === "ABOVE" ? "risen to or above" : "fallen to or below"
      } your target.\n\n` +
      `Target Rate: ${alert.targetRate.toString()}\n` +
      `Condition:   ${alert.condition}\n` +
      `Alert ID:    ${alert.id}\n\n` +
      `— Price Alert Engine (automated message)\n`,

    html: buildEmailHtml(alert),
  });

  console.log(
    `[EMAIL] Notification ${notification.id} sent via SMTP`
  );

  // Map nodemailer's Message-ID to our audit field (stored on the row as
  // providerMessageId), same shape the Resend provider returned.
  return {
    provider: "smtp",
    providerMessageId: info.messageId,
  };
};
