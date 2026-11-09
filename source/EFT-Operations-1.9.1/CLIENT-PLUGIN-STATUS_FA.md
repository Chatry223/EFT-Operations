# وضعیت افزونه کلاینت EFT Operations 1.9.1

## پیاده‌سازی‌شده در سورس
- پنل IMGUI با کلید F8
- HUD فشرده مأموریت فعال هنگام Raid شامل عنوان، نقشه، رتبه، امتیاز، Briefing، اهداف و پاداش اعلام‌شده
- اعلان شروع و پایان نشست Fika؛ پایان نشست با وضعیت «در انتظار بررسی مدیر»
- دریافت مأموریت‌ها و وضعیت گروه از Router اختصاصی SPT با پیشوند `/EFTOperations`
- قبول مأموریت، نمایش گروه، Ready/Not Ready و خروج پیش از شروع
- تشخیص نشست SPT با استفاده از قرارداد واقعی `SPT.Common.Http.RequestHandler`
- استفاده از `Host`، `SessionId` و `HttpClient` خود SPT برای Cookie، فشرده‌سازی POST و Backend URL تنظیم‌شده
- بررسی نسخه Fika Client از Plugin Metadata و استفاده از UI بومی Fika 1.2.3 برای Start توسط رهبر آماده گروه
- بررسی نقشه انتخاب‌شده در `RaidSettings.SelectedLocation._Id` پیش از اجرای Start بومی Fika

## اصلاح فنی انجام‌شده در پل SPT
در سورس SPT 3.11.x مشخص شد:
- namespace نوع: `SPT.Common.Http.RequestHandler`
- نام اسمبلی واقعی: `spt-common` (نه `SPT.Common`)
- فیلدهای استاتیک واقعی: `Host`، `SessionId`، `HttpClient`
- متدهای HTTP واقعی در `SPT.Common.Http.Client`: `GetAsync(string)` و `PostAsync(string, byte[], bool)`

پل کلاینت اصلاح شد تا ابتدا اسمبلی‌های از قبل بارگذاری‌شده را بررسی کند و سپس با نام صحیح `spt-common` بارگذاری کند. این پل از یک Session ID ساختگی یا HTTP Client جداگانه استفاده نمی‌کند.

## Build گرافیکی
فایل اجرا:
`client/EFT.Operations.Client/BUILD-GUI.bat`

در GUI:
1. **Load bundled ZIPs** آرشیوهای منبع را در Cache محلی با کلید Hash استخراج می‌کند.
2. مسیر واقعی نصب BepInEx باید جداگانه در فیلد سوم انتخاب شود؛ DLL هرگز داخل Cache موقت نصب نمی‌شود.
3. **Build and Install DLL** با MSBuild و NuGet Restore کامپایل می‌کند، DLL قبلی را Backup می‌گیرد و گزارش SHA-256 می‌نویسد.

کنترل‌ها:
- Hash دقیق `Assembly-CSharp.dll`، `Fika.Core.dll` و `spt-common.dll`
- Fika Core assembly version برابر `1.2.3.0`
- SPT Common assembly version برابر `3.11.1.0`
- وجود فایل پیکربندی Fika با marker نسخه `1.2.3`

GitHub Actions آرشیوها را بررسی و روی Windows Hosted Runner کامپایل کرده است. پس از افزودن `/restore`، Build در commit `f6e2441c6ffd825b68d4e41effadcb47671e3e1e` موفق شد.

- حجم DLL: 27,136 بایت
- SHA-256: `276ecad202e8ccf473b52c2d6ff8f1b17a7bd2d7ed0ba1909a2c76928f1fcd1f`
- Artifact: [دانلود از GitHub Actions](https://github.com/Chatry223/EFT-Operations/actions/runs/42687196015/artifacts/13704528374)

این نتیجه Build را تأیید می‌کند؛ تست Runtime داخل بازی و نصب روی پوشه واقعی SPT هنوز انجام نشده است.

## هنوز تکمیل نشده
- پیشرفت زنده و معتبر برای Kill / Loot / Visit / Extract؛ سرویس `recordRaidEvent` وجود دارد، اما Adapter تولیدی هنوز رویداد Objective به آن نمی‌فرستد.
- تأیید خودکار مأموریت و پرداخت خودکار جایزه بر اساس داده‌های کلاینت
- Kick فوری از Raid فعال Fika
- تست Runtime واقعی در بازی با دو کلاینت و یک سرور Fika

## آزمون پذیرش پس از Build
1. DLL را روی کپی آزمایشی SPT 3.11.1 نصب کنید.
2. بازی را از SPT Launcher اجرا و وارد پروفایل شوید.
3. F8 را باز کنید و دریافت مأموریت و وضعیت گروه را بررسی کنید.
4. در Fika 1.2.3 رهبر باید فقط پس از Ready شدن همه اعضا و تطبیق نقشه بتواند Start بزند.
5. پایان Raid باید گروه را به صف بررسی مدیر ببرد؛ نباید از گزارش کلاینت جایزه خودکار پرداخت شود.
6. خطاهای احتمالی را از `BepInEx/LogOutput.log` و لاگ SPT جمع‌آوری کنید.
