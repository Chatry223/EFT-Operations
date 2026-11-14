# GitHub Actions runner dispatch blocker — فارسی

## نتیجه

شکست فعلی CI در مرحله اجرای کد، `npm run check`، `npm test` یا Build کلاینت رخ نمی‌دهد. GitHub برای Jobهای شکست‌خورده هیچ Hosted Runner تخصیص نداده است.

نشانه قطعی از Job API:
- `runner_id: 0`
- `runner_name: ""`
- `steps: []`
- زمان شروع تا پایان تقریباً یک ثانیه
- دانلود Job logs با `BlobNotFound` برمی‌گردد؛ چون Runnerای لاگی تولید نکرده است.

## نمونه‌های ثبت‌شده

| مورد | Workflow Run | Job | Runner label | runner_id | Steps |
|---|---:|---:|---|---:|---:|
| PR #2 — Server Checks، attempt 2 | 43324967426 | 131556299481 | ubuntu-latest | 0 | 0 |
| PR #2 — Source/dependency verification، attempt 2 | 43324967548 | 131556310320 | ubuntu-latest | 0 | 0 |
| main — Server Checks | 43318263778 | 131544222650 | ubuntu-latest | 0 | 0 |

اجرای موفق مرجع:
- Run: `42694220424`
- Commit: `c22445de000ca803c37fab1031347557105e3f88`
- Job مربوط به تست سرور: `129421628551`
- Runner: `GitHub Actions 1000002927`
- Steps شامل checkout، آماده‌سازی سورس، setup-node، Static checks و Unit tests بوده‌اند و همگی Success شده‌اند.

## تشخیص

1. `ubuntu-latest` یک label معتبر است و همین مخزن قبلاً با همین Hosted Runner اجرا شده است.
2. شکست هم روی `main` و هم روی PR رخ می‌دهد؛ بنابراین محدود به تغییرات شاخه توسعه نیست.
3. هیچ Stepای آغاز نمی‌شود؛ پس نمی‌توان این شکست را به کد یا تست‌های پروژه نسبت داد.
4. در مخزن خصوصی، مصرف GitHub-hosted compute تابع سهمیهٔ حساب و بودجه/پرداخت حساب مالک مخزن است. محتمل‌ترین علت یک محدودیت account-level در تخصیص Hosted Runner است: اتمام included compute، بودجه‌ای که مصرف را متوقف می‌کند، وضعیت payment، یا محدودیت billing/entitlement در سمت GitHub.
5. دادهٔ قابل‌دسترسی در این ممیزی متن دو Annotation چک شکست را نشان نمی‌دهد؛ بنابراین نمی‌توان یکی از حالت‌های billing را بدون دیدن متن Annotation یا صفحهٔ Billing حساب، علت قطعی اعلام کرد.

مستند رسمی:
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

## اقدام لازم در حساب GitHub

از حساب مالک مخزن:
1. Settings → Billing and licensing → Usage؛ بخش Actions & Packages و مقدار included compute/مصرف را بررسی کنید.
2. Billing and licensing → Budgets and alerts؛ بودجه‌ای با گزینهٔ Stop usage at limit را بررسی کنید.
3. Payment information؛ وضعیت روش پرداخت و هرگونه payment/billing hold را بررسی کنید.
4. اگر compute باقی مانده، روش پرداخت معتبر و بودجهٔ باز وجود دارد اما Job همچنان با `runner_id=0` خاتمه می‌یابد، به GitHub Support درخواست بررسی Hosted Runner dispatch / billing entitlement بدهید و Run/Jobهای بالا و اجرای موفق مرجع را ضمیمه کنید. GitHub باید Annotationهای سمت سرویس را ببیند.

## چه کارهایی در سورس انجام نشود

- `runs-on: ubuntu-latest` را به label تصادفی یا قدیمی تغییر ندهید.
- خطای Runner را با حذف تست‌ها، Skip کردن CI یا سبز نشان دادن اجباری Workflow پنهان نکنید.
- مخزن خصوصی را صرفاً برای دور زدن محدودیت به Public تبدیل نکنید؛ این تغییر سطح افشای سورس را عوض می‌کند و برای تشخیص لازم نیست.
- PR تا زمان اجرای واقعی چک‌ها Draft می‌ماند.

## اجرای جایگزین محلی

تا وقتی Hosted Runner تخصیص داده نمی‌شود، روی یک محیط مورد اعتماد با Node.js 20 و از پوشهٔ سورس مود اجرا کنید:

```powershell
Set-Location .\source\EFT-Operations-1.9.1\user\mods\SPT-EconomyGuard
npm run check
npm test
```

اگر هر دو فرمان محلی موفق شدند، خروجی کامل و نسخه Node را نگه دارید. این تست‌ها جایگزین Build ویندوزی پلاگین یا تست Runtime داخل EFT/Fika نیستند.

## وضعیت

- علت نزدیک و قابل اثبات: Hosted Runner پیش از اجرای نخستین Step تخصیص داده نشده است.
- علت حسابی دقیق: هنوز باید از Billing Dashboard یا Annotation قابل مشاهده در GitHub تأیید شود.
- کد CI و فرمان‌های تست برای پوشاندن این مشکل تضعیف نشده‌اند.


## کنترل وضعیت عمومی GitHub

صفحه رسمی GitHub Status برای ۱۲ نوامبر ۲۰۲۶ هیچ Incident ثبت نکرده است. اختلال عمومی Actions در ۱۱ نوامبر ساعت ۲۰:۴۸ تا ۲۱:۲۱ UTC اعلام و Resolved شده بود؛ Jobهای این بررسی در ۱۲ نوامبر حدود ۲۳:۰۰ UTC شکست خوردند. بنابراین اختلال عمومی ثبت‌شده در Status Page با زمان Jobها تطابق ندارد و علت حسابی/Runner-dispatch همچنان محتمل‌تر است. این کنترل، محدودیت اختصاصی یک حساب یا خطای داخلی ثبت‌نشده را رد نمی‌کند.

منبع: https://www.githubstatus.com/
