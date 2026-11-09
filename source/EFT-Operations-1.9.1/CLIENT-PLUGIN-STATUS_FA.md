# وضعیت افزونه کلاینت EFT Operations 1.9.1

## پیاده‌سازی شده در سورس
- پنل IMGUI با کلید F8
- HUD فشرده مأموریت فعال هنگام Raid، شامل عنوان، نقشه، Briefing، اهداف و پاداش اعلام‌شده
- اعلان بالای صفحه هنگام ورود گروه به Raid و هنگام پایان نشست با وضعیت «در انتظار بررسی مدیر»
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


## Fika 2.4.3 native host bridge

- The client checks the loaded BepInEx plugin metadata for `com.fika.core` and requires version `2.4.3`.
- For the installed Fika client `Fika.Core.dll 1.2.3`, the bridge reads the exact `MatchMakerUIScript` fields `fikaMatchMakerUi` and `raidSettings`; it retains fallbacks for later field names. This was checked against the upstream `v1.2.3` source, not inferred from a newer release.
- It locates the existing `Fika.Core.UI.Custom.MatchMakerUIScript` and its native `MatchMakerUI.StartButton` using reflection; it does not create a fake Fika match or bypass Fika's Force IP / Force Bind IP checks.
- The action is available only to the authenticated squad leader when the server reports all required members ready and the selected EFT `RaidSettings.SelectedLocation._Id` matches the mission map.
- Squad members still use Fika's normal raid browser to join the host; after the match roster is observed, the server adapter links the mission group.
- The BepInEx config `Hidden.Last Version` value is a hidden config migration marker and is not reliable proof of the installed plugin version. Runtime plugin metadata is authoritative.
