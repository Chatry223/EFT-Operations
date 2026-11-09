# SPT EconomyGuard Enterprise 1.6.0

**SPT 3.11.1 / EFT 0.16.1.3.35392 · Fika 2.4.x target · Economic Firewall + Local Admin Center + Login Access Control**

این نسخه برای ساختار Fika 2.4.3 و 2.4.6 بررسی شده و علاوه بر حفاظت اقتصادی و پنل محلی، ثبت‌نام لانچر، ورود حساب‌ها، Ban پروفایل، IP Allowlist و Live Online Players را کنترل می‌کند. کد احراز هویت و ساخت حساب بر اساس سورس SPT 3.11.1 نوشته شده است.

## نصب و ارتقا

1. SPT Server را کاملاً خاموش کن.
2. از این موارد Backup بگیر: `user/profiles/`، `user/mods/SPT-EconomyGuard/`، `user/mods/order.json` و کل `SPT-EconomyGuard-Data/`.
3. ZIP را در ریشه SPT استخراج کن و پوشه `user/mods/SPT-EconomyGuard/` را جایگزین کن.
4. پوشه `SPT-EconomyGuard-Data` قبلی را حذف نکن؛ حاوی پرونده‌ها، Ledger، توکن پنل، Banها و Approvalها است.
5. سرور را اجرا کن و در `SPT-EconomyGuard-Data/health.json` بررسی کن:
   - `accessControl.hooks.launcherRegistration`، `login` و `httpSessionAndIpGate` همگی `true` باشند.
   - `onlinePlayers.available` برابر `true` باشد و Hookهای `FikaPresenceService.addPlayerPresence` و `FikaPresenceService.removePlayerPresence` نصب شده باشند.
   اگر فقط بخش Online Presence فعال نبود، سایر قابلیت‌ها کار می‌کنند اما فهرست آنلاین Unavailable می‌ماند؛ اگر Hookهای Ban/Login/IP فعال نبودند به آن‌ها تکیه نکن و لاگ را بررسی کن.
6. پنل را در `http://127.0.0.1:6970/` باز کن و توکن `SPT-EconomyGuard-Data/admin.token` را وارد کن.

پنل فقط روی Loopback گوش می‌دهد. Port 6970 را به اینترنت عمومی باز نکن؛ برای مدیریت راه دور SSH tunnel یا VPN مدیریتی امن استفاده کن.

## EFT Operations — نسخه 1.6.0

در منوی پنل، بخش **Operations** برای ساخت مأموریت‌های نظامی اضافه شده است. مدیر می‌تواند نقشه، نوع Solo/Squad، ظرفیت گروه، زمان‌بندی، هدف‌ها، Briefing و امتیاز/روبل جایزه را تنظیم کند؛ مأموریت را به JSON خروجی بگیرد یا JSON آماده را وارد کند؛ و پس از بررسی، آن را Publish کند. انتشار مأموریت به‌صورت خودکار یک Event در فهرست اعلان‌های StatusBoard موجود ایجاد می‌کند. بخش Rank & Leaderboard و Award Ledger نیز در همان صفحه موجود است.

**مرز قابلیت این نسخه:** موتور ذخیره مأموریت، گروه و Ready state، ثبت پیشرفت سمت سرور و دفتر امتیاز پیاده‌سازی شده‌اند؛ اما اتصال رویدادهای واقعی Raid به SPT/Fika، HUD داخل بازی، Lobby/Host خودکار و تحویل خودکار پول/آیتم به Stash هنوز تکمیل نشده‌اند. روبل و آیتم‌ها با وضعیت `pending_delivery` ثبت می‌شوند و تا زمان تکمیل Adapter تحویل خودکار ندارند. گزارش پیشرفت کلاینت معتبر تلقی نمی‌شود. راهنمای کامل: `user/mods/SPT-EconomyGuard/OPERATIONS-README_FA.md`.

آزمون کامل این نسخه: `npm test` (۲۴ تست) و بررسی Syntax: `npm run check`.

## قابلیت‌های نسخه 1.2.0 و 1.2.1


### 1.2.1 — مشاهده بازیکنان آنلاین

بخش **Online Players** به پنل اضافه شده است و از Fika `FikaPresenceService` استفاده می‌کند:

