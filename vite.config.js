import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// รันไฟล์ใน api/ ตอน `npm run dev` ด้วย
// (บน Vercel ไฟล์พวกนี้เป็น Serverless Function อยู่แล้ว แต่ Vite dev ไม่รู้จัก
//  ปลั๊กอินนี้จึงเรียก handler ให้เอง พร้อมเติมเมธอด res.status()/res.json()
//  แบบเดียวกับที่ Vercel เตรียมไว้)
function apiDevServer() {
  return {
    name: "api-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const name = url.pathname.slice("/api/".length).replace(/[^a-zA-Z0-9_-]/g, "");
        if (!name) return next();

        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(obj));
          return res;
        };
        req.query = Object.fromEntries(url.searchParams);

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`);
          await mod.default(req, res);
        } catch (err) {
          server.config.logger.error(`[api] /api/${name} → ${err.message}`);
          if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // ให้ handler ใน api/ อ่าน DASHBOARD_PASSWORD / SESSION_SECRET จาก .env.local ได้
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [react(), apiDevServer()],
    server: {
      watch: {
        ignored: ["**/json_sync/**"],
      },
    },
  };
});
