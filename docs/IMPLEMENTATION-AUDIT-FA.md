# ممیزی اجرایی و نقشه توسعه EFT Operations

**تاریخ ممیزی:** ۱۳ نوامبر ۲۰۲۶  
**شاخه:** main  
**Commit بررسی‌شده:** 37f591e49fc7d2d13ef789d9387484bee5570dc3

## ۱. نتیجه صریح ممیزی

پروژه فقط پایه‌ریزی یا طرح اولیه نیست. هسته عملیاتی مأموریت، API احراز هویت‌شده، پنل مدیریت، رابط داخل بازی، اتصال گروه به Fika، کمپین/رتبه، ثبت شواهد، صف بررسی مدیر و دفتر پاداش در سورس وجود دارند.

اما پروژه هنوز نسخه نهایی و Runtime-verified نیست. سه مرز مهم باید شفاف بمانند:

1. تعدادی از رویدادها به کد واقعی متصل شده‌اند، ولی سطح اعتمادشان host_attested یا spt_accepted_client_delta است؛ هیچ‌کدام به‌تنهایی اثبات مستقل سرور برای پرداخت پاداش نیستند.
2. پایان Raid در Adapter عمداً با verified=false تمام می‌شود و به صف بررسی مدیر می‌رود. پرداخت خودکار از گزارش‌های کلاینت فعال نیست.
3. تست کامل داخل EFT/Fika، تست واقعی تحویل Mail و آزمون هم‌زمان کل Mod Stack هنوز انجام نشده است. CI نسخه فعلی نیز سبز نیست.

وضعیت درست پروژه «هسته عملیاتی پیاده‌سازی‌شده با بخش‌های مهم ناقص و نیازمند اعتبارسنجی» است؛ نه «فقط اسکلت»، و نه «ماد کامل و آماده انتشار».

## ۲. محیط هدف و سازگاری

| جزء | نسخه هدف/مشاهده‌شده | وضعیت بررسی |
|---|---|---|
| EFT | 0.16.1.3.35392-P2P | اسمبلی‌های بازی بررسی شده‌اند |
| Unity | 2022.3.43f1 | از نسخه UnityPlayer.dll |
| SPT Server | 3.11.1 | سورس و بسته سرور بررسی شده |
| Fika Server | 2.4.3 | Manifest هدف ~3.11 |
| Fika Client | 1.2.3.0 | اسمبلی و تنظیمات BepInEx بررسی شده |
| SPT Common | 3.11.1.0 | Assembly metadata بررسی شده |
| BepInEx | 5.4.22.0 | Assembly metadata بررسی شده |
| Client Plugin | .NET Framework 4.7.2 / C# 7.3 | انتخاب هدف با اسمبلی‌های مرجع سازگار است |

نسخه‌های Server و Client مربوط به Fika دو شاخه مستقل هستند و نباید با هم اشتباه شوند. Client از Reflection برای یافتن APIهای داخلی EFT/Fika/SPT استفاده می‌کند؛ Build helper آرشیوهای مرجع را از نظر Hash و نسخه بررسی می‌کند. این بررسی، موفقیت بارگذاری در Mono واقعی بازی را اثبات نمی‌کند.

Manifestهای Modهای موجود در بسته واقعی سرور با خط SPT 3.11 هم‌خوانی دارند:

- Fika Server 2.4.3
- SVM 1.11.1
- LootingBots ServerMod 1.5.2
- WTT-PackNStrap 1.1.13
- SAIN ServerMod 2.3.0
- LiveFleaPrices 1.5.2
- EconomyGuard 1.9.1

این نتیجه فقط سازگاری اعلام‌شده در Manifest است؛ تضمین نبود تداخل Runtime نیست.

## ۳. معماری واقعی فعلی

| لایه | فایل/ماژول اصلی | مسئولیت فعلی |
|---|---|---|
| راه‌اندازی Server | src/mod.js | ثبت سرویس‌ها و Hookها، ساخت سرویس مأموریت، Fika، SVM، پاداش و پنل |
| Mission Core | src/operations/service.js | چرخه مأموریت، کمپین، گروه، Ready، پیشرفت، بررسی و Award |
| Player API | src/operations/client-api.js | APIهای SPT با هویت استخراج‌شده از Session معتبر |
| Fika Adapter | src/operations/fika243-adapter.js | اتصال Match، اعضا، Raid lifecycle و دریافت شواهد |
| Reward Delivery | src/operations/reward-delivery.js | ثبت Award و ارسال پاداش از طریق SPT Mail |
| Admin API | src/admin-panel.js | مدیریت مأموریت، Review، Award، Fika، SVM و EconomyGuard |
| Admin UI | web/operations-admin.js | ساخت/انتشار مأموریت، تنظیم SVM و بررسی Raid |
| Client Plugin | client/EFT.Operations.Client/Plugin.cs | پنل F8، HUD، اعلان، Ready و اتصال میزبان Fika |
| Public Board | ماژول StatusBoard | ساخت Event عمومی هنگام انتشار مأموریت و غیرفعال‌کردن آن هنگام بستن |