- بازیکن وقتی به WebSocket اعلان‌های Fika وصل شود Online ثبت می‌شود.
- هنگام قطع WebSocket از فهرست Online حذف می‌شود؛ بنابراین فهرست از روی لاگ‌های قدیمی یا درخواست‌های Flea حدس زده نمی‌شود.
- نام کاربری، Nickname، Profile ID، Level، زمان اتصال و آخرین زمان مشاهده نشان داده می‌شود.
- وضعیت‌های Fika شامل `IN MENU`، `IN RAID`، `IN STASH`، `IN HIDEOUT` و `IN FLEA` نمایش داده می‌شوند.
- هنگام Raid، نقشه، Side و زمان Raid نمایش داده می‌شود.
- آخرین IP ثبت‌شده توسط SPT HTTP برای همان Profile ID نمایش داده می‌شود؛ این لزوماً IP همتای UDP در Fika نیست، چون NAT/VPN می‌تواند مسیر شبکه متفاوتی ایجاد کند.
- لیست هر ۱۵ ثانیه به‌روزرسانی می‌شود و جست‌وجو بر اساس نام، پروفایل، IP و نقشه دارد.

این قابلیت فقط وضعیت اتصال Presence را نشان می‌دهد؛ جایگزین Ban، Game Activity telemetry یا نمایش موقعیت بازیکن در Raid نیست. ساختار Presence در Fika 2.4.3 و 2.4.6 از همان متدهای `addPlayerPresence`، `updatePlayerPresence` و `removePlayerPresence` استفاده می‌کند. اگر Fika Presence Hook فعال نباشد، پنل به‌جای نمایش عدد صفرِ گمراه‌کننده وضعیت `Unavailable` نشان می‌دهد. اطلاعات Online فقط در حافظه نگهداری می‌شوند و بعد از Restart از نو از اتصال‌های واقعی Fika ساخته می‌شوند.

### 1) Ban ورود واقعی بر اساس Profile ID

- Ban با Profile ID انجام می‌شود، نه Nickname.
- Ban می‌تواند دائمی یا زمان‌دار باشد.
- هنگام Login، `LauncherController.login` شناسه پروفایل را پیدا می‌کند و قبل از تحویل Session آن را با Ban Registry تطبیق می‌دهد. حساب Ban شده از مسیر لانچر `FAILED` می‌گیرد و Session دریافت نمی‌کند.
- اگر بازیکن از قبل Session داشته باشد، Hook سرور HTTP، درخواست‌های بعدی Backend او را با 403 رد می‌کند.
- Unban از پنل انجام می‌شود و پروفایل یا آیتم‌هایش حذف نمی‌شود.
- Ban دسترسی، مستقل از `AUDIT/PROTECT` است و در هر دو حالت اجرا می‌شود؛ حالت Audit فقط مربوط به تشخیص اقتصادی است.

**محدودیت صریح Fika:** این Ban ورودهای بعدی و درخواست‌های SPT HTTP را می‌بندد، اما در Fika 2.4.6 نمی‌توانم ادعا کنم بازیکنی که در همان لحظه داخل Raid فعال P2P است فوراً از شبکه UDP بیرون انداخته می‌شود. در سورس تگ 2.4.6، `FikaMatchService.removePlayerFromMatch` حضور بازیکن را از ساختار Match و Presence حذف می‌کند؛ این به‌تنهایی اثبات قطع اتصال شبکه بازیکن نیست. Fika 2.4.6 نیز API رسمی `/fika/api/logout` را در ساختار کانفیگ/روترهای بررسی‌شده ارائه نمی‌کند. برای Kick از Raid فعال، Adapter اختصاصی Fika و تست یکپارچه جدا لازم است.

### 2) بستن ساخت حساب از لانچر SPT

- به‌صورت پیش‌فرض `allowLauncherRegistration=false` است.
- درخواست عادی ثبت‌نام لانچر از مسیر `LauncherCallbacks.register` با `FAILED` رد می‌شود.
- این کار جلوی ساخت حساب جدید از فرم Register در SPT Launcher را می‌گیرد.
- حساب‌های قدیمی به‌صورت پیش‌فرض همچنان می‌توانند Login کنند؛ برای اینکه فقط حساب‌های تأییدشده وارد شوند، گزینه `Require approved account` را در پنل فعال کن.

