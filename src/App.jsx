import { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { COHORT, AIRCRAFT_ALIASES } from "../cohort.config.js";

// ข้อมูลการบินดึงจาก /api/data หลังเข้าสู่ระบบเท่านั้น ไม่ฝังไว้ในไฟล์โปรแกรม
// เพื่อไม่ให้ชื่อและชั่วโมงบินหลุดไปกับ bundle ที่ส่งให้เบราว์เซอร์ก่อนล็อกอิน
const EMPTY = { updated: null, count: 0, rows: [] };

// ─── training phases (from cohort.config.js) ────────────────────────────────

const BASIC = COHORT.basic;
const ADV   = COHORT.advanced;
const ADV_START = ADV.start; // flights on/after this date count as advanced

const DAY_MS = 86400000;
const bkkDate  = iso => new Date(`${iso}T00:00:00+07:00`);
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const fmtEn = iso => bkkDate(iso).toLocaleDateString("en-GB",
  { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

// Inclusive day count of a phase so far. An ongoing phase (end null, or end
// still in the future) runs up to today; a phase that has not begun has 0 days.
function phaseSpan(p) {
  const today = todayIso();
  if (today < p.start) return { started: false, days: 0, range: `เริ่ม ${fmtEn(p.start)}` };
  const end = p.end && p.end < today ? p.end : today;
  return {
    started: true,
    days: Math.floor((bkkDate(end) - bkkDate(p.start)) / DAY_MS) + 1,
    range: `${fmtEn(p.start)} – ${fmtEn(end)}`,
  };
}

// ─── live data fetch ─────────────────────────────────────────────────────────

const _FKEYS = ["dual","solo","night","xcountry","fltSim","autoRotation"];

function aggregateRecords(src) {
  // drop mistyped dates: anything before the course began or after today
  const maxDate = todayIso();
  const records = src.data.filter(r => r.date >= BASIC.start && r.date <= maxDate);
  const bySpMap = {};
  for (const r of records) {
    if (!bySpMap[r.spCode]) bySpMap[r.spCode] = [];
    bySpMap[r.spCode].push(r);
  }
  const rows = Object.keys(bySpMap).sort().map(sp => {
    const flights = bySpMap[sp];
    let basicH = 0, advH = 0;
    const totals = Object.fromEntries(_FKEYS.map(k => [k, 0]));
    for (const f of flights) {
      const h = _FKEYS.reduce((s, k) => s + (f[k] || 0), 0);
      if (f.date >= ADV_START) advH += h; else basicH += h;
      for (const k of _FKEYS) totals[k] += f[k] || 0;
    }
    for (const k of _FKEYS) totals[k] = Math.round(totals[k] * 10) / 10;
    const total = Math.round((basicH + advH) * 10) / 10;
    basicH = Math.round(basicH * 10) / 10;
    advH   = Math.round(advH   * 10) / 10;
    const sorted = [...flights].sort((a, b) => b.date.localeCompare(a.date));
    // keep the full flight log (newest first) so the per-SP detail can show every flight
    const recent = sorted.map(f => [
      f.date, f.aircraftType, f.aircraftNumber || "",
      f.dual || 0, f.solo || 0, f.night || 0, f.xcountry || 0, f.fltSim || 0, f.autoRotation || 0,
    ]);
    return { sp, ...totals, total, flights: flights.length, basicH, advH, recent };
  });
  return { updated: src.updated, count: records.length, rows, names: src.names || {} };
}

// รายชื่อศิษย์การบินมาจาก /api/data (เก็บไว้ที่ api/_sp-names.js ฝั่งเซิร์ฟเวอร์)

// merge aircraft labels that are spelled differently in the sheet
const normAc = t => AIRCRAFT_ALIASES[t] || t || "—";

// Format hours with 1 decimal + thousands separators (e.g. 2052 → "2,052.0").
const fmtH = n => Number(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// accent colours for the per-aircraft-type hour tiles in the SP detail modal
const AC_COLORS = ["#2563EB", "#7c3aed", "#0e7490", "#ea580c", "#16a34a", "#db2777"];

// ─── หน้าเข้าสู่ระบบ ──────────────────────────────────────────────────────────
// รหัสผ่านถูกส่งไปตรวจที่ /api/login เท่านั้น ฝั่งเบราว์เซอร์ไม่เก็บรหัสผ่านไว้
// เมื่อผ่านแล้วเซิร์ฟเวอร์จะตั้งคุกกี้ HttpOnly ซึ่งสคริปต์ในหน้าอ่านไม่ได้

function LoginScreen({ C, isMobile, initialError, onSuccess }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok && out.ok) { setPassword(""); await onSuccess(); return; }
      setError(out.error || "เข้าสู่ระบบไม่สำเร็จ");
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 16,
      fontFamily: "system-ui,-apple-system,sans-serif",
    }}>
      <form onSubmit={submit} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: isMobile ? "1.5rem 1.25rem" : "2rem 2.25rem",
        width: "100%", maxWidth: 380, boxShadow: "0 4px 24px rgba(15,23,42,0.06)",
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.3px" }}>{COHORT.name}</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 2, marginBottom: 22 }}>
          {COHORT.subtitle}
        </div>

        <label htmlFor="pw" style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>รหัสผ่าน</label>
        <input
          id="pw"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={busy}
          style={{
            width: "100%", marginTop: 6, fontSize: 15, padding: "9px 12px",
            borderRadius: 8, border: `1px solid ${error ? "#dc2626" : C.border}`,
            outline: "none", background: C.bg, color: C.text,
          }}
        />

        {error && (
          <div style={{ fontSize: 13, color: "#dc2626", marginTop: 8 }}>{error}</div>
        )}

        <button type="submit" disabled={busy || !password} style={{
          width: "100%", marginTop: 16, fontSize: 15, fontWeight: 600,
          padding: "9px 14px", borderRadius: 8, border: "none",
          background: busy || !password ? "#93b4f7" : "#2563EB", color: "#fff",
          cursor: busy || !password ? "default" : "pointer",
        }}>
          {busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function App() {
  const [search,   setSearch]   = useState("");
  const [view,     setView]     = useState("table");
  const [sortBy,   setSortBy]   = useState(null);
  const [sortDir,  setSortDir]  = useState("desc");
  const [raw, setRaw]           = useState(EMPTY);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [selectedSp, setSelectedSp] = useState(null); // SP code for the detail modal
  const [acFilter, setAcFilter] = useState("ทั้งหมด"); // aircraft-type filter inside the modal

  // "checking" → รอผลตรวจสิทธิ์ | "needed" → ต้องเข้าสู่ระบบ | "ok" → ได้ข้อมูลแล้ว
  const [authState, setAuthState] = useState("checking");
  const [loadError, setLoadError] = useState("");

  // ดึงข้อมูลจาก /api/data ซึ่งจะตอบ 401 เมื่อยังไม่ได้เข้าสู่ระบบ
  const loadData = useCallback(async () => {
    setLoadError("");
    try {
      const r = await fetch("/api/data", { credentials: "same-origin" });
      if (r.status === 401) { setAuthState("needed"); setRaw(EMPTY); return; }
      const src = await r.json();
      if (!r.ok || !src.ok) throw new Error(src.error || "โหลดข้อมูลไม่สำเร็จ");
      setRaw(aggregateRecords(src));
      setAuthState("ok");
    } catch (err) {
      setLoadError(err.message || "เชื่อมต่อไม่สำเร็จ");
      setAuthState(s => (s === "checking" ? "needed" : s));
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => { document.title = COHORT.pageTitle; }, []);

  const logout = useCallback(async () => {
    try { await fetch("/api/login", { method: "DELETE", credentials: "same-origin" }); } catch {}
    setRaw(EMPTY);
    setSelectedSp(null);
    setSearch("");
    setAuthState("needed");
  }, []);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") setSelectedSp(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // reset the aircraft filter whenever a different pilot is opened
  useEffect(() => { setAcFilter("ทั้งหมด"); }, [selectedSp]);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const rows = useMemo(
    () => raw.rows.map(r => ({ ...r, spName: (raw.names && raw.names[r.sp]) || r.sp })),
    [raw],
  );

  const visible = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(x => x.sp.toLowerCase().includes(q) || (x.spName && x.spName.toLowerCase().includes(q)));
    }
    if (sortBy) {
      r = [...r].sort((a, b) => {
        const cmp = typeof a[sortBy] === "string"
          ? String(a[sortBy]).localeCompare(String(b[sortBy]))
          : a[sortBy] - b[sortBy];
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return r;
  }, [rows, search, sortBy, sortDir]);

  const totalH     = useMemo(() => rows.reduce((s, r) => s + r.total,   0), [rows]);
  const totalBasic = useMemo(() => rows.reduce((s, r) => s + r.basicH,  0), [rows]);
  const totalAdv   = useMemo(() => rows.reduce((s, r) => s + r.advH,    0), [rows]);
  const totalFlts  = useMemo(() => rows.reduce((s, r) => s + r.flights, 0), [rows]);

  // Last-updated date + time extracted from the data's `updated` field
  // (UTC in the source — display in Thai time).
  const updDate = new Date(raw.updated).toLocaleString("th-TH", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });

  // Ongoing phases track the current date, so ranges and day counts update
  // automatically every time the page is opened.
  const basicSpan = phaseSpan(BASIC);
  const advSpan   = phaseSpan(ADV);

  // SPs that have at least one logged flight (guards the averages below)
  const spCount = rows.length || 1;

  const C = {
    bg: "#F8FAFC", card: "#fff", border: "#E2E8F0",
    text: "#0F172A", muted: "#64748B", faint: "#94A3B8",
  };
  const cardStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: isMobile ? "0.75rem" : "1rem 1.25rem",
  };

  // ── ยังไม่รู้สถานะสิทธิ์ ──────────────────────────────────────────────────
  if (authState === "checking") {
    return (
      <div style={{
        minHeight: "100vh", background: C.bg, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui,-apple-system,sans-serif", color: C.muted, fontSize: 15,
      }}>
        กำลังตรวจสอบสิทธิ์…
      </div>
    );
  }

  // ── ต้องเข้าสู่ระบบก่อน ───────────────────────────────────────────────────
  if (authState !== "ok") {
    return <LoginScreen C={C} isMobile={isMobile} initialError={loadError} onSuccess={loadData} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui,-apple-system,sans-serif" }}>

      {/* ── header ────────────────────────────────────────────────────────── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: isMobile ? "0.65rem 0.75rem" : "0.65rem 1.5rem",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "flex", flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          gap: isMobile ? 8 : 12,
        }}>
          <div>
            <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: C.text, letterSpacing: "-0.3px" }}>{COHORT.name}</span>
            <span style={{ fontSize: isMobile ? 13 : 15, color: C.muted, marginLeft: 8 }}>{COHORT.subtitle}</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="ค้นหา SP / ชื่อศบ."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                fontSize: 13, padding: "5px 14px", borderRadius: 6,
                border: `1px solid ${C.border}`, outline: "none",
                background: C.bg, color: C.text, width: isMobile ? "100%" : 220,
              }}
            />
            <span style={{
              fontSize: 12, padding: "3px 10px", borderRadius: 20,
              background: "#F0FDF4", color: "#16a34a", fontWeight: 500, whiteSpace: "nowrap",
            }}>✓ อัปเดตล่าสุด {updDate} น.</span>
            <button onClick={logout} title="ออกจากระบบ" style={{
              fontSize: 12, padding: "3px 12px", borderRadius: 6, cursor: "pointer",
              border: `1px solid ${C.border}`, background: "transparent",
              color: C.muted, whiteSpace: "nowrap",
            }}>ออกจากระบบ</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "0.75rem 0.75rem 2rem" : "1.25rem 1.5rem 2.5rem" }}>

        {/* ── summary metric cards ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: isMobile ? 8 : 12, marginBottom: 14 }}>
          {[
            { label: "รวมชั่วโมงบิน",    value: fmtH(totalH) + "h",   sub: `เฉลี่ย ${fmtH(totalH/spCount)}h / SP` },
            { label: "เที่ยวบินทั้งหมด",  value: totalFlts.toLocaleString(), sub: `เฉลี่ย ${Math.round(totalFlts/spCount)} เที่ยว / SP` },
            { label: "จำนวนนักบิน (SP)", value: `${rows.length} SP`,        sub: "student pilots" },
            { label: "รายการทั้งหมด",     value: raw.count.toLocaleString(), sub: "records จาก Google Sheet" },
          ].map(c => (
            <div key={c.label} style={cardStyle}>
              <div style={{ fontSize: isMobile ? 11 : 13, color: C.muted, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, color: C.text, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── phase cards — advanced first ─────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 8 : 12, marginBottom: 14 }}>
          {[
            {
              num: 2, label: ADV.label, sub: ADV.sub, span: advSpan,
              total: totalAdv, color: "#7c3aed", bg: "#F5F3FF",
            },
            {
              num: 1, label: BASIC.label, sub: BASIC.sub, span: basicSpan,
              total: totalBasic, color: "#0e7490", bg: "#ECFEFF",
            },
          ].map(p => (
            <div key={p.num} style={{
              ...cardStyle, background: p.bg,
              borderLeft: `4px solid ${p.color}`,
              display: "flex", alignItems: "center", gap: 16,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: p.color }}>
                  {p.label}
                  <span style={{ fontWeight: 400, color: C.muted, marginLeft: 6 }}>({p.sub})</span>
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
                  {p.span.range} · {p.span.started ? `${p.span.days} วัน` : "ยังไม่เริ่ม"}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.text, lineHeight: 1 }}>
                  {fmtH(p.total)}<span style={{ fontSize: 15, fontWeight: 400, marginLeft: 2 }}>h</span>
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                  เฉลี่ย {fmtH(p.total / spCount)}h / SP
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── table / chart panel ──────────────────────────────────────────── */}
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>

          {/* panel header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0.75rem 1.25rem", borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
              ตารางชั่วโมงบิน · {visible.length} SP
              {view === "table" && (
                <span style={{ fontSize: 12, fontWeight: 400, color: C.faint, marginLeft: 8 }}>
                  (คลิกแถวเพื่อดูรายละเอียด)
                </span>
              )}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {[["table","ตาราง"],["chart","กราฟ"]].map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} style={{
                  fontSize: 13, padding: "4px 14px", borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${view === v ? "#2563EB" : C.border}`,
                  background: view === v ? "#EFF6FF" : "transparent",
                  color: view === v ? "#2563EB" : C.muted,
                  fontWeight: view === v ? 600 : 400,
                }}>{label}</button>
              ))}
            </div>
          </div>

          {/* ── table view ── */}
          {view === "table" && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    {[
                      { h: "SP",          align: "left",  key: "sp"        },
                      { h: "ศิษย์การบิน", align: "left",  key: null        },
                      { h: "Total",       align: "right", key: "total"     },
                      { h: ADV.label,     align: "right", key: "advH"      },
                      { h: BASIC.label,   align: "right", key: "basicH"    },
                      { h: "Dual",        align: "right", key: "dual"      },
                      { h: "Solo",        align: "right", key: "solo"      },
                      { h: "Flights",     align: "right", key: "flights"   },
                    ].map(({ h, align, key }) => {
                      const active = sortBy === key && key !== null;
                      const arrow  = active ? (sortDir === "desc" ? " ↓" : " ↑") : "";
                      return (
                        <th key={h} onClick={key ? () => {
                          if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
                          else { setSortBy(key); setSortDir("desc"); }
                        } : undefined} style={{
                          padding: "8px 12px", textAlign: align,
                          fontSize: 12, fontWeight: 600,
                          color: active ? C.text : C.muted,
                          borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                          cursor: key ? "pointer" : "default",
                          userSelect: "none",
                        }}>{h}{arrow}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => {
                    const bg = i % 2 === 0 ? C.card : "#F8FAFC";
                    return (
                      <tr key={r.sp} style={{ background: bg, cursor: "pointer" }}
                        onClick={() => setSelectedSp(r.sp)}
                        onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
                        onMouseLeave={e => e.currentTarget.style.background = bg}
                      >
                        <td style={{ padding: "8px 12px", fontWeight: 700, color: C.text }}>{r.sp}</td>
                        <td style={{ padding: "8px 12px", color: C.text, fontSize: 14 }}>{r.spName || "—"}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#2563EB" }}>{r.total.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#7c3aed" }}>{r.advH.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#0e7490" }}>{r.basicH.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: C.muted }}>{r.dual.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: C.muted }}>{r.solo.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: C.muted }}>{r.flights}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${C.border}`, background: "#F8FAFC" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: C.text }}>รวม</td>
                    <td />
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#2563EB" }}>
                      {fmtH(visible.reduce((s, r) => s + r.total, 0))}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#7c3aed" }}>
                      {fmtH(visible.reduce((s, r) => s + r.advH, 0))}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#0e7490" }}>
                      {fmtH(visible.reduce((s, r) => s + r.basicH, 0))}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: C.muted }}>
                      {fmtH(visible.reduce((s, r) => s + r.dual, 0))}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: C.muted }}>
                      {fmtH(visible.reduce((s, r) => s + r.solo, 0))}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: C.muted }}>
                      {visible.reduce((s, r) => s + r.flights, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div style={{ fontSize: 12, color: C.faint, textAlign: "right", padding: "6px 14px" }}>
                ข้อมูล ณ {new Date(raw.updated).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {raw.count.toLocaleString()} records              </div>
            </div>
          )}

          {/* ── chart view ── */}
          {view === "chart" && (
            <div style={{ padding: "1rem 1.25rem" }}>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={visible.map(r => ({ sp: r.sp, total: r.total }))}
                    margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                    barSize={24}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                    <XAxis dataKey="sp" tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} width={40} unit="h" />
                    <Tooltip
                      formatter={v => [v.toFixed(1) + "h", "Total"]}
                      contentStyle={{ fontSize: 13, borderRadius: 6, border: `1px solid ${C.border}` }}
                    />
                    <Bar dataKey="total" radius={[4,4,0,0]} fill="#2563EB" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* ── per-SP flight log modal ────────────────────────────────────────── */}
      {selectedSp && (() => {
        const sel = rows.find(r => r.sp === selectedSp);
        if (!sel) return null;
        // total hours + flights per aircraft type (whole log, ignores the filter)
        const acAgg = {};
        for (const f of sel.recent) {
          const t = normAc(f[1]);
          if (!acAgg[t]) acAgg[t] = { type: t, hours: 0, flights: 0 };
          acAgg[t].hours += f[3] + f[4] + f[5] + f[6] + f[7] + f[8];
          acAgg[t].flights += 1;
        }
        const acStats = Object.values(acAgg)
          .map(a => ({ ...a, hours: Math.round(a.hours * 10) / 10 }))
          .sort((a, b) => b.hours - a.hours);
        const types = acStats.map(a => a.type);
        const shown = sel.recent.filter(f => acFilter === "ทั้งหมด" || normAc(f[1]) === acFilter);
        const th = (align) => ({
          padding: "7px 12px", textAlign: align, fontSize: 11, fontWeight: 600,
          color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
          background: "#F8FAFC", position: "sticky", top: 0,
        });
        return (
          <div onClick={() => setSelectedSp(null)} style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 50,
            display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
            padding: isMobile ? 0 : 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: C.card, width: "100%", maxWidth: 620, height: isMobile ? "90vh" : "85vh",
              borderRadius: isMobile ? "14px 14px 0 0" : 12, overflow: "hidden",
              display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
            }}>

              {/* header */}
              <div style={{
                padding: isMobile ? "0.85rem 1rem" : "1rem 1.25rem", borderBottom: `1px solid ${C.border}`,
                display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{sel.sp}</span>
                    <span style={{ fontSize: 14, color: C.text }}>{sel.spName || ""}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedSp(null)} aria-label="ปิด" style={{
                  border: "none", background: "transparent", fontSize: 24, lineHeight: 1,
                  cursor: "pointer", color: C.muted, padding: 2,
                }}>×</button>
              </div>

              {/* stat strip */}
              <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
                {[
                  ["รวม",      fmtH(sel.total)  + "h", "#2563EB"],
                  [ADV.label,   fmtH(sel.advH)   + "h", "#7c3aed"],
                  [BASIC.label, fmtH(sel.basicH) + "h", "#0e7490"],
                  ["เที่ยวบิน", sel.flights.toLocaleString(), C.text],
                ].map(([label, val, col], i) => (
                  <div key={label} style={{
                    flex: 1, padding: "0.6rem 0.4rem", textAlign: "center",
                    borderLeft: i ? `1px solid ${C.border}` : "none",
                  }}>
                    <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* total hours per aircraft type */}
              <div style={{ padding: "0.6rem 1rem", borderBottom: `1px solid ${C.border}`, background: "#FCFDFE" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginBottom: 6 }}>
                  ชั่วโมงบินรวมแยกตามแบบอากาศยาน
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {acStats.map((a, i) => {
                    const col = AC_COLORS[i % AC_COLORS.length];
                    return (
                      <div key={a.type} style={{
                        flex: "1 1 110px", minWidth: 0,
                        border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`,
                        borderRadius: 8, background: C.card, padding: "5px 10px",
                      }}>
                        <div style={{
                          fontSize: 11, color: C.muted,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{a.type}</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: col, lineHeight: 1.2 }}>
                          {fmtH(a.hours)}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 1 }}>h</span>
                        </div>
                        <div style={{ fontSize: 10, color: C.faint }}>{a.flights} เที่ยว</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* aircraft-type filter (only when this pilot flew more than one type) */}
              {types.length > 1 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  padding: "0.6rem 1rem", borderBottom: `1px solid ${C.border}`,
                }}>
                  <span style={{ fontSize: 12, color: C.muted, marginRight: 2 }}>อากาศยาน:</span>
                  {["ทั้งหมด", ...types].map(t => {
                    const on = acFilter === t;
                    return (
                      <button key={t} onClick={() => setAcFilter(t)} style={{
                        fontSize: 12, padding: "3px 12px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${on ? "#2563EB" : C.border}`,
                        background: on ? "#EFF6FF" : "transparent",
                        color: on ? "#2563EB" : C.muted, fontWeight: on ? 600 : 400,
                      }}>{t}</button>
                    );
                  })}
                  <span style={{ fontSize: 12, color: C.faint, marginLeft: "auto" }}>{shown.length} เที่ยว</span>
                </div>
              )}

              {/* flight log */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th("left")}>วันที่</th>
                      <th style={th("left")}>อากาศยาน</th>
                      <th style={th("left")}>หมายเลข</th>
                      <th style={th("left")}>ประเภท</th>
                      <th style={th("right")}>ชม.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((f, i) => {
                      const h = f[3] + f[4] + f[5] + f[6] + f[7] + f[8];
                      const cats = [["Dual", f[3]], ["Solo", f[4]], ["Night", f[5]],
                        ["X-country", f[6]], ["Sim", f[7]], ["Auto", f[8]]]
                        .filter(c => c[1] > 0).map(c => c[0]).join(", ") || "—";
                      const d = new Date(f[0] + "T00:00:00+07:00")
                        .toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
                      const adv = f[0] >= ADV_START;
                      return (
                        <tr key={i} style={{ background: i % 2 ? "#F8FAFC" : C.card }}>
                          <td style={{ padding: "6px 12px", color: C.text, whiteSpace: "nowrap" }}>
                            {d}
                            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: adv ? "#7c3aed" : "#0e7490" }}>
                              {adv ? ADV.label : BASIC.label}
                            </span>
                          </td>
                          <td style={{ padding: "6px 12px", color: C.muted, whiteSpace: "nowrap" }}>{normAc(f[1])}</td>
                          <td style={{ padding: "6px 12px", color: C.muted, whiteSpace: "nowrap" }}>{f[2] || "—"}</td>
                          <td style={{ padding: "6px 12px", color: C.muted }}>{cats}</td>
                          <td style={{ padding: "6px 12px", textAlign: "right", fontWeight: 700, color: C.text }}>{h.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shown.length === 0 && (
                  <div style={{ padding: "1.25rem", textAlign: "center", color: C.faint }}>ไม่มีข้อมูลเที่ยวบิน</div>
                )}
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
