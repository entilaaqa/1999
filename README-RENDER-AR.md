# نشر انطلاقة على Render

## 1) ارفع المشروع على GitHub
أنشئ مستودعاً جديداً وارفع محتوى هذا المجلد (بدون node_modules).

## 2) أنشئ الخدمة على Render
Render → **New → Web Service** → اختر المستودع. (أو **New → Blueprint** وسيقرأ `render.yaml` تلقائياً.)
- Runtime: **Node**
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`

## 3) أضف المتغيّرات (Environment)
انسخها من Vercel أو من Supabase → Project Settings → API:
| المتغيّر | من وين |
|---|---|
| `SUPABASE_URL` | Supabase → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → service_role key (سرّي، لا تشاركه) |
| `POSTGRES_URL` | Supabase → Connect → Connection string (Transaction pooler) |
| `ADMIN_EMAILS` | بريدك (عدة بريدات بفاصلة) |
| `TEAM_EMAILS` | بريدات الفريق (اختياري) |

بعد الحفظ اضغط **Manual Deploy → Deploy latest commit**.

## 4) كيف الداشبورد مربوطة بتسجيل الدخول
- زر «تسجيل الدخول» في الصفحة الرئيسية يرسل البريد وكلمة المرور إلى `/api/login`.
- إذا صحّت البيانات يضع السيرفر كوكي آمن (HttpOnly) وينقلك مباشرة إلى `/dashboard.html`.
- الداشبورد عند فتحها تسأل `/api/me`؛ إن لم تكن مسجلاً (401) تعيدك للصفحة الرئيسية تلقائياً. فلا أحد يفتحها بدون دخول.
- زر «تسجيل الخروج» يمسح الكوكي ويعيدك للرئيسية.
- الحسابات: Supabase → Authentication → Users → Add user (فعّل Auto Confirm).

## 5) الدومين
Render → Settings → Custom Domains → أضف `entilaaqa.com` واتبع سجلات DNS.
ملاحظة: الخطة المجانية تنام بعد 15 دقيقة بلا نشاط وأول زيارة تتأخر قليلاً.

## مسارات الداشبورد
`/dashboard.html#/overview` · `#/leads` · `#/settings/profile`