**تفاوت مهم:** ثبت‌نام لانچر، ساخت حساب SPT و Username/Password است. `client/game/profile/create` در داخل بازی، ساخت کاراکتر PMC/Scav برای حساب واردشده است و چیز دیگری است. کنترل ثبت‌نام لانچر و Approval حساب باعث می‌شود کاربر ناشناس نتواند با ساخت حساب تازه وارد مرحله ساخت کاراکتر شود.

### 3) ساخت حساب فقط از پنل

در **Security & Access → Create server account** مدیر می‌تواند:
- Username تعیین کند.
- Password قوی وارد یا تولید کند.
- Edition معتبر را از Editionهای واقعی SPT انتخاب کند.
- حساب را با `LauncherController.register` خود SPT ایجاد کند.
- همان پروفایل را به‌طور خودکار Approve کند.

نام‌کاربری و رمز یک بار پس از ساخت به مدیر نمایش داده می‌شوند. EconomyGuard رمز را در رجیستری خود ذخیره نمی‌کند؛ خود SPT در پروفایل حساب اطلاعات ورود را طبق ساختار داخلی‌اش ذخیره می‌کند. اطلاعات را فقط از یک کانال خصوصی به صاحب حساب بده.

### 4) Approval / Whitelist حساب‌ها

`Require approved account` را روشن کن تا فقط Profile IDهای موجود در `approvedProfiles` اجازه Login داشته باشند.

- حسابی که از پنل ساخته شود به‌صورت خودکار Approved است.
- حساب قدیمی را در جدول **Server accounts** با دکمه `Approve` تأیید کن.
- با `Revoke` مجوز ورود آن حساب را لغو کن.
- Ban و Revoke متفاوت‌اند: Ban تخلف و محرومیت است؛ Revoke یعنی حساب در لیست حساب‌های مجاز نیست.

**هشدار ضد قفل‌شدن مدیر:** قبل از روشن‌کردن Approval-only، حساب خودت و هر حساب مدیریتی/مجاز را Approve کن. اگر روشن شود و حساب خودت Approved نباشد، Login بازی خودت نیز رد می‌شود؛ خود پنل محلی همچنان از طریق توکن قابل استفاده است.

### 5) IP Allowlist

- پذیرش IPv4، IPv6 و CIDR مانند `203.0.113.25`، `203.0.113.0/24` و `2001:db8::/32`.
- Allowlist روی ورودی HTTP/HTTPS Backend SPT اعمال می‌شود؛ درخواست لانچر، Login و APIهای Backend از IPهای مجاز می‌آیند.
- Loopback محلی برای مدیریت و تست محلی باز می‌ماند.
- هدرهای `X-Forwarded-For` و `X-Real-IP` فقط وقتی معتبر شمرده می‌شوند که IP اتصال مستقیم در `trustedProxyIps` باشد. هدر جعلی از یک کلاینت عادی پذیرفته نمی‌شود.
- اگر IP عمومی/VPN بازیکن تغییر کند، تا وقتی IP جدید اضافه نشده باشد دسترسی Backend او قطع می‌شود.

**محدودیت شبکه Fika:** IP Allowlist این مود روی SPT HTTP Backend اعمال می‌شود؛ فایروال UDP مربوط به اتصال مستقیم Raid در Fika نیست. برای محدودکردن آدرس‌های Raid باید Firewall سیستم‌عامل/شبکه و پیکربندی پورت‌های Fika جداگانه تنظیم شود. IP به‌تنهایی معیار مناسبی برای Ban یک نفر نیست، چون NAT و VPN ممکن است چند بازیکن را پشت یک IP مشترک قرار دهند؛ برای Ban از Profile ID استفاده کن.

## روش پیشنهادی پیکربندی

### شروع امن (پیشنهادی)

- `Allow standard launcher registration`: خاموش
- `Require approved account`: ابتدا خاموش؛ پس از Approve کردن حساب مدیر و دوستان مجاز، روشن
- `Enforce IP allowlist`: خاموش، تا وقتی همه IPهای پایدار/ VPN را جمع نکرده‌ای

این تنظیم، ثبت‌نام جدید را از لانچر می‌بندد، ولی فعلاً حساب‌های قدیمی را بدون قفل اضافه نگه می‌دارد. برای سرور بسته و فقط دعوتی، Approval-only را پس از آماده‌سازی لیست فعال کن.

### Fika launcher visibility

