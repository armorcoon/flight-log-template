// ════════════════════════════════════════════════════════════════════════════
//  Apps Script สำหรับ Google Sheet ที่รับคำตอบจาก Google Form
//  วิธีติดตั้ง: เปิด Sheet → ส่วนขยาย (Extensions) → Apps Script → วางโค้ดนี้ทั้งไฟล์ → บันทึก
//
//  ลำดับการใช้งาน
//    1. setup()            รันครั้งเดียว — สร้างไฟล์ flight_data.json บน Drive แล้ว Log ค่า DRIVE_FILE_ID
//    2. writeJsonToDrive() อ่านชีต → เขียนข้อมูลลงไฟล์ (รันเองเมื่ออยากอัปเดต)
//    3. installAutoUpdate() (ไม่บังคับ) ให้อัปเดตเองทุกครั้งที่มีคนส่ง Form และทุกชั่วโมง
//    diagnose()            ใช้ตอนข้อมูลออกมาเป็น 0 — บอกว่าหัวคอลัมน์ไหนไม่ตรง
// ════════════════════════════════════════════════════════════════════════════

// ── ปรับค่านี้ให้ตรงกับชีตของคุณ ───────────────────────────────────────────
const SHEET_NAME  = "form_response";     // ชื่อแท็บที่เก็บคำตอบจาก Form
const OUTPUT_FILE = "flight_data.json";

// หัวคอลัมน์ในชีต (= คำถามใน Google Form) — ถ้าเปลี่ยนชื่อคำถามใน Form ต้องแก้ตรงนี้ด้วย
const COL = {
  spCode:         "รหัส SP",
  date:           "วันที่บิน",
  aircraftType:   "ประเภทอากาศยาน",
  aircraftNumber: "หมายเลขเครื่อง",
  dual:           "Flight Hour (Dual)",
  solo:           "Flight Hour (Solo)",
  night:          "Flight Hour (Night)",
  xcountry:       "Flight Hour (X country)",
  fltSim:         "Flight Hour (FLT Sim)",
  autoRotation:   "Auto Rotation",
};

// คอลัมน์ที่ขาดไม่ได้ — ถ้าหาไม่เจอให้ throw แทนที่จะเงียบแล้วได้ 0 record
const REQUIRED = ["spCode", "date"];
// ───────────────────────────────────────────────────────────────────────────

// ID ของไฟล์ JSON เก็บไว้ใน Script Properties (setup() ตั้งให้เอง ไม่ต้องแก้โค้ด)
const PROP_FILE_ID = "DRIVE_FILE_ID";


