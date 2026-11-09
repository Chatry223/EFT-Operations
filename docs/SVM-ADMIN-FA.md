# راهنمای مدیریت SVM در EFT Operations

در پنل EconomyGuard وارد بخش **EFT Operations → SVM / Economy** شو.

این بخش فایل انتخاب‌شده در مسیر زیر را می‌خواند:

- `user/mods/[SVM] Server Value Modifier/Loader/loader.json`
- فایل Preset فعال در `Presets`، برای نصب فعلی تو `v6.json`

## چه چیزهایی نمایش داده می‌شود؟

- مقدار `TraderMarkup` برای هر Trader
- مقدارهای `TraderSell`
- مقدار `Items.ItemPriceMult`
- فعال یا غیرفعال بودن بخش‌های `Traders.EnableTraders` و `Items.EnableItems`
- تنظیمات Fence شامل ضریب قیمت، ضریب Preset و بازه زمان Stock

در Preset فعلی، مقدار Skier برابر 20 است. این عدد مقدار خام SVM است؛ کد SVM آن را به `buy_price_coef = 100 - value` تبدیل می‌کند. بنابراین آن را نباید یک ضریب مستقیم قیمت یا عدد 20 برابری تفسیر کرد.

همچنین در Preset فعلی `Traders.EnableTraders=true` و `Items.EnableItems=false` است؛ پس `ItemPriceMult=1` ذخیره شده، اما بخش Items غیرفعال است و این مقدار در حال حاضر اعمال نمی‌شود.

## ذخیره تغییرات

- فقط Preset فعال و کلیدهای مشخص‌شده تغییر می‌کنند.
- پیش از ذخیره، یک نسخه پشتیبان زمان‌دار در `SPT-EconomyGuard-Data/backups/svm` ساخته می‌شود.
- نسخه SVM باید `1.11.1` و هدف SPT باید `3.11.x` باشد؛ نسخه‌های ناشناخته فقط خواندنی هستند.
- برای اعمال تغییرات باید SPT Server را Restart کنی.
- این بخش Greed.exe را جایگزین نمی‌کند و تنظیمات SVM را در زمان اجرای سرور Hot Reload نمی‌کند.
