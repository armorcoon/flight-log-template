// Exchanges the shared password for a session cookie.
//
//   GET   → reports whether the caller already holds a valid session
//   POST  → { password } → sets the session cookie on success
//   DELETE→ clears the session cookie

import {
  COOKIE, MAX_AGE, checkPassword, createSession, isConfigured,
  isValidSession, readCookie, readJsonBody, sessionCookie,
} from "./_auth.js";

// Slows down guessing a little. Serverless gives us no shared counter, so this
// is a speed bump, not a lockout — use a long passphrase.
const WRONG_PASSWORD_DELAY_MS = 800;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const ok = isValidSession(readCookie(req, COOKIE));
    res.status(200).json({ ok, configured: isConfigured() });
    return;
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  if (!isConfigured()) {
    res.status(503).json({
      ok: false,
      error: "ยังไม่ได้ตั้งค่า DASHBOARD_PASSWORD และ SESSION_SECRET",
    });
    return;
  }

  const { password } = await readJsonBody(req);

  if (!checkPassword(password)) {
    await new Promise(r => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
    res.status(401).json({ ok: false, error: "รหัสผ่านไม่ถูกต้อง" });
    return;
  }

  res.setHeader("Set-Cookie", sessionCookie(createSession(), MAX_AGE));
  res.status(200).json({ ok: true });
}
