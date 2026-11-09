# وضعیت افزونه کلاینت EFT Operations 1.9.1

## پیاده‌سازی شده در سورس
- پنل IMGUI با کلید F8
- دریافت مأموریت‌های منتشرشده از Router سفارشی SPT با پیشوند EFTOperations
- قبول مأموریت، نمایش گروه، Ready/Not Ready و خروج در حالت forming
- استفاده مستقیم از `SPT.Common.Http.RequestHandler.SessionId` و `RequestHandler.HttpClient` در SPT 3.11.1؛ بدون جستجوی عمومی/حدسی فیلدها
- استفاده از Backend URL تنظیم‌شده توسط خود SPT و prefix صحیح `/EFTOperations`
- استفاده از HTTP client رسمی SPT برای Cookie، فشرده‌سازی POST و رفتار TLS
- صف‌بندی درخواست‌ها برای جلوگیری از تداخل Mission List / Player State

## هنوز پیاده‌سازی نشده
- DLL کامپایل‌شده و تست‌شده روی ویندوز؛ سورس C# اصلاح شده اما در این محیط کامپایلر .NET موجود نیست
- HUD دائمی داخل Raid و اعلان‌های بازی
- راه‌اندازی/پیوستن خودکار Fika Raid و matchmaking واقعی
- ویدئو/صوت/اتاق سه‌بعدی و پخش هم‌زمان
- تأیید معتبر Kill/Extract و پرداخت جایزه

## نکات آزمون پذیرش
1. در ویندوز مسیرهای GameManagedDir و BepInExCoreDir را تنظیم و Build کنید.
2. ابتدا روی کپی آزمایشی SPT 3.11.1 نصب کنید.
3. بعد از ورود از SPT Launcher، F8 را بزنید.
4. اگر پیام session not found دیدید، خروجی BepInEx LogOutput و نسخه دقیق کلاینت را بررسی کنید؛ احراز هویت را با ارسال شناسه جعلی دور نزنید.
5. قبل از استفاده چندنفره، درخواست‌های `/EFTOperations/client/eft/operations/*` را روی localhost/VPN خصوصی بررسی کنید؛ Cookie را افزونه دستی نمی‌سازد و از HTTP Client خود SPT استفاده می‌کند.
