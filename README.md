# Flight Training Dashboard — Template

Dashboard สรุปชั่วโมงบินของศิษย์การบิน ข้อมูลมาจาก Google Form และเปิดดูได้หลังใส่รหัสผ่าน

> **รุ่นใหม่เริ่มที่นี่:** กดปุ่ม **Use this template** (มุมขวาบน) เพื่อสร้าง repo ของรุ่นคุณ
> แล้วทำตามคู่มือ (Playbook) ทีละขั้น — ไม่ต้องลงโปรแกรมในเครื่อง ทำผ่านเว็บได้ทั้งหมด

## ระบบทำงานอย่างไร

```
Google Form ──► Google Sheet ──► Apps Script ──► flight_data.json (Google Drive)
                                                         │
                         เบราว์เซอร์ ◄── Vercel (/api/data ต้องล็อกอินก่อน) ◄─┘
```

1. ศิษย์การบินกรอกชั่วโมงบินใน **Google Form** → คำตอบลง **Google Sheet**
2. **Apps Script** ในชีตแปลงข้อมูลเป็นไฟล์ `flight_data.json` บน Google Drive
3. เว็บบน **Vercel** อ่านไฟล์นั้น แนบรายชื่อ แล้วส่งให้เฉพาะคนที่ใส่รหัสผ่านถูก

## ไฟล์ที่รุ่นใหม่ต้องแก้ (มีแค่ 2 ไฟล์)

| ไฟล์ | แก้อะไร |
|---|---|
| [`cohort.config.js`](cohort.config.js) | ชื่อรุ่น, วันเริ่ม/จบของช่วงประถมและมัธยม, ชื่อแบบอากาศยานที่สะกดต่างกัน |
| [`api/_sp-names.js`](api/_sp-names.js) | รายชื่อศิษย์การบิน (รหัส SP → ยศ ชื่อ สกุล) |

ห้ามย้ายรายชื่อไปไว้ใน `cohort.config.js` — ไฟล์นั้นส่งให้เบราว์เซอร์ทุกคนก่อนล็อกอิน

## ค่าที่ต้องตั้งบน Vercel (Settings → Environment Variables)

| ชื่อ | ค่า |
|---|---|
| `DASHBOARD_PASSWORD` | รหัสผ่านที่จะแจกให้คนในหน่วย (ใช้วลียาว ๆ) |
| `SESSION_SECRET` | ข้อความสุ่มยาว ๆ ห้ามเปิดเผย — สร้างจาก https://generate-secret.vercel.app/32 |
| `DRIVE_FILE_ID` | ได้จาก Log ตอนรัน `setup()` ใน Apps Script |

แก้ค่าเหล่านี้แล้วต้อง **Redeploy** ถึงจะมีผล

## Apps Script

โค้ดอยู่ที่ [`google-apps-script/Code.gs`](google-apps-script/Code.gs) — คัดลอกไปวางในชีต (ส่วนขยาย → Apps Script)

| ฟังก์ชัน | ใช้เมื่อ |
|---|---|
| `setup()` | รันครั้งเดียวตอนติดตั้ง — สร้างไฟล์ JSON และบอกค่า `DRIVE_FILE_ID` |
| `writeJsonToDrive()` | อัปเดตข้อมูลบนเว็บ (รันเอง) |
| `installAutoUpdate()` | ให้อัปเดตเองทุกครั้งที่มีคนส่ง Form และทุกชั่วโมง |
| `diagnose()` | ข้อมูลออกมาเป็น 0 — ตรวจว่าหัวคอลัมน์ตรงกับ Form ไหม |

หัวคอลัมน์ในชีตต้องตรงกับค่าใน `COL` ด้านบนของ `Code.gs` ถ้าเปลี่ยนคำถามใน Form ต้องแก้ตรงนั้นด้วย

## สำหรับคนที่อยากรันในเครื่อง (ไม่บังคับ)

```bash
npm install
cp .env.example .env.local   # แล้วใส่ค่าทั้ง 3 ตัว
npm run dev                  # เปิด http://localhost:5173
```

## โครงสร้างไฟล์

```
cohort.config.js          ค่าประจำรุ่น (ส่งให้เบราว์เซอร์)
src/App.jsx               หน้าเว็บทั้งหมด
api/login.js              ตรวจรหัสผ่าน → ออกคุกกี้
api/data.js               ดึง flight_data.json จาก Drive (ต้องล็อกอิน)
api/_sp-names.js          รายชื่อศิษย์การบิน (อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น)
api/_auth.js              ฟังก์ชันจัดการเซสชัน
google-apps-script/Code.gs  สคริปต์ที่วางใน Google Sheet
```
