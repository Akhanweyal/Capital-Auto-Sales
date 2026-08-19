# Capital Auto Sales — website + dealer dashboard

A public inventory site and a private dashboard for listing and selling cars.

- Public site: `/` — inventory grid, search, filters, car pages, call/text/request-info
- Dealer dashboard: `/admin` — add, edit, publish, feature, mark sold, customer requests

Built with React + Vite. Data and photos live in Supabase (free tier). Hosted on Vercel (free tier).

---

## What you need installed

| Tool | Where | Why |
|---|---|---|
| Node.js (LTS) | nodejs.org | runs the build |
| Git | git-scm.com | version control |
| VS Code | code.visualstudio.com | editor |

Check they're installed — open a terminal and run:

```bash
node -v
git --version
```

---

## 1. Open the project

Unzip the folder, then in VS Code: **File → Open Folder** → pick `capital-auto-sales`.

Open the built-in terminal (**Terminal → New Terminal**) and install:

```bash
npm install
```

---

## 2. Set up the database (Supabase)

1. Go to supabase.com → **New project**. Name it `capital-auto-sales`, pick a strong database password, region **East US**.
2. Left sidebar → **SQL Editor** → **New query**. Open `supabase/schema.sql` from this project, copy everything, paste it in, click **Run**. This creates the `cars` and `leads` tables, the security rules, and the photo bucket.
3. Left sidebar → **Authentication → Users → Add user → Create new user**. Use your own email and a password you'll remember, and turn on **Auto Confirm User**. This is your dealer login.
4. Left sidebar → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

In VS Code, make a copy of `.env.example` named `.env` and paste your two values in:

```
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

`.env` is git-ignored on purpose — it never gets pushed.

> The anon key is safe to ship in a website. The database rules only let the public read cars you've published and send you requests. Everything else needs your login.

---

## 3. Run it on your computer

```bash
npm run dev
```

Open http://localhost:5173 — that's your site. Go to http://localhost:5173/admin, sign in with the email and password from step 2.3, and add a car.

Stop the server with `Ctrl + C`.

---

## 4. Put it on GitHub

Easiest way, all inside VS Code:

1. Click the **Source Control** icon in the left rail (the branching symbol).
2. Click **Initialize Repository**.
3. Type a message like `First version of the dealership site` and click **Commit**.
4. Click **Publish Branch** → choose **private repository** → name it `capital-auto-sales`.

Same thing from the terminal if you prefer:

```bash
git init
git add .
git commit -m "First version of the dealership site"
git branch -M main
git remote add origin https://github.com/YOURNAME/capital-auto-sales.git
git push -u origin main
```

---

## 5. Deploy it (Vercel)

1. Go to vercel.com → **Sign up with GitHub**.
2. **Add New → Project → Import** your `capital-auto-sales` repo.
3. Framework preset should auto-detect **Vite**. Leave build settings alone.
4. Open **Environment Variables** and add the same two values from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**. About a minute later you get a live link like `capital-auto-sales.vercel.app`.

### Your own domain

In Vercel: **Project → Settings → Domains → Add**. Enter `capitalautosalesva.com` (or whatever you register). Vercel shows two DNS records — paste them into your domain registrar's DNS page. It goes live in a few minutes, HTTPS included.

---

## 6. Changing things later

Edit the file → commit → push. Vercel rebuilds and publishes automatically.

```bash
git add .
git commit -m "Updated the address"
git push
```

Things you'll likely want to change, all in `src/App.jsx` at the very top:

```js
export const DEALER = {
  name: "Capital Auto Sales",
  phone: "804-372-4422",
  address: "8607",            // <-- full street address goes here
  city: "Richmond, VA",
  hours: "Mon–Sat 9am – 7pm  ·  Sun by appointment",
};
```

---

## Day-to-day use

You never touch code to run the business. Go to `yoursite.com/admin` on your phone or laptop, sign in, and:

- **+ Add a car** — drag photos in, fill the fields, **Publish to the website**
- **Mark sold** — badge appears, car drops to the bottom of the grid
- **Feature** — pins the car to the top with a gold marker
- **Customer requests** tab — names and numbers from the website, with call and text buttons

Photos are resized in the browser before upload, so shooting straight from your phone is fine.

---

## Costs

| | Free tier covers |
|---|---|
| Vercel | Plenty for a dealership site |
| Supabase | 500 MB database, 1 GB photo storage — roughly 1,000+ car photos |
| Domain | ~$12–15/year at the registrar |
