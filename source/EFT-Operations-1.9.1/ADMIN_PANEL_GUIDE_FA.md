# راهنمای Admin Center — EconomyGuard 1.4.0

## باز کردن پنل و ورود

1. سرور را اجرا کن.
2. `http://127.0.0.1:6970/` را باز کن.
3. توکن داخل `SPT-EconomyGuard-Data/admin.token` را Paste کن. توکن را به کسی نده.
4. در بخش Security & Access، وضعیت Hookها را از `health.json` و پنل بررسی کن.

## ساخت حساب دعوتی از پنل

1. وارد **Security & Access** شو.
2. بخش **Create server account** را باز کن.
3. Username بساز (۳ تا ۳۲ نویسه شامل حروف، عدد، `_`، `.` و `-`).
4. Password حداقل ۱۲ نویسه وارد کن یا از Generate استفاده کن.
5. یکی از Editionهای واقعی SPT را انتخاب کن.
6. `Create account & approve` را بزن.
7. Username/Password/Profile ID فقط پس از ساخت نمایش داده می‌شوند؛ آن‌ها را کپی و از کانال خصوصی به همان شخص بده.

این ساخت حساب از API داخلی `LauncherController.register` خود SPT استفاده می‌کند. پروفایل با فرمت داخلی SPT ساخته و ذخیره می‌شود؛ EconomyGuard JSON پروفایل را به‌صورت دستی تولید نمی‌کند.

## بستن ثبت‌نام عادی لانچر

در Access policy، گزینه **Allow standard launcher registration** را خاموش نگه دار. در این حالت درخواست Register که از SPT Launcher ارسال می‌شود، قبل از ساخت حساب رد می‌شود. حساب‌هایی که از پنل ساخته شوند همچنان مجازند.

اگر این گزینه را روشن کنی، ثبت‌نام عادی دوباره باز می‌شود؛ در این حالت اگر Approval-only روشن باشد، ثبت‌نام موفق جدید به‌صورت خودکار Approved می‌شود.

## بستن ورود همه حساب‌های تأییدنشده

۱. ابتدا در جدول **Server accounts** حساب مدیر و تمام حساب‌های مجاز قدیمی را با `Approve` تأیید کن.
۲. سپس **Require approved account** را روشن کن.
۳. هر پروفایل که در `approvedProfiles` نباشد، در Login با `ACCOUNT_NOT_ALLOWLISTED` رد می‌شود.

قبل از روشن‌کردن این گزینه، حساب خودت را حتماً تأیید کن. خاموش‌کردن آن، این Gate را از ورودهای بعدی برمی‌دارد اما Banها را پاک نمی‌کند.


## Online Players — مشاهده بازیکنان متصل

1. از منوی سمت چپ **Online Players** را باز کن.
2. تعداد بازیکنان آنلاین، تعداد افراد داخل Raid، منو و سایر فعالیت‌ها در کارت‌های بالای صفحه نمایش داده می‌شود.
3. جدول نام کاربری، Nickname، Level، Profile ID، وضعیت فعالیت، زمان اتصال، آخرین مشاهده و آخرین IP شناخته‌شده را نشان می‌دهد.
4. برای بازیکن داخل Raid، نام Map، Side (PMC/Scav) و زمان Raid نیز نمایش داده می‌شود.
5. Profile ID را می‌توانی با کلیک روی آن کپی کنی.
6. صفحه هر ۱۵ ثانیه به‌روز می‌شود؛ با Refresh هم می‌توانی دستی تازه‌سازی کنی.

**منبع Online:** وضعیت از سرویس `FikaPresenceService` گرفته می‌شود. Fika هنگام اتصال WebSocket اعلان‌ها، Profile ID را وارد فهرست Presence می‌کند و هنگام قطع WebSocket آن را حذف می‌کند. وضعیت‌های فعالیت Fika عبارت‌اند از `IN MENU`، `IN RAID`، `IN STASH`، `IN HIDEOUT` و `IN FLEA`. این روش از شمردن درخواست‌های HTTP یا جست‌وجوی آخرین لاگ مطمئن‌تر است. ساختار سه متد Presence در Fika 2.4.3 و 2.4.6 بررسی شده است.