Admin Panel به Loopback محدود شده و API آن Bearer Token می‌خواهد. Player API شناسه حساب را از sessionId و SaveServer به‌دست می‌آورد؛ شناسه خصوصی Profile به خروجی عمومی گروه/کلاینت افشا نمی‌شود.

## ۴. گردش‌کار فعلی مأموریت، از ابتدا تا پاداش

1. مدیر در پنل یک Draft می‌سازد: عنوان، توضیح، Map ID، Solo/Squad/Either، حداقل/حداکثر نفرات، زمان، Campaign، ترتیب، حداقل امتیاز، Objective و Reward.
2. مدیر مأموریت را Publish می‌کند. سیستم آن را در API بازیکن منتشر می‌کند و در صورت اتصال StatusBoard یک Event عمومی می‌سازد.
3. Client از طریق SPT Session معتبر، مأموریت‌ها و وضعیت بازیکن را می‌گیرد؛ بازیکن مأموریت را قبول می‌کند.
4. اعضای گروه Ready می‌شوند. رهبر فقط وقتی شرایط آماده‌بودن برقرار است می‌تواند از صفحه Native مربوط به Fika درخواست Start بدهد.
5. Client میزبان، دکمه Native شروع Fika را در صفحه Host فراخوانی می‌کند؛ Map باید با مأموریت منطبق باشد. اعضای دیگر از Raid List خود Fika وارد می‌شوند؛ Auto-join برای اعضا پیاده‌سازی نشده است.
6. Fika Adapter وقتی اعضای پذیرفته‌شده در همان Match و Map حاضر باشند، گروه را به Raid متصل می‌کند.
7. رویدادها/گزارش‌ها با سطح اعتماد مشخص ثبت می‌شوند و HUD مقدار پیشرفت و نوع شواهد را نشان می‌دهد.
8. پایان Match گروه را به Review می‌فرستد. مدیر شواهد را بررسی و با یادداشت و تأیید صریح Approve یا Deny می‌کند.
9. بعد از Approve، امتیاز در Ledger ثبت می‌شود و پاداش روبل/آیتم از مسیر Mail سرویس SPT ارسال می‌شود. وضعیت تحویل نامطمئن به delivery_attention_required می‌رود و Retry خودکار ندارد.
10. Award تأییدشده، رتبه و دسترسی به مرحله بعدی Campaign را به‌روزرسانی می‌کند.

## ۵. منابع واقعی Objective و مرز اعتماد

| Objective | منبع متصل در سورس | Trust | نتیجه |
|---|---|---|---|
| kill / kill_type | Hook کلاینت میزبان روی EFT.Player.OnBeenKilledByAggressor | host_attested | میزبان AI victim و مهاجم غیر-AI را می‌بیند؛ سرور هویت میزبان/عضو/Match و هدف را کنترل می‌کند |
| visit | Hook کلاینت میزبان روی EFT.Player.SpecialPlaceVisited(string,int) | host_attested | Place keyهای موردنیاز مأموریت از میزبان گزارش می‌شوند |
| collect | Snapshot قبل Raid و اختلاف Inventory پذیرفته‌شده توسط SPT در پایان Raid | spt_accepted_client_delta | فقط آیتم‌های دارای شناسه در پروفایل پذیرفته‌شده SPT و Delta قابل‌قبول شمرده می‌شوند؛ منشأ اولیه داده همچنان گزارش کلاینت است |
| extract | نتیجه endLocalRaid | client_report_only | گزارش موفقیت/نام خروج؛ مستقل از سرور تأیید نشده |
| survive | نتیجه endLocalRaid | client_report_only | وضعیت Survived/Runner از گزارش Raid |
| raid_complete | نتیجه endLocalRaid | client_report_only | پایان Raid، حتی در صورت عدم بقا؛ نباید معادل Extract تلقی شود |

نکات امنیتی:

