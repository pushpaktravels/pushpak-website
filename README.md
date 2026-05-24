# Pushpak Portal — standalone (Phase 1 scaffold)

This is the **new** portal that replaces the Apps Script + Google Sheet stack.
It runs as a Next.js app, talks to a Postgres database on Supabase, and is
deployed to Vercel on the same domain (`app.flypushpak.com`) once cutover.

The old Apps Script portal stays running until parallel testing proves the new
system is equal. Don't disconnect anything yet.

---

## What you need to set up (one-time, ~20 min)

### 1. Supabase (Postgres + Storage) — free tier

1. Go to https://supabase.com → Sign up (use your Google account)
2. Click **New project**
   - Name: `pushpak-portal`
   - Database password: generate a strong one, **save it to your password manager**
   - Region: `Asia Pacific (Mumbai)` — closest to your team
3. Wait ~2 min for provisioning.
4. Once ready, go to **Project Settings → Database → Connection string**
   - Copy the **Transaction** pooler URL → this is your `DATABASE_URL`
   - Copy the **Session** mode URL → this is your `DIRECT_URL`
5. Both URLs contain `[YOUR-PASSWORD]` — replace with the password you saved.

### 2. Resend (transactional email) — free tier

1. Go to https://resend.com → Sign up
2. Add domain `flypushpak.com` (or use Resend's sandbox sender for testing first)
3. Go to **API Keys** → create one named `pushpak-portal-prod` → copy it

### 3. Local secrets — generate two random strings

Open Terminal and run:
```bash
openssl rand -hex 64   # use this for JWT_SECRET
openssl rand -hex 64   # use this for PASSWORD_PEPPER (different one)
```

### 4. Set env vars

Inside `portal-app/`, create a file named `.env` (copy from `.env.example`):
```bash
cd ~/Desktop/PUSHPAK_WEBSITE/portal-app
cp .env.example .env
```
Then edit `.env` and paste in:
- `DATABASE_URL` + `DIRECT_URL` from Supabase
- `JWT_SECRET` + `PASSWORD_PEPPER` from the openssl commands
- `RESEND_API_KEY` from Resend
- `NEXT_PUBLIC_APP_URL` stays as `https://app.flypushpak.com`

---

## Local development

```bash
cd ~/Desktop/PUSHPAK_WEBSITE/portal-app

# 1. Install dependencies (first time only)
npm install

# 2. Create the database tables
npx prisma migrate dev --name init

# 3. Seed the initial users (Vanshika, Vishal, CMs, Accounts team)
npm run seed

# 4. Run the dev server
npm run dev
```

Open http://localhost:3000 → you should see the login page.
Sign in as `VANSHIKA01` / `Vanshika@2026` → you'll be sent to 2FA enrollment.
After scanning the QR with Google Authenticator and entering a code,
you land on the portal page (currently a simple table — Phase 4 ports the
full UI from Page-v2.html).

---

## Migrating data from the legacy sheet (when ready)

1. Create a Google Cloud service account:
   - Go to https://console.cloud.google.com → APIs & Services → Credentials → Create Credentials → Service Account
   - Name: `pushpak-migration`. Skip role assignment.
   - Click the created service account → Keys tab → Add Key → JSON → download the file
2. Share your legacy sheet (`Pushpak Debtor Control — MASTER v3`) with the service account's email address (`...@...iam.gserviceaccount.com`) as **Viewer**
3. Open the JSON file, copy the entire contents (it's a single line of JSON)
4. Paste into `.env` as `GOOGLE_SERVICE_ACCOUNT_KEY='{...}'` (wrap in single quotes so the inner double quotes don't break the env parser)
5. Run:
   ```bash
   npm run migrate-from-sheet
   ```
   It will import Accounts first. Other tables come online as more endpoints are ported (Phase 2+).

The migration is **idempotent** — re-running won't duplicate rows. Safe to run during parallel testing.

---

## Deploying to Vercel

1. In your existing Vercel team, create a **new project**
2. Import the `pushpak-website` GitHub repo
3. **Root Directory**: set to `portal-app` (this is the critical step — Vercel deploys from this subdir only)
4. Add all env vars from your `.env` to **Settings → Environment Variables**
5. Deploy
6. Once deployed, add `app.flypushpak.com` to this project's domains
   (you'll need to move it OFF the existing marketing project first)

The existing `flypushpak.com` marketing site stays on its existing Vercel project — untouched.

---

## What's in this scaffold

```
portal-app/
├── package.json
├── tsconfig.json
├── next.config.js                   # Security headers (HSTS, CSP, etc.)
├── prisma/
│   └── schema.prisma                # All 13 tables mirroring legacy sheets
├── lib/
│   ├── db.ts                        # Prisma client singleton
│   ├── password.ts                  # Argon2id + pepper
│   ├── jwt.ts                       # HS256 JWT (jose)
│   ├── cookies.ts                   # HttpOnly + Secure + SameSite=Strict
│   ├── auth.ts                      # requireAuth, role gates, visibleExecNames
│   ├── audit.ts                     # Audit log writer
│   ├── ratelimit.ts                 # In-memory token bucket
│   └── totp.ts                      # 2FA (Google Authenticator)
├── pages/
│   ├── index.tsx                    # Auto-router (signed in? → /portal else /login)
│   ├── login.tsx                    # Login form (creds + 2FA)
│   ├── 2fa-enroll.tsx               # First-time 2FA setup
│   ├── portal.tsx                   # Portal home (placeholder UI; Phase 4 = full port)
│   └── api/
│       ├── login.ts                 # POST — auth, lockout, 2FA challenge
│       ├── logout.ts                # POST — clear cookies + revoke refresh
│       ├── me.ts                    # GET — current user
│       ├── accounts.ts              # GET — visible accounts (RLS-aware)
│       ├── dashboard.ts             # GET — KPI aggregates
│       ├── calls.ts                 # POST — log a call (representative mutation)
│       └── 2fa/
│           └── enroll.ts            # POST — TOTP enrollment (2-phase)
└── scripts/
    ├── seed.ts                      # Initial 11 users
    └── migrate-from-sheet.ts        # Legacy sheet → Postgres (Accounts wired; more TODO)
```

---

## Phase plan from here

- **Phase 1.0 (this)**: Foundation + 5 endpoints + seed + migration template ✓
- **Phase 1.1**: Remaining read endpoints (promises, holds, plans, legal, collections, families, scoreboard, insights)
- **Phase 1.2**: Remaining mutations (mark paid, set tier/stage, hold approve/release, update client, etc.)
- **Phase 2**: FinBook XLS upload pipeline + refresh logic
- **Phase 3**: Vercel Cron jobs (daily email, nightly snapshot)
- **Phase 4**: Port Page-v2.html UI → React components
- **Phase 5**: Migration script — full coverage of every sheet
- **Phase 6**: Parallel testing (1-2 weeks of both portals running)
- **Phase 7**: Cutover. Apps Script becomes a cold backup for 30 days, then retire.

Total remaining effort: ~9 more focused sessions over 4-6 weeks.

---

## Security checklist (already in place)

- [x] Argon2id password hashing with server-side pepper
- [x] HttpOnly + Secure + SameSite=Strict cookies for sessions
- [x] Short access token (15 min) + long-lived refresh token (7 days, hashed in DB)
- [x] 2FA enforced for owner + admin roles (TOTP — Authenticator compatible)
- [x] Per-IP rate limit on login (10/5min)
- [x] Per-account lockout (5 failed attempts → 15 min lock)
- [x] All input validated with Zod (defense against malformed payloads)
- [x] Parameterized queries via Prisma (SQL injection structurally impossible)
- [x] Audit log on every mutation
- [x] HSTS + X-Frame-Options + X-Content-Type-Options + CSP headers (via next.config.js)
- [x] No secrets in code — everything in env vars

Pending (Phase 2+):
- [ ] Row-level security in Postgres (defense in depth — even if API has a bug, DB refuses cross-user reads)
- [ ] Cloudflare in front of Vercel for WAF + DDoS
- [ ] Forced password rotation flow (admin can force a user to reset on next login)
- [ ] Audit log viewer in portal (owner-only)
- [ ] Sentry for error tracking
