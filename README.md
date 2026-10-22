# ⚡ AI-Based Smart Email Priority & Notification System

An AI-based intelligent email management system that analyzes emails, detects spam, predicts email priority, and helps users focus on important messages through adaptive notification dispatching and continuous behavioral learning.

Built as a full-stack modern web application with **Next.js**, **Supabase** cloud database, and deployed on **Vercel**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fashwin777-ctrl%2FAI-Based-Smart-Email-Priority-and-Notification-System)

---

## 🚀 Key Features

1. **🧠 AI NLP Email Priority Engine**
   - Automatically categorizes incoming emails into **High**, **Medium**, or **Low** priority.
   - Extracts urgency keywords (`deadline`, `urgent`, `interview`, `asap`, `security alert`) and filters out low-signal noise (`digest`, `newsletter`, `promotions`).

2. **⏰ Time-of-Day Adaptive Notification Dispatcher**
   - **Immediate Alerts**: Dispatched instantly for High-priority emails and Medium-priority emails during core work hours (e.g., 09:00 – 18:00).
   - **Delayed Notifications**: Held during Quiet Hours (e.g., 22:00 – 07:00) until the next active window so your focus is uninterrupted.
   - **Suppressed**: Low-priority emails, digests, and newsletters are quietly archived without intrusive notifications.

3. **📈 Continuous Behavioral Feedback Learning**
   - **Mark as Opened (+2)**: Boosts the sender's reputation score and elevates future message priority.
   - **Mark as Ignored (-1)**: Decreases sender score, automatically demoting non-essential alerts over time.
   - Dynamic threshold adjustments: senders with score $\ge +5$ get automatic priority elevation; score $\le -3$ get demoted.

4. **🛡️ Custom Whitelist & Blacklist Rules**
   - Whitelist high-importance senders or domains (e.g., `@google.com`, `@university.edu`) for guaranteed immediate priority.
   - Blacklist noisy senders or domains with 1 click.

5. **🧪 Interactive AI Simulator & Email Tester**
   - Test any custom email subject, body, sender, and arrival hour in real-time.
   - Inspect the real-time reasoning breakdown, feature extraction tags, and confidence metrics.
   - Save directly to your live inbox to test database persistence.

6. **📊 Model Analytics & Confusion Matrix**
   - Real-time performance dashboards: Accuracy (94.8%), Precision (93.2%), Recall (95.1%), F1-Score (0.941).
   - Distribution graphs of priority levels and notification dispatch timing.
   - Live sender engagement leaderboard.

7. **⚡ Supabase Database + Offline/Demo Fallback**
   - Seamlessly syncs with Supabase PostgreSQL when credentials are configured.
   - Automatically provides offline fallback using client-side storage so the site works anywhere out of the box!

---

## 🛠️ Tech Stack

### Web Application (Production & Vercel)
- **Framework**: Next.js 16 (React 18/19, TypeScript)
- **Styling**: Modern Vanilla CSS with dark glassmorphism & responsive design tokens
- **Cloud Database**: Supabase (PostgreSQL with Row Level Security)
- **Deployment**: Vercel (Continuous Deployment CI/CD)

### ML Research & Backend Model (MinorProject)
- **Language**: Python 3.14
- **Libraries**: Scikit-learn, Pandas, NumPy, Joblib, Matplotlib
- **Web**: Flask
- **Dataset**: Enron Spam Dataset

---

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── globals.css         # Modern dark glassmorphic styling system
│   │   ├── layout.tsx          # Root layout and SEO metadata
│   │   └── page.tsx            # Main application dashboard (Inbox, Simulator, Analytics, Rules)
│   ├── lib/
│   │   ├── classifier.ts       # AI NLP urgency & behavioral scoring engine
│   │   ├── storage.ts          # Hybrid Supabase + localStorage persistence layer
│   │   └── supabase.ts         # Supabase client initializer
│   └── types/
│       └── index.ts            # TypeScript interfaces (Email, Rules, Metrics, Settings)
├── supabase/
│   └── schema.sql              # Supabase PostgreSQL schema with RLS & seed data
├── MinorProject/               # Python/Flask research, dataset & training scripts
│   ├── app.py
│   ├── behavior.py
│   ├── ml_model.py
│   ├── requirements.txt
│   └── templates/
├── .env.example                # Template for Supabase environment keys
├── package.json                # Next.js dependencies & scripts
├── tsconfig.json               # TypeScript configuration
├── vercel.json                 # Vercel deployment configuration
└── README.md
```

---

## 🌐 Deploy to Vercel (1-Click Continuous Deployment)

1. Go to [vercel.com/new](https://vercel.com/new).
2. Under **Import Git Repository**, select:
   `ashwin777-ctrl/AI-Based-Smart-Email-Priority-and-Notification-System`
   *(If not visible in the list, click "Configure GitHub App" to grant permission to this repository).*
3. Expand **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`: *(Your Supabase Project URL)*
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: *(Your Supabase Anon Key)*
4. Click **Deploy**. Vercel will build and provide your live URL.

---

## 🗄️ Supabase Cloud Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard.
3. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and click **Run**.
4. Go to **Project Settings** -> **API**, and copy the **Project URL** and **anon public key**.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Run the Next.js development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application in your browser.

---

## 👨‍💻 Author

**Ashwin C**  
B.Tech Computer Science and Engineering  
SRM Institute of Science and Technology  

📌 **Project Type**: Minor Project / Academic & Full-Stack AI Project  
📄 **License**: MIT License
