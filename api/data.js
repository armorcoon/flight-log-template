// Caching proxy for the flight data — now behind the password gate.
//
// We read the flight_data.json file DIRECTLY from Google Drive (it is shared
// public by writeJsonToDrive) instead of going through the Apps Script `doGet`
// web app. This avoids two problems that plagued the /exec path:
//   1. doGet needed a manual redeploy for every code change
//   2. getFilesByName() could pick a duplicate/empty file
// The file is pinned by ID, so this always serves exactly what writeJsonToDrive
// last wrote.
//
// Caching: the response carries personal data, so it must never sit in a shared
// CDN cache where an unauthenticated request could pick it up. Instead we hold
// the upstream payload in module memory for 5 minutes — Vercel reuses function
// instances, so repeat visitors still skip the Drive round-trip — and tell the
// browser to keep nothing.

import { requireSession } from "./_auth.js";
import { SP_NAMES } from "./_sp-names.js";

// ID ของไฟล์ flight_data.json บน Google Drive — ตั้งเป็น Environment Variable
// DRIVE_FILE_ID บน Vercel (ได้จาก Log ตอนรัน setup() ใน Apps Script)
const fileId   = () => (process.env.DRIVE_FILE_ID || "").trim();
const driveUrl = () => `https://drive.google.com/uc?id=${fileId()}&export=download`;
const TTL_MS   = 5 * 60 * 1000;

let cache = { at: 0, data: null };

async function loadFromDrive() {
  const upstream = await fetch(driveUrl(), { redirect: "follow" });
  const text = await upstream.text();
  // Guard: Drive occasionally returns an HTML interstitial instead of the file.
  try {
    const data = JSON.parse(text);
    // แนบรายชื่อไปกับข้อมูล จะได้ไม่ต้องฝังไว้ในไฟล์ฝั่งเบราว์เซอร์
    return { ...data, names: SP_NAMES };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;

  res.setHeader("Cache-Control", "private, no-store");

  if (!fileId()) {
    res.status(503).json({ ok: false, error: "ยังไม่ได้ตั้งค่า DRIVE_FILE_ID บน Vercel" });
    return;
  }

  const fresh = cache.data && Date.now() - cache.at < TTL_MS;
  if (fresh) {
    res.status(200).json(cache.data);
    return;
  }

  try {
    const data = await loadFromDrive();
    if (!data) {
      // Serve the last good copy rather than failing outright.
      if (cache.data) {
        res.status(200).json(cache.data);
        return;
      }
      res.status(502).json({ ok: false, error: "drive returned non-JSON" });
      return;
    }
    cache = { at: Date.now(), data };
    res.status(200).json(data);
  } catch {
    if (cache.data) {
      res.status(200).json(cache.data);
      return;
    }
    res.status(502).json({ ok: false, error: "upstream fetch failed" });
  }
}
