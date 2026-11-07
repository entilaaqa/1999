import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cfg, setSession } from "./_auth.js";

/* POST /api/login  {email, password}  →  يسجّل الدخول عبر Supabase Auth ويضع كوكي آمن (HttpOnly). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }
  const { url, anon } = cfg();
  if (!url || !anon) return res.status(503).json({ ok: false, error: "auth_not_configured" });

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_input" });
  }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return res.status(400).json({ ok: false, error: "invalid_input" });

  try {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = String(j.error_code || j.code || "");
      if (code === "email_not_confirmed") return res.status(400).json({ ok: false, error: "email_not_confirmed" });
      if (r.status === 429 || code.includes("rate_limit")) return res.status(429).json({ ok: false, error: "too_many_attempts" });
      if (r.status === 401 || r.status === 400) return res.status(401).json({ ok: false, error: "invalid_credentials" });
      console.error("Supabase auth error", r.status, j);
      return res.status(502).json({ ok: false, error: "auth_misconfigured" });
    }
    setSession(res, j.access_token, j.refresh_token, j.expires_in || 3600);
    return res.status(200).json({ ok: true, redirect: "/dashboard.html" });
  } catch (err) {
    console.error("login failed", err);
    return res.status(502).json({ ok: false, error: "auth_misconfigured" });
  }
}
