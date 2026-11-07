import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminEmails, cfg, clearSession, currentUser } from "./_auth.js";

const teamEmails = () => (process.env.TEAM_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const STATUSES = ["new", "contacted", "scheduled", "won", "lost"];
const BASE = "id,created_at,language,name,whatsapp,email,current_status,current_status_code,main_goal,biggest_challenge,monthly_income,monthly_income_code,ready_to_invest,ready_to_invest_code,session_start,session_tz,page_url,referrer,utm,country";

/* GET /api/me → المستخدم. GET ?bookings=1 → الحجوزات. POST ?update=1 → تحديث حالة/ملاحظات عميل. POST → تسجيل الخروج. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST" && req.query.update === undefined) {
    clearSession(res);
    return res.status(200).json({ ok: true });
  }
  const user = await currentUser(req, res);
  if (!user) return res.status(401).json({ ok: false });
  const isAdmin = adminEmails().includes(user.email);
  const canView = isAdmin || teamEmails().includes(user.email); // المدير: كل الصلاحيات. التيم: عرض + متابعة العملاء بدون تصدير.
  if (req.method === "GET" && req.query.bookings === undefined) return res.status(200).json({ ok: true, email: user.email, isAdmin, canView });
  if (!canView) return res.status(403).json({ ok: false, error: "forbidden" });

  const { url, service } = cfg();
  if (!url || !service) return res.status(503).json({ ok: false, error: "no_service_key" });
  const auth: Record<string, string> = service.startsWith("eyJ") ? { apikey: service, Authorization: `Bearer ${service}` } : { apikey: service };

  if (req.method === "POST") {
    let b: any;
    try { b = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ ok: false, error: "invalid_input" }); }
    const id = Number(b?.id);
    const patch: Record<string, unknown> = {};
    if (b?.lead_status !== undefined) {
      if (!STATUSES.includes(b.lead_status)) return res.status(400).json({ ok: false, error: "invalid_input" });
      patch.lead_status = b.lead_status;
    }
    if (b?.notes !== undefined) patch.notes = String(b.notes).slice(0, 2000);
    if (!Number.isInteger(id) || !Object.keys(patch).length) return res.status(400).json({ ok: false, error: "invalid_input" });
    patch.updated_at = new Date().toISOString();
    const r = await fetch(`${url}/rest/v1/bookings?id=eq.${id}`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      console.error("lead update failed", r.status, detail);
      return res.status(502).json({ ok: false, error: /lead_status|notes|updated_at/.test(detail) ? "needs_migration" : "db", detail });
    }
    return res.status(200).json({ ok: true });
  }

  const get = (cols: string) => fetch(`${url}/rest/v1/bookings?select=${cols}&order=created_at.desc&limit=2000`, { headers: auth });
  let r = await get(`${BASE},lead_status,notes`);
  let migrated = true;
  if (!r.ok) { r = await get(BASE); migrated = false; } // العمودان الجديدان غير موجودين بعد
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 200);
    console.error("bookings REST failed", r.status, detail);
    return res.status(502).json({ ok: false, error: "db", status: r.status, detail });
  }
  return res.status(200).json({ ok: true, bookings: await r.json(), migrated });
}
