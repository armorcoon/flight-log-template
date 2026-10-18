// Shared session helpers for the password gate.
//
// A session is a signed string "<expiry-ms>.<hmac>" stored in an HttpOnly
// cookie, so the password itself never lives in the browser after login and
// page scripts cannot read the session back out.
//
// Required environment variables (set these in Vercel → Settings → Environment Variables):
//   DASHBOARD_PASSWORD  the shared password handed out to the unit
//   SESSION_SECRET      a long random string used to sign sessions
// (api/data.js additionally needs DRIVE_FILE_ID)

import crypto from "node:crypto";

export const COOKIE = "flightlog_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const secret = () => process.env.SESSION_SECRET || "";
const password = () => process.env.DASHBOARD_PASSWORD || "";

export const isConfigured = () => secret().length > 0 && password().length > 0;

const hmac = (payload) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

// Constant-time compare that tolerates differing lengths.
function sameString(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const checkPassword = (given) =>
  isConfigured() && sameString(given ?? "", password());

export function createSession() {
  const payload = String(Date.now() + MAX_AGE * 1000);
  return `${payload}.${hmac(payload)}`;
}

export function isValidSession(token) {
  if (!token || !secret()) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const payload = token.slice(0, i);
  if (!sameString(token.slice(i + 1), hmac(payload))) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export const sessionCookie = (value, maxAge) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;

/** Returns true when the caller holds a valid session; otherwise replies 401. */
export function requireSession(req, res) {
  if (!isConfigured()) {
    res.status(503).json({ ok: false, error: "auth not configured" });
    return false;
  }
  if (!isValidSession(readCookie(req, COOKIE))) {
    res.setHeader("Cache-Control", "no-store");
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

/** Reads a JSON request body (Vercel usually parses it for us; this covers dev). */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}