/**
 * รันครั้งเดียวตอนติดตั้ง
 * สร้างไฟล์ flight_data.json ใน My Drive, เปิดแชร์แบบ "ทุกคนที่มีลิงก์ดูได้",
 * จำ ID ไว้ แล้วเขียนข้อมูลชุดแรกลงไป
 * → คัดลอกค่า DRIVE_FILE_ID จาก Log ไปใส่ใน Vercel
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP_FILE_ID);

  if (id) {
    Logger.log(`ℹ️ มีไฟล์อยู่แล้ว ไม่สร้างใหม่ — DRIVE_FILE_ID = ${id}`);
  } else {
    const file = DriveApp.createFile(OUTPUT_FILE, JSON.stringify({ ok: true, updated: null, count: 0, data: [] }), MimeType.PLAIN_TEXT);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    id = file.getId();
    props.setProperty(PROP_FILE_ID, id);
    Logger.log(`✅ สร้างไฟล์ ${OUTPUT_FILE} แล้ว`);
  }

  writeJsonToDrive();

  Logger.log("──────────────────────────────────────────────");
  Logger.log(`👉 คัดลอกค่านี้ไปใส่ใน Vercel → Environment Variables`);
  Logger.log(`   DRIVE_FILE_ID = ${id}`);
  Logger.log("──────────────────────────────────────────────");
}


/** อ่านชีต → เขียน flight_data.json (รันเองเมื่ออยากอัปเดต หรือให้ trigger รันให้) */
function writeJsonToDrive() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_FILE_ID);
  if (!id) throw new Error("ยังไม่ได้รัน setup() — รัน setup() ก่อน 1 ครั้ง");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("getActiveSpreadsheet() = null — สคริปต์ต้อง bound กับ Spreadsheet (เปิดจาก ส่วนขยาย > Apps Script ในชีต)");

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    const names = ss.getSheets().map(s => s.getName()).join(", ");
    throw new Error(`ไม่พบชีต "${SHEET_NAME}" — ชีตที่มี: ${names}`);
  }

  const values = sheet.getDataRange().getValues();
  const [headers, ...rows] = values;
  const idx = buildIndex(headers || []);

  const missing = REQUIRED.filter(k => idx[k] === -1);
  if (missing.length) {
    throw new Error(
      `หาคอลัมน์ไม่เจอ: ${missing.map(k => `"${COL[k]}"`).join(", ")}\n` +
      `หัวคอลัมน์จริง: ${(headers || []).map(h => `"${String(h).trim()}"`).join(" | ")}\n` +
      `→ รัน diagnose() เพื่อดูรายละเอียด`
    );
  }

  // ชีตว่าง (รุ่นใหม่ยังไม่มีใครกรอก) ก็เขียนได้ — dashboard จะแสดงว่ายังไม่มีข้อมูล
  const data = rows
    .filter(r => r[idx.spCode] && r[idx.date])
    .map((r, i) => ({
      id:             `gs-${i}`,
      spCode:         str(r, idx.spCode),
      date:           formatDate(r[idx.date]),
      aircraftType:   str(r, idx.aircraftType),
      aircraftNumber: str(r, idx.aircraftNumber),
      dual:           toNum(r, idx.dual),
      solo:           toNum(r, idx.solo),
      night:          toNum(r, idx.night),
      xcountry:       toNum(r, idx.xcountry),
      fltSim:         toNum(r, idx.fltSim),
      autoRotation:   toNum(r, idx.autoRotation),
    }));

  const json = JSON.stringify({ ok: true, updated: new Date().toISOString(), count: data.length, data }, null, 2);

  const file = DriveApp.getFileById(id);   // ล็อกไฟล์ด้วย ID — กันหยิบไฟล์ชื่อซ้ำ
  file.setContent(json);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  Logger.log(`✅ เขียน ${data.length} records ลง ${OUTPUT_FILE} แล้ว (จาก ${rows.length} แถวในชีต)`);
}


/**
 * (ไม่บังคับ) ตั้งให้อัปเดตอัตโนมัติ
 *   - ทุกครั้งที่มีคนส่ง Google Form
 *   - ทุก 1 ชั่วโมง (เผื่อมีคนแก้ข้อมูลในชีตโดยตรง)
 * รันซ้ำได้ ไม่ซ้อนกัน
 */
function installAutoUpdate() {
  removeAutoUpdate();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("writeJsonToDrive").forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger("writeJsonToDrive").timeBased().everyHours(1).create();
  Logger.log("✅ ตั้งอัปเดตอัตโนมัติแล้ว (ส่ง Form + ทุก 1 ชั่วโมง)");
}

/** ยกเลิกการอัปเดตอัตโนมัติ */
function removeAutoUpdate() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "writeJsonToDrive")
    .forEach(t => ScriptApp.deleteTrigger(t));
}


/**
 * รันตัวนี้เมื่อได้ data = 0
 * จะ log ชื่อชีตทั้งหมด + หัวคอลัมน์จริง พร้อมชี้ว่าคอลัมน์ไหนแมตช์ไม่ได้
 */
