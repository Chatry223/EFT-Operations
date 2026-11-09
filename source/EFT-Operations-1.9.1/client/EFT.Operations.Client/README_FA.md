# EFT Operations Client — افزونه BepInEx

این پروژه سورس افزونه کلاینت برای EFT/SPT 3.11.1 است. رابط با کلید F8 باز می‌شود و فهرست مأموریت، قبول مأموریت، اعضای گروه، Ready Check و خروج از گروه در مرحله تشکیل را نمایش می‌دهد.

## نصب سورس و ساخت در ویندوز

1. Visual Studio 2022 با workload مربوط به .NET desktop و .NET Framework 4.7.2 Developer Pack را نصب کنید.
2. پروژه `EFT.Operations.Client.csproj` را باز کنید.
3. مسیرهای `GameManagedDir` و `BepInExCoreDir` را به مسیر نصب واقعی SPT خود تنظیم کنید.
4. Build را روی Release اجرا کنید.
5. خروجی `EFTOperations.Client.dll` را در `BepInEx/plugins/EFTOperations/` قرار دهید.
6. بازی را با SPT Launcher اجرا کنید و پس از ورود، F8 را بزنید.

## تنظیم سرور و احراز هویت

نیازی به تنظیم جداگانه IP سرور یا Cookie نیست. افزونه از همان Backend URL و نشست ورود استفاده می‌کند که SPT Launcher به بازی می‌دهد.

پل ارتباطی دقیقاً از API عمومی SPT 3.11.1 استفاده می‌کند:

- `SPT.Common.Http.RequestHandler.SessionId` برای توکن نشست
- `SPT.Common.Http.RequestHandler.Host` برای Backend URL
- `SPT.Common.Http.RequestHandler.HttpClient` برای ارسال درخواست با Cookie استاندارد `PHPSESSID`

در نتیجه درخواست‌ها از HTTP Client خود SPT عبور می‌کنند؛ فشرده‌سازی POST و رفتار گواهی HTTPS نیز مانند درخواست‌های عادی بازی است. مسیرهای افزونه با پیشوند `/EFTOperations` فراخوانی می‌شوند. اگر SPT session یا HTTP client در دسترس نباشد، درخواست متوقف و خطای روشن در پنل/لاگ ثبت می‌شود؛ هیچ شناسه یا توکن ساختگی تولید نمی‌شود.

برای سرور راه دور، همان Backend URL امنی را تنظیم کنید که برای اتصال SPT/Fika استفاده می‌کنید؛ ترجیحاً VPN خصوصی.

## محدوده این نسخه

- دارد: فهرست مأموریت، Accept، وضعیت گروه، Ready / Not Ready، Leave قبل از شروع.
- ندارد: HUD دائمی بالای صفحه، پنجره سه‌بعدی، پخش ویدئو/صوت، دعوت/چت بازیکن، شروع خودکار Raid در Fika، یا ثبت Kill/Extract و جایزه.
- `canStart=true` فقط اعلام می‌کند اعضا Ready هستند؛ این نسخه عمداً Raid را خودکار Start نمی‌کند.
- این سورس در محیط فعلی کامپایل نشده است؛ برای ساخت DLL باید در Visual Studio روی ویندوز و با اسمبلی‌های واقعی نصب شما Build شود.
- پل احراز هویت اکنون به قرارداد تأییدشده SPT 3.11.1 متکی است؛ با این حال تا اجرای DLL روی EFT build هدف، تست runtime محسوب نمی‌شود.
