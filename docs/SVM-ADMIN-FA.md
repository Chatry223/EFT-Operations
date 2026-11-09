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

SVM مقدار `TraderMarkup` را به `buy_price_coef = 100 - value` تبدیل می‌کند. در SPT 3.11.1 این فیلد درصد معکوس قیمت خرید مجدد Trader است؛ بنابراین `Skier=20` یعنی Skier هنگام خرید آیتم از بازیکن تقریباً ۲۰٪ قیمت Handbook را می‌پردازد؛ نه اینکه قیمت خرید بازیکن ۲۰ برابر یا ۲۰٪ گران‌تر شود. `TraderSell` تعداد واحد پول/Barter لازم برای آیتم‌های داخل Assort خود Trader را ضرب می‌کند و در نتیجه قیمت کالاهایی را که Trader به بازیکن می‌فروشد تغییر می‌دهد. پنل مقدار TraderMarkup را بین ۰ تا ۱۰۰ محدود می‌کند، چون درصد است.

همچنین در Preset فعلی `Traders.EnableTraders=true` و `Items.EnableItems=false` است؛ پس `ItemPriceMult=1` ذخیره شده، اما بخش Items غیرفعال است و این مقدار در حال حاضر اعمال نمی‌شود.

## ذخیره تغییرات

- فقط Preset فعال و کلیدهای مشخص‌شده تغییر می‌کنند.
- پیش از ذخیره، یک نسخه پشتیبان زمان‌دار در `SPT-EconomyGuard-Data/backups/svm` ساخته می‌شود.
- مسیر پوشه SVM، Loader و Preset فعال کنترل می‌شود؛ اگر Symlink از محدوده `user/mods` خارج شود، عملیات ذخیره رد می‌شود.
- نسخه SVM باید `1.11.1` و هدف SPT باید `3.11.x` باشد؛ نسخه‌های ناشناخته فقط خواندنی هستند.
- برای اعمال تغییرات باید SPT Server را Restart کنی.
- این بخش Greed.exe را جایگزین نمی‌کند و تنظیمات SVM را در زمان اجرای سرور Hot Reload نمی‌کند.
