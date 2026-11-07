import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bookings from "./api/bookings.js";
import login from "./api/login.js";
import me from "./api/me.js";

/* سيرفر Render: يقدّم الملفات الثابتة ويشغّل نفس ملفات api/ المكتوبة لـ Vercel بدون تعديل. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "100kb" }));

// Render يمرّر دولة الزائر عبر Cloudflare؛ نحوّلها للترويسة التي يقرأها bookings.ts
app.use((req, _res, next) => {
  const c = req.headers["cf-ipcountry"];
  if (c && !req.headers["x-vercel-ip-country"]) req.headers["x-vercel-ip-country"] = c;
  next();
});

const wrap = (fn: (req: any, res: any) => unknown) => (req: any, res: any) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "server" });
  });

app.all("/api/bookings", wrap(bookings as any));
app.all("/api/login", wrap(login as any));
app.all("/api/me", wrap(me as any));
app.get("/healthz", (_req, res) => res.send("ok"));

const files = ["sw.js", "manifest.webmanifest", "dashboard.html", "index.html"];
app.get("/sw.js", (_q, r) => { r.setHeader("Cache-Control", "no-cache"); r.sendFile(path.join(__dirname, "sw.js")); });
app.get("/manifest.webmanifest", (_q, r) => { r.type("application/manifest+json"); r.sendFile(path.join(__dirname, "manifest.webmanifest")); });
app.use("/icons", express.static(path.join(__dirname, "icons")));
app.get("/dashboard.html", (_q, r) => { r.setHeader("Cache-Control", "no-store"); r.sendFile(path.join(__dirname, "dashboard.html")); });
app.get("/", (_q, r) => r.sendFile(path.join(__dirname, "index.html")));
void files;

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log("Entilaaqa listening on " + port));
