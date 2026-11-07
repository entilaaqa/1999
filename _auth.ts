import type { VercelRequest, VercelResponse } from "@vercel/node";

/* مساعدات مشتركة لتسجيل الدخول عبر Supabase Auth (الملف يبدأ بـ _ فلا يصبح مساراً عاماً). */

export const cfg = () => {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return { url, anon, service };
};

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function readCookie(req: VercelRequest, name: string): string {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

const base = "Path=/; HttpOnly; Secure; SameSite=Lax";
export const setSession = (res: VercelResponse, access: string, refresh: string, expiresIn: number) =>
  res.setHeader("Set-Cookie", [
    `ent_at=${encodeURIComponent(access)}; ${base}; Max-Age=${Math.max(60, expiresIn)}`,
    `ent_rt=${encodeURIComponent(refresh)}; ${base}; Max-Age=${60 * 60 * 24 * 30}`,
  ]);
export const clearSession = (res: VercelResponse) =>
  res.setHeader("Set-Cookie", [`ent_at=; ${base}; Max-Age=0`, `ent_rt=; ${base}; Max-Age=0`]);

/** يرجع المستخدم الحالي من الكوكي، ويجدّد الجلسة تلقائياً إن انتهت. */
export async function currentUser(req: VercelRequest, res: VercelResponse): Promise<{ email: string } | null> {
  const { url, anon } = cfg();
  if (!url || !anon) return null;
  const ask = async (token: string) => {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    return r.ok ? ((await r.json()) as { email?: string }) : null;
  };
  const at = readCookie(req, "ent_at");
  if (at) {
    const u = await ask(at);
    if (u?.email) return { email: u.email.toLowerCase() };
  }
  const rt = readCookie(req, "ent_rt");
  if (!rt) return null;
  const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; user?: { email?: string } };
  if (!j.access_token || !j.refresh_token || !j.user?.email) return null;
  setSession(res, j.access_token, j.refresh_token, j.expires_in || 3600);
  return { email: j.user.email.toLowerCase() };
}