- API میزبان تنها kill و visit می‌پذیرد؛ هویت SPT، عضویت گروه، Match فعال، شناسه میزبان و Rate Limit بررسی می‌شوند.
- host_attested یعنی شواهد از میزبان Fika و فرآیند بازی گزارش شده‌اند؛ به معنی Server-authoritative یا ضدتقلب غیرقابل‌دورزدن نیست.
- spt_accepted_client_delta از گزارش خام Inventory قوی‌تر است، چون با پروفایل ذخیره‌شده SPT تطبیق داده می‌شود؛ اما منشأ آیتم را به‌طور قطعی اثبات نمی‌کند.
- نتیجه Raid و پایان گروه در مسیر فعلی با verified=false ثبت می‌شوند.
- server_verified برای داده‌ای رزرو شده که واقعاً از منبع سرور مالک رویداد بیاید؛ در مسیرهای عملیاتی فعلی تولیدکننده کامل این سطح برای Objectiveها وجود ندارد.
- eventId یکتا، جلوگیری از ثبت تکراری و بررسی Actor عضو گروه پیاده‌سازی شده است.

## ۶. امکاناتی که پیاده‌سازی شده‌اند

- Mission CRUD در پنل، Publish/Close و Event عمومی مرتبط.
- Objectiveهای Kill، Kill Type، Collect، Visit، Extract، Survive و Raid Complete.
- Solo، Squad، Either، حداقل/حداکثر نفرات، Ready و اتصال گروه به Fika.
- Campaign ID و Sequence، بازشدن مرحله بعد بعد از Award تأییدشده مرحله قبل.
- Rank، Point، Progress تا Rank بعدی و Leaderboard.
- پنل F8، فهرست مأموریت، قفل Rank/Campaign، اعلان و HUD داخل Raid.
- Fika Adapter نسخه‌محور با کنترل Match/Member/Map و چرخه شروع/پایان.
- صف بررسی مدیر، شواهد و Ledger پاداش.
- تحویل پاداش Ruble/Item از طریق SPT Mail و کنترل دستی وضعیت مبهم.
- خواندن و ویرایش Preset فعال SVM از پنل، با Revision guard، اعتبارسنجی، پشتیبان‌گیری و الزام Restart.

## ۷. موارد ناقص یا پیاده‌سازی‌نشده

1. Server-authoritative telemetry: منبع مستقل و قابل‌اعتماد سرور برای اثبات Kill/Visit/Collect/Extraction تکمیل نشده است. تا آن زمان Review مدیر باید اجباری بماند.
2. Briefing رسانه‌ای: مدل داده kind/media/body دارد؛ HUD فعلی متن body را نشان می‌دهد. پخش واقعی Video/Audio، نمایش رسانه و اتاق سه‌بعدی Briefing پیاده‌سازی نشده است.
3. Fika orchestration: Start Native میزبان و اتصال Match انجام می‌شود؛ ورود خودکار اعضا، کنترل کامل Lobby یا انتقال آن‌ها به Raid خودکار نیست.
4. Reward runtime: مسیر SPT Mail در کد وجود دارد، اما ارسال واقعی روبل/آیتم در نصب کاربر و سناریوی Offline/Online باید آزمایش شود.
5. Mod-stack soak test: همکاری واقعی SVM، LiveFleaPrices، SAIN، LootingBots، PackNStrap و Fika در Raidهای طولانی اثبات نشده است.
6. Fika Item Sending: تنظیم آرشیو فعلی allowItemSending=false است و پنل آن را می‌خواند. اگر در سرور واقعی فعال شود، مسیر انتقال Fika هنوز در EconomyGuard Hook نشده است.
7. Runtime verification: بارگذاری DLL در EFT Mono، اجرای F8، Hookهای Harmony، اتصال Fika و رفتار HUD هنوز نیازمند آزمون نصب واقعی هستند.

## ۸. SVM و اقتصاد؛ تفکیک دقیق تنظیم‌ها

سرویس SVM Preset انتخاب‌شده را از Loader/loader.json می‌خواند و روی نام ثابت Preset تکیه نمی‌کند. ویرایش فقط روی Preset فعال انجام می‌شود، Revision خام فایل قبل از ذخیره کنترل می‌شود، Backup ساخته می‌شود و SPT باید Restart شود.

- Traders.TraderMarkup: درصد بازخرید/خرید کالا از بازیکن است؛ طبق منطق SVM مقدار 20 برای Skier به معنی حدود ۲۰٪ قیمت مبنای Handbook هنگام فروش بازیکن به تریدر است، نه ضریب ۲۰ برابری قیمت خرید.
- Traders.TraderSell: ضریب هزینه‌های پولی پیشنهادهای خرید تریدر است؛ پیشنهادهای صرفاً Barter با این گزینه تغییر نمی‌کنند.
- Items.ItemPriceMult: ضریب جداگانه قیمت آیتم‌هاست و تنها وقتی بخش Items.EnableItems فعال باشد اعمال می‌شود.
- در Snapshot ارائه‌شده، Preset فعال v6 و Items.EnableItems=false است؛ پس ItemPriceMult=1 ذخیره شده اما فعال نیست. مقادیر Trader باید از Preset فعال خوانده شوند و با Item multiplier اشتباه نشوند.