**محدودیت:** IP نمایش‌داده‌شده آخرین IP دیده‌شده در درخواست HTTP سمت SPT است و لزوماً IP اتصال مستقیم UDP در Raid نیست. اگر WebSocket اعلان Fika وصل نشده باشد، یا Hookهای Presence در `health.json` فعال نباشند، پنل `Fika Presence Unavailable` نشان می‌دهد و آنلاین بودن را حدس نمی‌زند. فهرست فقط در حافظه است و با Restart از نو پر می‌شود.

## Ban دائمی/زمان‌دار

1. Profile ID بازیکن را از جدول Server accounts یا پرونده‌ها بردار.
2. در **Ban a profile** وارد کن.
3. Duration را Permanent، مدت ثابت یا تاریخ دلخواه انتخاب کن.
4. علت را بنویس و `Ban account` را بزن.

Ban از Login جدید جلوگیری می‌کند. درخواست‌های Backend یک Session قبلی هم در HTTP Server با 403 رد می‌شوند. با `Unban` Ban برداشته می‌شود؛ این کار به معنی Approve خودکار نیست، پس اگر Approval-only روشن است باید حساب Approved هم باشد.

**Raid از قبل فعال:** به‌دلیل ساختار Fika 2.4.6، این نسخه تضمین Kick فوری از ارتباط UDP داخل Raid را نمی‌دهد؛ برای قطع یک بازیکن داخل Raid فعال نیاز به Adapter مخصوص Fika/تست شبکه مجزا است.

## IP Allowlist

- IP دقیق یا CIDR را وارد کن، مثل `203.0.113.8` یا `203.0.113.0/24`.
- ابتدا IP واقعی خودت/بازیکنان را از Recent connection IPs ببین یا با `Allow IP` به لیست اضافه کن.
- سپس Enforce IP allowlist را روشن کن.
- اگر IP/VPN بازیکن عوض شود، باید IP جدید را اضافه کنی.
- `trustedProxyIps` فقط برای Proxyهایی است که واقعاً تحت مدیریت خودت هستند. بدون Reverse Proxy مقدار آن را خالی بگذار.

این کنترل روی SPT HTTP Backend است، نه UDP مستقیم Raid. از IP مشترک به‌عنوان دلیل Ban پروفایل استفاده نکن؛ برای محرومیت یک شخص Profile ID را Ban کن.

## فایل امنیتی

مسیر: `SPT-EconomyGuard-Data/security/access-control.json`

شامل تنظیمات Registration و Approval، Banها، Approved profileها، Recent IPها و Audit امنیتی است. معمولاً بهتر است همه تغییرات از پنل انجام شوند. قبل از ویرایش دستی، سرور را خاموش و از فایل کپی بگیر.

اگر رجیستری خراب باشد، کپی `.corrupt-*.bak` ساخته می‌شود و ترافیک غیرمحلی Fail-closed می‌شود. رجیستری خراب را بی‌بررسی overwrite نکن؛ از فایل معتبر Backup برگردان.

## تفاوت با گزینه Fika `launcherListAllProfiles`

`launcherListAllProfiles=false` فقط پروفایل دیگران را از فهرست لانچر پنهان می‌کند. این گزینه Register یا Login را امن نمی‌کند. برای محدودیت واقعی، `Allow standard launcher registration` و `Require approved account` خود EconomyGuard را تنظیم کن.

## دسترسی از راه دور

پنل فقط روی `127.0.0.1` اجرا می‌شود. از SSH port-forward یا VPN مدیریتی امن استفاده کن؛ Port 6970 را عمومی نکن:

```bash
ssh -N -L 6970:127.0.0.1:6970 admin@SERVER_ADDRESS
```

سپس روی رایانه خودت `http://127.0.0.1:6970/` را باز کن.
