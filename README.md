# ☕ קפה רחל בצהלה — מערכת הזמנות דיגיטלית

מערכת הזמנות לעגלת הקפה בחוות צהלה: תפריט דיגיטלי, עגלת קניות, תשלום (כרגע מדומה) ומסך הזמנות לצוות בזמן אמת.

| כתובת | מה יש שם |
|---|---|
| `/` | אתר ההזמנות ללקוחות (מותאם לטלפון) |
| `/main` | **מסך ניהול / מטבח** — כל ההזמנות שנכנסות, בזמן אמת |

## הרצה

דרוש Node.js 18 ומעלה. אין תלויות להתקנה.

```bash
npm start            # או: node server/local.js
# אתר:   http://localhost:3000/
# ניהול: http://localhost:3000/main
```

משתני סביבה (לא חובה):

| משתנה | ברירת מחדל | תיאור |
|---|---|---|
| `PORT` | `3000` | פורט השרת |
| `ADMIN_PIN` | — | קוד גישה למסך `/main`. **מומלץ מאוד להגדיר באתר אמיתי** |
| `PAYMENT_PROVIDER` | `mock` | ספק הסליקה (ראו למטה) |
| `DATA_DIR` | `./data` | היכן נשמר קובץ ההזמנות (כשאין Redis) |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | — | Redis (Upstash). **חובה ב-Vercel** — נוצרים אוטומטית בחיבור Upstash |

## מבנה הפרויקט

```
api/index.js                 נקודת הכניסה ל-Vercel (serverless)
vercel.json                  הגדרות Vercel
server/api.js                ה-API (משותף ל-Vercel ולהרצה מקומית)
server/local.js              שרת מקומי: קבצים סטטיים + API
server/store.js              שמירת הזמנות: Redis (Upstash) או קובץ JSON מקומי
server/payments/index.js     בחירת ספק סליקה
server/payments/mock-provider.js   סליקה מדומה
public/index.html            אתר הלקוחות
public/main/index.html       מסך הניהול (/main)
public/data/menu.json        התפריט — מקור אמת יחיד למחירים
public/js/pricing.js         חישוב מחירים (משותף ללקוח ולשרת)
public/js/cart.js            ניהול העגלה (נשמרת בדפדפן)
public/js/api.js             כל הקריאות לשרת
public/js/app.js             ממשק הלקוח
public/js/admin.js           ממשק הצוות
public/css/styles.css        עיצוב המותג
public/assets/               לוגו ותמונת רקע (אפשר להחליף בקבצים המקוריים)
```

## עדכון התפריט

עורכים את `public/data/menu.json` (בהרצה מקומית צריך להפעיל את השרת מחדש).
- פריט עם מחיר אחד: `"price": 14`
- פריט עם גדלים: `"sizes": [{ "id": "small", "label": "קטן", "price": 16 }, ...]`
- תוספות/בחירות: מגדירים קבוצה ב-`optionGroups` ומוסיפים את המזהה שלה ל-`"options"` של הפריט
- `"popular": true` מוסיף תגית "אהוב"

השרת **מחשב מחדש** את המחיר מהתפריט בכל הזמנה, כך שאי אפשר לשנות מחירים מהדפדפן.

## תשלום — מעבר מ-Mock לסליקה אמיתית

כרגע `PAYMENT_PROVIDER=mock`: אין חיוב, ההזמנה מאושרת אחרי השהייה קצרה.
- כרטיס לבדיקה: `4242 4242 4242 4242`, תוקף עתידי כלשהו, ת.ז. `000000018`
- כרטיס שמדמה **דחייה**: `4000 0000 0200 0000`

רק 4 הספרות האחרונות של הכרטיס נשלחות לשרת.

### חיבור ספק אמיתי (PayPlus / Meshulam-Grow / Stripe)

1. צרו `server/payments/payplus-provider.js` שמממש את הממשק:
   ```js
   module.exports = {
     name: 'payplus',
     async createPayment({ orderId, amount, currency, customer, description, returnUrl }) {
       // קריאה ל-API של הספק ליצירת דף תשלום
       return { status: 'redirect', transactionId, url: paymentPageUrl };
     },
     async verifyCallback(req, body) {
       // אימות ה-webhook (חתימה!) והחזרת { orderId, transactionId, paid }
     },
   };
   ```
2. רשמו אותו ב-`server/payments/index.js`.
3. הוסיפו ב-`server/api.js` נתיב webhook (למשל `POST /api/payments/callback`) שקורא ל-`verifyCallback`
   ומעדכן את ההזמנה מ-`pending_payment` ל-`new`.
4. הסירו את שדות האשראי מטופס התשלום ב-`app.js` — אצל ספק אמיתי הלקוח מזין את הכרטיס
   בדף/בשדות המאובטחים של הספק (כך אתם לא נדרשים לעמוד ב-PCI בעצמכם).
5. הריצו עם `PAYMENT_PROVIDER=payplus` ומפתחות ה-API במשתני סביבה.

הקוד בצד הלקוח כבר יודע לטפל ב-`redirectUrl`, והשרת כבר שומר הזמנות ממתינות לתשלום בסטטוס `pending_payment` (הן לא מוצגות לצוות עד שהתשלום מאושר).

## מסך הניהול `/main`

- שלוש עמודות: **חדשות → בהכנה → מוכנות לאיסוף**, ובטלפון/טאבלט כלשוניות
- צליל והבהוב כשנכנסת הזמנה חדשה (לחצו פעם אחת על המסך כדי שהדפדפן יאפשר צליל)
- הזמנה שממתינה יותר מ-10 דקות מסומנת באדום
- הערות לפריט מודגשות בסגול, הערה כללית בצהוב
- המסך מתעדכן אוטומטית כל 3 שניות; הלקוח רואה את הסטטוס שלו מתעדכן (כולל רטט כשההזמנה מוכנה)
- סטטיסטיקה יומית: הזמנות פתוחות, כמות והכנסות; מספרי ההזמנות מתאפסים כל יום ל-101

## פריסה ל-Vercel

1. מחברים את הריפו ב-Vercel (Framework Preset: **Other**, בלי Build Command). `vercel.json` כבר מגדיר הכול.
2. **חיבור מסד נתונים (חובה):** בפרויקט ב-Vercel → **Storage** → **Create Database** → **Upstash for Redis**
   (יש תוכנית חינמית) → **Connect** לפרויקט. זה יוצר אוטומטית את `KV_REST_API_URL` ו-`KV_REST_API_TOKEN`.
3. **Settings → Environment Variables** → מוסיפים `ADMIN_PIN` (קוד לכניסה ל-`/main`).
4. **Deployments** → על הפריסה האחרונה → **Redeploy** (כדי שהמשתנים ייכנסו לתוקף).

בלי Redis האתר והתפריט עובדים, אבל שליחת הזמנה תחזיר הודעה שמסד הנתונים לא מחובר.

אפשר גם להריץ על כל שרת Node רגיל (Render, Railway, VPS) עם `npm start` — שם, בלי Redis, ההזמנות נשמרות בקובץ ב-`DATA_DIR`.