function diagnose() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("getActiveSpreadsheet() = null — สคริปต์นี้ต้อง bound กับ Spreadsheet (Extensions > Apps Script) ไม่ใช่ standalone project");

  const names = ss.getSheets().map(s => s.getName());
  Logger.log("ชีตทั้งหมด: " + JSON.stringify(names));
  Logger.log("DRIVE_FILE_ID: " + (PropertiesService.getScriptProperties().getProperty(PROP_FILE_ID) || "(ยังไม่ได้รัน setup)"));

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log(`❌ ไม่พบชีตชื่อ "${SHEET_NAME}" — แก้ SHEET_NAME เป็นชื่อใดชื่อหนึ่งข้างบน`);
    return;
  }

  const values = sheet.getDataRange().getValues();
  Logger.log(`ชีต "${SHEET_NAME}": ${values.length} แถว (รวมหัวตาราง), ${sheet.getLastColumn()} คอลัมน์`);
  if (values.length < 1) {
    Logger.log("❌ ชีตว่างทั้งหมด ไม่มีแม้แต่หัวตาราง");
    return;
  }

  const headers = values[0];
  Logger.log("── หัวคอลัมน์จริง (raw + escaped) ──");
  headers.forEach((h, i) => {
    const s = String(h);
    Logger.log(`[${i}] "${s}"  ${escapeInvisible(s)}`);
  });

  Logger.log("── ผลการแมตช์ ──");
  const idx = buildIndex(headers);
  Object.keys(COL).forEach(key => {
    const i = idx[key];
    const mark = i === -1 ? (REQUIRED.indexOf(key) !== -1 ? "❌ ต้องมี!" : "⚠️ ไม่มี (จะเป็น 0)") : "✅";
    Logger.log(`${mark} ${key} ("${COL[key]}") -> col ${i}`);
  });

  const rows = values.slice(1);
  const kept = rows.filter(r => idx.spCode !== -1 && idx.date !== -1 && r[idx.spCode] && r[idx.date]);
  Logger.log(`ผ่าน filter: ${kept.length} / ${rows.length} แถว`);
  if (kept.length === 0 && rows.length > 0 && idx.spCode !== -1 && idx.date !== -1) {
    Logger.log("แมตช์คอลัมน์ได้แต่ยังกรองทิ้งหมด — ตัวอย่าง 3 แถวแรก:");
    rows.slice(0, 3).forEach((r, n) =>
      Logger.log(`  แถว ${n + 2}: spCode=${JSON.stringify(r[idx.spCode])} date=${JSON.stringify(r[idx.date])}`));
  }
}


// ── helpers ────────────────────────────────────────────────────────────────

/** ทำ header ให้เทียบกันได้: ตัด NBSP / zero-width / ยุบช่องว่างซ้อน / ไม่สนตัวพิมพ์ */
function norm(v) {
  return String(v == null ? "" : v)
    .replace(/ /g, " ")                // non-breaking space (Google Form ชอบแทรก)
    .replace(/[​-‍﻿]/g, "")  // zero-width space + BOM
    .replace(/\s+/g, " ")                   // ยุบช่องว่าง/ขึ้นบรรทัดใหม่ทั้งหมดเป็นช่องว่างเดียว
    .trim()
    .toLowerCase();
}

function buildIndex(headers) {
  const normalized = headers.map(norm);
  const idx = {};
  Object.keys(COL).forEach(key => {
    const target = norm(COL[key]);
    let i = normalized.indexOf(target);
    if (i === -1) i = normalized.findIndex(h => h && h.indexOf(target) !== -1); // เผื่อ Form ต่อท้ายคำอธิบายใต้หัวข้อ
    idx[key] = i;
  });
  return idx;
}

function escapeInvisible(s) {
  const codes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xA0 || c === 0xFEFF || (c >= 0x200B && c <= 0x200D)) codes.push(`pos${i}:U+${c.toString(16).toUpperCase()}`);
  }
  return codes.length ? `  ⚠️ มีอักขระซ่อน: ${codes.join(", ")}` : "";
}

function str(row, i) {
  return i === -1 ? "" : String(row[i] == null ? "" : row[i]).trim();
}

function toNum(row, i) {
  if (i === -1) return 0;
  const n = parseFloat(String(row[i]).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatDate(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}