تنظیم Fika `launcherListAllProfiles=false` می‌تواند پروفایل‌های دیگران را از فهرست لانچر پنهان کند؛ این فقط کنترل نمایش است و جایگزین قفل ثبت‌نام یا Approval/Whitelist نیست. تنظیمات Fika را مستقل از EconomyGuard نگه دار.

## محل ذخیره امنیت و اطلاعات

```text
SPT-EconomyGuard-Data/
├── admin.token
├── health.json
├── security/
│   └── access-control.json
├── logs/
├── ledger/
├── cases/
├── reports/
├── policies/
│   ├── restrictions.json
│   └── usage/
└── backups/
```

`security/access-control.json` شامل این اطلاعات است:
- تنظیم ثبت‌نام، Approval و IP Allowlist
- Banهای Profile ID با دلیل و Expiry
- Profile IDهای Approved
- IPهای مشاهده‌شده اخیر و رخدادهای امنیتی

این فایل و `admin.token` را محرمانه نگه دار. پوشه داده را در Windows ACL فقط برای حساب مدیر و حسابی که SPT Server را اجرا می‌کند قابل دسترسی کن.

### خرابی رجیستری امنیتی

اگر `access-control.json` خراب یا JSON نامعتبر شود:
- کپی خراب با پسوند `.corrupt-....bak` حفظ می‌شود.
- درخواست‌های غیرمحلی به‌صورت Fail-closed رد می‌شوند؛ سیستم به‌خاطر خالی‌بودن لیست، ناخواسته عمومی باز نمی‌شود.
- فایل خراب را کورکورانه با تنظیمات جدید overwrite نکن. سرور را خاموش کن، نسخه پشتیبان معتبر را Restore کن. اگر نسخه معتبر نداری، پس از نگهداری فایل `.bak` و تصمیم آگاهانه، فایل خراب را تغییرنام بده/حذف کن و سرور را روشن کن تا رجیستری خالی جدید ساخته شود؛ این کار Banها و Approvalهای قبلی را بازیابی نمی‌کند.

## Fika 2.4.6 و محدودیت Kick

سورس رسمی تگ `v2.4.6` در `IFikaConfigServer` فیلدهایی مانند `launcherListAllProfiles` و `allowItemSending` دارد، اما API Key یا endpoint `fika/api/logout` در این تگ بررسی‌شده وجود ندارد. مستندات جدید Fika که `fika/api/logout` را معرفی می‌کنند، خودشان API را برای SPT 4.0 / Fika 2.0 به‌روزرسانی‌شده معرفی می‌کنند؛ نمی‌توان آن را بدون بررسی به Fika 2.4.6 نسبت داد.

در یکی از لاگ‌های قبلی `server version: 2.4.3` دیده شده بود، در حالی‌که نسخه فایل اعلام‌شده 2.4.6 بود. متدهای Fika Presence در هر دو تگ بررسی شدند؛ با این حال بعد از نصب نسخه جدید، شماره واقعی `server version` را در لاگ Startup بررسی کن. این افزونه روی Hookهای SPT 3.11.1 کار می‌کند، اما قابلیت‌های ویژه Fika به بیلد واقعاً بارگذاری‌شده وابسته‌اند؛ تست کامل یکپارچه روی Fika نصب‌شده تو هنوز انجام نشده است.

## تست و بررسی سلامت

در `health.json` باید این Hookها `true` باشند:
- `LauncherCallbacks.register`
- `LauncherController.login`
- `HttpServer.handleRequest`

اگر هرکدام `false` باشد، روی ثبت‌نام، Login یا IP/session gate مربوط به آن Hook تکیه نکن و لاگ هشدار را بررسی کن.

Node.js باید در PATH باشد. در PowerShell از داخل پوشه مود اجرا کن:

```powershell
Get-ChildItem .\tests\*.test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Test failed: $($_.Name)" } }
```

تست‌های محلی جایگزین تست یکپارچه روی Windows + SPT 3.11.1 + Fika نصب‌شده و کل مودهای سرور نیستند. ابتدا روی کپی سرور و با دو حساب آزمایشی امتحان کن: یکی Approved، یکی Not Approved، یک Ban دائم/موقت، یک درخواست register عادی و یک IP خارج از Allowlist.

## محدودیت‌های دیگر فعلی

