import type { VercelRequest, VercelResponse } from "@vercel/node";
import pg from "pg";
import { randomUUID } from "node:crypto";

/*
  POST /api/bookings
  يحفظ حجوزات الفورم مباشرة في Supabase (قاعدة Postgres).
  عند ربط Supabase بمشروعك في Vercel تُضاف بيانات الاتصال تلقائياً (POSTGRES_URL)،
  والجدول `bookings` يُنشأ تلقائياً عند أول حجز — لا حاجة لأي إعداد يدوي.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const opt = (v: unknown, max: number) => str(v, max) || null;
const choice = (v: unknown) => {
  const o = (v ?? {}) as { code?: unknown; label?: unknown };
  const code = Number(o.code);
  return { code: Number.isInteger(code) && code > 0 && code < 20 ? code : 0, label: str(o.label, 300) };
};

// كل الروابط المحتملة التي قد يضيفها تكامل Supabase/Vercel. نجرّبها بالترتيب حتى ينجح أحدها.
// (الرابط المباشر db.xxx.supabase.co يعمل بـ IPv6 فقط وقد يفشل على Vercel، لذلك الـ pooler أولاً.)
const connectionStrings = () =>
  [
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);

// نبني إعدادات الاتصال يدوياً: رابط Supabase يحمل متغيّرات إضافية (مثل supa=base-pooler.x و sslmode)
// تسبّب أخطاء مع مكتبة pg، فنتجاهلها ونفعّل SSL بأنفسنا.
function poolConfig(raw: string): pg.PoolConfig {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    ssl: u.searchParams.get("sslmode") === "disable" ? false : { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  };
}

// بديل: واجهة Supabase REST (لا تحتاج اتصال Postgres مباشر). تتطلب وجود الجدول (supabase/bookings.sql).
const restConfig = () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
};

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.bookings (
    id                   serial PRIMARY KEY,
    booking_id           uuid NOT NULL UNIQUE,
    created_at           timestamptz NOT NULL DEFAULT now(),
    language             text NOT NULL,
    name                 text NOT NULL,
    whatsapp             text NOT NULL,
    email                text NOT NULL,
    current_status       text NOT NULL,
    current_status_code  integer NOT NULL,
    main_goal            text NOT NULL,
    biggest_challenge    text NOT NULL,
    monthly_income       text NOT NULL,
    monthly_income_code  integer NOT NULL,
    ready_to_invest      text NOT NULL,
    ready_to_invest_code integer NOT NULL,
    session_start        text,
    session_end          text,
    session_tz           text,
    page_url             text,
    referrer             text,
    utm                  jsonb NOT NULL DEFAULT '{}',
    user_agent           text,
    country              text
  );
  -- حماية: لا أحد يقرأ الجدول عبر واجهة Supabase العامة (anon key). السيرفر فقط يكتب، وأنت تقرأ من لوحة Supabase.
  ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
`;

let ready: Promise<pg.Pool> | null = null;

function getDb(): Promise<pg.Pool> {
  if (ready) return ready;
  const urls = connectionStrings();
  if (!urls.length) return Promise.reject(Object.assign(new Error("no_db_url"), { tag: "no_db" }));
  ready = (async () => {
    let last: unknown;
    for (const url of urls) {
      const pool = new pg.Pool(poolConfig(url));
      pool.on("error", (e) => console.error("pg pool error", e));
      try {
        try {
          await pool.query(CREATE_TABLE);
          await pool.query("ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'new'; ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notes text; ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS updated_at timestamptz;");
        } catch (err) {
          // سباق نادر: طلبان متزامنان أنشآ الجدول معاً. إن كان الجدول موجوداً فلا مشكلة.
          const { rows } = await pool.query("select to_regclass('public.bookings') as t");
          if (!rows[0]?.t) throw err;
        }
        return pool;
      } catch (err) {
        console.error("DB connection candidate failed:", (err as Error)?.message);
        last = err;
        pool.end().catch(() => {});
      }
    }
    throw Object.assign(last instanceof Error ? last : new Error(String(last)), { tag: "db_connect" });
  })().catch((err) => {
    ready = null; // أعد المحاولة في الطلب التالي
    throw err;
  });
  return ready;
}

async function saveViaRest(row: Record<string, unknown>) {
  const c = restConfig();
  if (!c) throw Object.assign(new Error("no_rest_config"), { tag: "no_db" });
  const r = await fetch(`${c.url}/rest/v1/bookings?on_conflict=booking_id`, {
    method: "POST",
    headers: {
      apikey: c.key,
      ...(c.key.startsWith("eyJ") ? { Authorization: `Bearer ${c.key}` } : {}),
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw Object.assign(new Error(`rest ${r.status}: ${(await r.text()).slice(0, 200)}`), { tag: "rest" });
}

const bad = (res: VercelResponse, msg: string) => res.status(400).json({ ok: false, error: msg });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // فحص سريع للإعداد: افتح /api/bookings في المتصفح لتعرف سبب الفشل (لا يعرض أي أسرار).
  if (req.method === "GET") {
    const env = {
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      DATABASE_URL: !!process.env.DATABASE_URL,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    try {
      const db = await getDb();
      const { rows } = await db.query("select count(*)::int as n from public.bookings");
      return res.status(200).json({ ok: true, db: "connected", bookings: rows[0].n, env });
    } catch (err) {
      const e = err as Error & { tag?: string; code?: string };
      return res.status(200).json({ ok: false, db: "failed", reason: e.tag || "unknown", code: e.code || null, message: String(e.message).slice(0, 200), env });
    }
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }

  let body: Record<string, any>;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return bad(res, "invalid_json");
  }
  if (!body || typeof body !== "object") return bad(res, "invalid_body");

  // Honeypot: bots fill the hidden field. Pretend success, store nothing.
  if (str(body.website, 200)) return res.status(201).json({ ok: true });

  const name = str(body.name, 200);
  const whatsapp = str(body.whatsapp, 32).replace(/[^\d+]/g, "");
  const email = str(body.email, 254).toLowerCase();
  const mainGoal = str(body.main_goal_12_months, 4000);
  const biggestChallenge = str(body.biggest_challenge, 4000);
  const status = choice(body.current_status);
  const income = choice(body.monthly_income);
  const ready = choice(body.ready_to_invest_over_10000);

  if (name.length < 2) return bad(res, "name");
  if (whatsapp.replace(/\D/g, "").length < 7) return bad(res, "whatsapp");
  if (!EMAIL.test(email)) return bad(res, "email");
  if (!mainGoal) return bad(res, "main_goal");
  if (!biggestChallenge) return bad(res, "biggest_challenge");
  if (!status.code || !income.code || !ready.code) return bad(res, "choices");

  const session = (body.session ?? {}) as Record<string, unknown>;
  const source = (body.source ?? {}) as Record<string, unknown>;
  const utm: Record<string, string> = {};
  if (source.utm && typeof source.utm === "object") {
    for (const [k, v] of Object.entries(source.utm as Record<string, unknown>).slice(0, 20)) {
      if (/^[a-z_]{2,40}$/i.test(k)) utm[k] = str(v, 300);
    }
  }

  const bookingId =
    typeof body.booking_id === "string" && UUID.test(body.booking_id) ? body.booking_id : randomUUID();
  const language = ["ar", "en", "zh"].includes(body.language) ? body.language : "ar";
  const country = req.headers["x-vercel-ip-country"];

  const row = {
    booking_id: bookingId, language, name, whatsapp, email,
    current_status: status.label, current_status_code: status.code,
    main_goal: mainGoal, biggest_challenge: biggestChallenge,
    monthly_income: income.label, monthly_income_code: income.code,
    ready_to_invest: ready.label, ready_to_invest_code: ready.code,
    session_start: opt(session.start, 64), session_end: opt(session.end, 64), session_tz: opt(session.tz, 64),
    page_url: opt(source.page_url, 2000), referrer: opt(source.referrer, 2000),
    utm, user_agent: opt(req.headers["user-agent"], 500),
    country: typeof country === "string" ? country : null,
  };

  const cols = Object.keys(row);
  const sql = `INSERT INTO public.bookings (${cols.join(",")})
     VALUES (${cols.map((c, i) => (c === "utm" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(",")})
     ON CONFLICT (booking_id) DO NOTHING`;
  const values = Object.values(row).map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v));

  try {
    // A retried submission with the same booking_id is stored only once.
    const db = await getDb();
    await db.query(sql, values);
  } catch (pgErr) {
    console.error("Postgres save failed, trying Supabase REST fallback:", pgErr);
    try {
      await saveViaRest(row);
    } catch (restErr) {
      console.error("Failed to save booking", restErr);
      const e = pgErr as Error & { tag?: string; code?: string };
      return res.status(500).json({ ok: false, error: e.tag || "server", code: e.code || null });
    }
  }

  return res.status(201).json({ ok: true, booking_id: bookingId });
}
