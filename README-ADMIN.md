# راهنمای دسترسی ادمین (پشتیبانی)

این سیستم **پسورد ندارد**؛ ورود همه‌ی کاربران — از جمله ادمین — با **موبایل + کد یک‌بارمصرف (OTP)** انجام می‌شود.

«ادمین» صرفاً یک کاربر عادی است که نقش `admin` دارد. این نقش **فقط** با اسکریپت seed ساخته می‌شود و **از مسیر ثبت‌نام/آنبوردینگ قابل‌گرفتن نیست** (تلاش برای `POST /onboarding/role { roles: ["admin"] }` با خطای `400` رد می‌شود).

> پیش‌نیاز: بک‌اند روی `http://localhost:4000` و دیتابیس MongoDB در حال اجرا باشد. در صورت نیاز ابتدا `npm run dev` را در ریشه‌ی پروژه اجرا کنید.

---

## گام ۱ — تعیین شماره‌ی ادمین در `.env`

در فایل `.env` ریشه‌ی بک‌اند، شماره‌ی موبایل ادمین را تنظیم کنید (فرمت ایرانی `09xxxxxxxxx`):

```env
ADMIN_PHONE=09120000001
```

## گام ۲ — اجرای اسکریپت ساخت ادمین

اسکریپت **idempotent** است: اگر کاربر با آن شماره نبود می‌سازد، و اگر بود فقط نقش `admin` را به او اضافه می‌کند (نقش‌های دیگرش حفظ می‌شود و حساب فعال می‌شود).

```bash
# روش الف) خواندن شماره از ADMIN_PHONE موجود در .env
npm run seed:admin

# روش ب) دادن شماره به‌صورت آرگومان (بدون نیاز به env)
npm run seed:admin -- 09120000001
```

خروجی موفق:

```
✅ ادمین با شماره 09120000001 ساخته شد. اکنون می‌تواند با OTP وارد شود.
```

(اجرای دوباره: «… به‌روزرسانی شد …».)

---

## گام ۳ — ورود ادمین از طریق API

در حالت توسعه (`NODE_ENV=development`) کد OTP **ثابت و برابر `123456`** است و در پاسخِ درخواست هم به‌صورت `devCode` برگردانده می‌شود (در production این کد تصادفی است و هرگز برنمی‌گردد).

### ۱) درخواست کد

```bash
curl -X POST http://localhost:4000/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone":"09120000001"}'
```

پاسخ (dev):

```json
{ "success": true, "data": { "phone": "09120000001", "expiresAt": "…", "devCode": "123456" } }
```

### ۲) تأیید کد و گرفتن توکن

```bash
curl -X POST http://localhost:4000/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"09120000001","code":"123456"}'
```

پاسخ شامل `tokens.accessToken` و `user.roles` خواهد بود:

```json
{ "success": true, "data": {
  "user": { "id": "…", "phone": "09120000001", "roles": ["admin"] },
  "tokens": { "accessToken": "eyJ…", "refreshToken": "…" }
} }
```

### ۳) فراخوانی endpointهای ادمین با توکن

`accessToken` را در هدر `Authorization: Bearer …` بگذارید:

```bash
TOKEN="<accessToken از مرحله قبل>"

curl http://localhost:4000/admin/reports \
  -H "Authorization: Bearer $TOKEN"
```

نمونه endpointهای ادمین (همه زیر `requireAdmin`):

| متد | مسیر | کار |
|-----|------|-----|
| GET | `/admin/reports` | آمار کلی پلتفرم |
| GET | `/admin/users?search=&role=&page=` | لیست کاربران |
| GET | `/admin/users/:id` | جزئیات کاربر |
| GET | `/admin/reservations?status=&from=&to=&page=` | لیست رزروها |
| GET | `/admin/reservations/:id` | جزئیات رزرو |
| GET | `/admin/salons` ، `/admin/stylists` | سالن‌ها / متخصص‌ها |
| GET | `/admin/audit-logs` | لاگ اقدامات ادمین |
| PATCH | `/admin/users/:id/status` | فعال/غیرفعال‌سازی کاربر |
| POST | `/admin/reservations/:id/cancel` | لغو رزرو توسط پشتیبانی |
| POST | `/admin/stylists/:id/promote` ، `/unpromote` | مدیریت پروموشن |

> هر کاربر غیرادمین این مسیرها را با `403 ADMIN_ONLY` و کاربر بدون توکن با `401` می‌گیرد.

---

## گام ۴ — ورود ادمین از فرانت‌اند (پنل `/admin`)

1. به صفحه‌ی ورود فرانت‌اند (`http://localhost:3000/auth/login`) بروید.
2. شماره‌ی ادمین (`09120000001`) را وارد کنید و «دریافت کد» را بزنید.
3. کد `123456` را وارد کنید (در dev روی همان صفحه به‌صورت «کد تست» هم نمایش داده می‌شود).
4. پس از ورود، چون نقش شما `admin` است به‌صورت خودکار به **`/admin`** هدایت می‌شوید.
   - در غیر این صورت می‌توانید مستقیماً به `http://localhost:3000/admin` بروید.
   - کاربری که نقش `admin` ندارد، حتی با باز کردن دستی `/admin` به صفحه‌ی اصلی ریدایرکت می‌شود و پنل را نمی‌بیند.

---

## نکات امنیتی

- **تنها راه ساخت ادمین، اسکریپت `seed:admin` است.** نقش `admin` در فهرست نقش‌های قابل‌خودانتساب نیست؛ `POST /onboarding/role` آن را رد می‌کند.
- همه‌ی مسیرهای `/admin` پشت `authenticate → requireAdmin` و یک rate-limiter هستند.
- اگر حساب ادمین (یا هر کاربری) غیرفعال شود (`isActive=false`)، احراز هویت او با `403 ACCOUNT_DISABLED` رد می‌شود.
- هر اقدامِ نوشتنیِ ادمین در `AuditLog` ثبت و از `GET /admin/audit-logs` قابل‌مشاهده است.
- در production مقدار `NODE_ENV=production` بگذارید تا کد OTP تصادفی شود و `devCode` در پاسخ برنگردد.