- Fika Item Sending در این Build Hook نشده؛ برای بستن آن مسیر، `allowItemSending=false` را در `fika.jsonc` تنظیم کن.
- Ban فعلی از ورود و درخواست‌های Backend جلوگیری می‌کند؛ قطع فوری UDP یک Raid از قبل فعال در Fika 2.4.6 تضمین نشده است.
- Fence هنوز سقف مطلق ۵۰ میلیون روبل دارد؛ ارزش‌گذاری کامل موجودی Scav کامل نشده است.
- پنل محلی از Node.js داخلی استفاده می‌کند و npm dependency خارجی ندارد.

### 1.3.0 / 1.4.0 — سایت عمومی وضعیت سرور
یک سایت فقط‌خواندنی و جدا از پنل ادمین برای نمایش رتبه‌بندی، آنلاین‌ها، ریدها، فلی‌مارکت و رویدادها. جزئیات و محدودیت‌ها در `STATUS_BOARD_GUIDE_FA.md`.


## نسخه 1.7.0

- صف بررسی Raid برای نتایج تأییدنشده؛ بدون پاداش خودکار تا تصمیم مدیر.
- کنترل اجباری حالت Solo/Squad و بازه زمانی مأموریت.
- بستن مأموریت، Event متناظر StatusBoard را نیز غیرفعال می‌کند.
- نگهداری نسخه پشتیبان از فایل داده خراب Operations.
- بررسی سورس رسمی Fika Server v2.4.8 (سازگار اعلام‌شده با SPT 3.11) برای طراحی Adapter؛ هنوز Hook اجرایی فعال نشده است.


**مرز اعتماد Raid:** بررسی سورس SPT 3.11.1 نشان داد نتیجه خروج (`result`, `exitName`, `playTime`) داخل درخواست `/client/match/local/end` از کلاینت ارسال می‌شود و سپس توسط سرور پردازش می‌شود؛ این به‌تنهایی اثبات رمزنگاری‌شده ضدتقلب نیست. بنابراین نتیجه تأییدنشده در صف بررسی می‌ماند و برای شمارش Kill/Collect به منبع Telemetry قابل اعتماد جداگانه نیاز است.


## اتصال Fika 2.4.3
نسخه 1.7.1 نسخه واقعی موجود در آرشیو کتابخانه را هدف می‌گیرد: Fika Server 2.4.3 و پلاگین کلاینت Fika.Core 1.2.3. تب «Fika Link» در Operations رویدادهای پایان Raid و پایان Match را به‌صورت فقط‌خواندنی ثبت می‌کند. این داده‌ها به‌عنوان گزارش غیرقابل‌اعتماد کلاینت برچسب می‌خورند و به‌تنهایی باعث تکمیل مأموریت یا اعطای جایزه نمی‌شوند. برای جزئیات به `FIKA-INTEGRATION-NOTES.md` مراجعه کنید.


## EFT Operations 1.8.0

پل بازیکن از طریق Router احراز هویت‌شده SPT اضافه شد: نمایش مأموریت‌های فعال، قبول مأموریت، Ready Check گروه، خروج از گروه در حالت تشکیل و مشاهده رتبه/وضعیت. هویت از نشست SPT و PMC سمت سرور استخراج می‌شود. این نسخه هنوز HUD داخل بازی یا اتصال کامل Lobby فیکا ندارد و هیچ پیشرفت Raid یا جایزه‌ای را از سمت کلاینت قبول نمی‌کند.


## EFT Operations 1.9.1 — افزونه کلاینت

سورس پلاگین BepInEx در پوشه `client/EFT.Operations.Client` اضافه شد. رابط با کلید F8 باز می‌شود و فهرست مأموریت، قبول مأموریت، اعضای گروه، Ready/Not Ready و خروج از گروه قبل از شروع را ارائه می‌کند. پروژه برای SPT 3.11.1 و BepInEx نصب‌شده در آرشیو شما هدف‌گذاری شده است.

این نسخه DLL کامپایل‌شده تحویل نمی‌دهد: محیط فعلی فاقد .NET SDK/کامپایلر ویندوز است. ساخت DLL باید در Visual Studio ویندوز و با مسیر واقعی `EscapeFromTarkov_Data/Managed` و `BepInEx/core` انجام شود. احراز PHPSESSID با Reflection در بازی واقعی هنوز نیازمند آزمون است.
