const { Resend } = require("resend");
const admin = require("firebase-admin");

// Initialise Firebase Admin once per cold start
if (!admin.apps.length) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  } catch {
    serviceAccount = {};
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(500).json({ error: "Missing RESEND_API_KEY" });
  }

  const body =
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { email } = body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const appUrl = process.env.APP_URL || "https://pulse.sciencerevisions.online";

    const link = await admin.auth().generatePasswordResetLink(email, {
      url: `${appUrl}/?pwreset=1`,
    });

    const resend = new Resend(resendKey);
    const from = process.env.RESEND_FROM || "Pulse <onboarding@resend.dev>";

    await resend.emails.send({
      from,
      to: email,
      subject: "Reset your Pulse password",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding:40px 16px">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)" cellpadding="0" cellspacing="0" role="presentation">
        <!-- Header -->
        <tr><td style="background:#4b6ef6;padding:28px 32px">
          <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:-0.04em;color:#ffffff">
            pulse<span style="color:#a5b4fc">.</span>
          </p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 24px">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.02em">
            Reset your password
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">
            We received a request to reset the password for your Pulse account. Click the button below to choose a new password.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#4b6ef6;color:#ffffff;padding:13px 28px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:-0.01em">
            Reset password →
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.5">
            This link expires in 1 hour. If you didn't request a password reset you can safely ignore this email — your password won't change.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6">
          <p style="margin:0;font-size:12px;color:#d1d5db">
            Pulse · Your daily tracker for habits, goals and focus
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error("send-password-reset error:", error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
};