این ویرایشگر SVM در سورس وجود دارد؛ آزمون نهایی آن باید روی نسخه واقعی SVM و بعد از Restart سرور انجام شود.

## ۹. وضعیت Build و Test

- Server Checks روی Commit قدیمی‌تر c22445de000ca803c37fab1031347557105e3f88 موفق شده بود: ۲۸ تست، صفر خطا. این نتیجه، اعتبار CI برای کدهای جدیدتر را ثابت نمی‌کند.
- آخرین Client Build موفق مستندشده مربوط به Commit 248e5924bc331167a908f050f8eee7a6574dde12 است. سورس Client بعد از آن تغییر کرده؛ آخرین تغییر فایل Client در Commit 6db724310824221d41411da0afdb72a4c5444985 است.
- آخرین اجرای Client برای Commit 6db7243 با Run ID 42919678967 در Job آماده‌سازی Source/Dependency شکست خورده و Job کامپایل Windows اجرا نشده است. Step log در اتصال GitHub در دسترس نبود.
- آخرین Server Checks روی Commit فعلی 37f591e با Run ID 43318263778 شکست خورده؛ GitHub هیچ Step و Log قابل‌خواندنی برای Job برنگردانده است. علت را نمی‌توان بدون Log تعیین کرد.
- آزمون واقعی داخل EFT/Fika، تست Mail واقعی و آزمون کامل Mod Stack هنوز انجام نشده‌اند.

## ۱۰. ترتیب توسعه بعدی

### P0 — قابل‌ساخت و قابل‌تکرار کردن نسخه فعلی
1. همگام‌کردن مستندات با مسیرهای اجرایی واقعی و حذف ادعاهای قدیمی؛ این ممیزی نقطه شروع مستند این کار است.
2. بازیابی CI و اجرای تست Server و Build ویندوزی Client روی HEAD فعلی؛ خطا باید از Runner/Dependency/Compile تفکیک شود.
3. افزودن/تکمیل تست End-to-End برای گروه Fika، رویدادهای میزبان، ثبت Collect از پروفایل پذیرفته‌شده، پایان Raid و Review.
4. تثبیت قرارداد DTO و نسخه‌گیت Hookها؛ هر Hook غایب باید Status روشن بدهد و نباید پیشرفت جعلی بسازد.

### P1 — اطمینان از صحت نتیجه مأموریت
1. بررسی سورس دقیق Fika 2.4.3 و SPT 3.11.1 برای هر Event server-owned قابل استفاده.
2. برای هر Objective، منبع داده، هویت Actor، Match binding، تکراری‌نبودن، زمان و سطح اعتماد مستند و تست شود.
3. هرجا منبع مستقل سرور وجود ندارد، به‌جای برچسب server_verified، شواهد میزبان/کلاینت و Review دستی حفظ شود.
4. مدیریت موارد قطع اتصال، Raid ناقص، مرگ، خروج همه اعضا، Host migration و تکرار callbackها.

### P2 — تکمیل تجربه مأموریت
1. Briefing رسانه‌ای با Cache و اعتبارسنجی فایل/Hash/حجم و نمایش امن در Client.
2. نمایش پیشرفت و اعلان‌های Mission به شکل پایدار در HUD؛ پشتیبانی از متن/رسانه باید جداگانه تست شود.
3. تکمیل وضعیت‌های Upcoming/Active/Closed، تاریخچه مأموریت و نمایش نتیجه نهایی در Board.

### P3 — اطمینان اقتصاد و تحویل پاداش
1. تست SVM با Preset واقعی فعال و تطبیق مقدار UI، فایل JSON و نتیجه SPT بعد از Restart.
2. تست ترتیب بارگذاری SVM و LiveFleaPrices و ثبت مقادیر Handbook/Dynamic/Ragfair.
3. تست Mail واقعی برای Ruble و Item، بازیکن Online/Offline و بازیابی بعد از قطع سرویس؛ بدون Retry کور که پاداش تکراری بسازد.

### P4 — پذیرش نهایی
- ماتریس نصب تمیز SPT/Fika، هر Mod در گروه‌های مرحله‌ای، Raid انفرادی و گروهی، Map mismatch، همه انواع Objective، قطع/وصل، Review تأیید/رد، تحویل پاداش، Restart و بازیابی.
- انتشار فقط پس از CI سبز برای همان Commit و آزمون Runtime روی نسخه هدف.

**مبنای ادامه:** این فایل وضعیت واقعی Commit بررسی‌شده است. هر تغییر بعدی باید با Commit، تست مربوط، و وضعیت «کد پیاده‌سازی‌شده / CI تأییدشده / Runtime تأییدشده» ثبت شود؛ این سه وضعیت نباید با هم یکی فرض شوند.
