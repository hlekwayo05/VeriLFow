# VeriFlow

Tutor employment and session operations platform for the University of Mpumalanga Student Employment Office (SEO).

VeriFlow covers the full lifecycle: student application → coordinator review → tutor onboarding → scheduled sessions with QR attendance → monthly claims approved by lecturers and the SEO.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Static HTML / CSS / vanilla JS (multi-page) |
| Backend | Node.js, Express |
| Database | PostgreSQL (typically Supabase) |
| Files | Supabase Storage (`veriflow-uploads`), local disk fallback |
| Email | Resend |
| Auth | JWT (Bearer), bcrypt (cost 12) |

There is no SPA framework and no root `package.json`. The API lives under `backend/`; the UI under `frontend/`.

---

## Roles

| Role | Responsibility |
|------|----------------|
| **Student / applicant** | Apply with CV + transcript; track status |
| **Tutor** | Attend sessions, confirm availability, submit monthly claims, message lecturer / support |
| **Lecturer** | Schedule & run sessions, class lists, verify tutor claims, refer tutors |
| **Admin / coordinator** | Postings, application review, user management, claim final approval, settings, analysis |

---

## Repository layout

```
veriflow-project/
├── index.html                 # Redirect → frontend login
├── README.md                  # This file
├── CHANGELOG.md               # Release notes
├── .env.example               # Commented env template (prefer copying into backend/.env)
├── docs/                      # Architecture, API, operations
├── frontend/
│   ├── pages/                 # HTML surfaces (login, apply, dashboards, attendance)
│   ├── css/                   # Shared + role / mobile styles
│   ├── js/                    # app.js (VF), role dashboards, messaging
│   └── images/
└── backend/
    ├── server.js              # HTTP entry
    ├── db.js                  # pg pool
    ├── schema.sql             # Canonical schema (fresh installs)
    ├── seed.js                # Admin bootstrap
    ├── routes/                # /api/* handlers
    ├── middleware/            # JWT auth, roles, rate limits
    ├── services/              # Mail, storage, QR, PDF, screening, cache
    ├── validators/            # express-validator chains
    ├── utils/                 # Password policy, pagination, file checks
    ├── migrations/            # Additive SQL (001-019+)
    ├── scripts/               # Schema apply, migrate, wipe, storage setup
    └── uploads/               # Local fallback (gitignored)
```

Authoritative schema: **`backend/schema.sql`**. Ignore the small root `schema.sql` for ops work.

---

## Quick start (local)

### Prerequisites

- Node.js 18+
- PostgreSQL (local or Supabase)
- Resend account (optional for local; use `EMAIL_OVERRIDE` on free tier)
- Static file server for the frontend (VS Code Live Server, `npx serve`, etc.)

### Backend

```bash
cd backend
npm install
cp ../.env.example .env   # or copy backend/.env.example and fill values
# Edit .env - at minimum DATABASE_URL, JWT_SECRET, SUPABASE_*, CORS_ORIGIN, FRONTEND_URL

npm run db:schema           # fresh empty DB only
npm run db:migrate-pending  # additive migrations not fully baked into older DBs
npm run storage:setup       # create veriflow-uploads bucket
node seed.js                # creates veriflow@ump.ac.za (needs ADMIN_SEED_PASSWORD)
npm run db:modules          # curriculum modules (optional but recommended)
npm run dev                 # http://localhost:3000
```

Health check: `GET http://localhost:3000/api/health`

### Frontend

Serve the repo (or `frontend/`) so pages resolve under something like:

`http://localhost:5500/frontend/pages/login.html`

On localhost / LAN hosts, `frontend/js/app.js` calls `http://<host>:3000/api`.  
Set `CORS_ORIGIN` to your exact browser origin(s), e.g. `http://localhost:5500,http://127.0.0.1:5500`.

Default admin after seed: **`veriflow@ump.ac.za`** / value of `ADMIN_SEED_PASSWORD`.

---

## Documentation map

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, domain model, flows, auth, storage, QR |
| [docs/API.md](docs/API.md) | Route mount map and endpoint groups |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Env vars, migrations, seed/wipe, Render deploy, troubleshooting |
| [CHANGELOG.md](CHANGELOG.md) | What shipped, by milestone |

---

## Core product flows (summary)

1. **Apply** - Step 1 registers the user (`POST /api/auth/register`) and opens an incomplete application. Steps 2-3 collect academics and documents; submit runs automated screening and moves status to `submitted` (or auto-`rejected`).
2. **Review** - Admin moves applications through `under_review` → `shortlisted` → `approved` / `rejected`, optionally assigning a lecturer and responsibility level.
3. **Onboard** - Approved tutors complete identity + banking/tax onboarding; JWT then carries `onboardingComplete`.
4. **Operate** - Lecturers create sessions, activate QR attendance, complete sessions. Tutors submit monthly claims → lecturer → coordinator.
5. **Refer** - Lecturers can refer students; admin approval may create a tutor account with a temporary password.

State machines and table relationships are detailed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security (current baseline)

- Helmet, disabled `X-Powered-By`, CORS allowlist (LAN origins allowed only outside production)
- JWT Bearer auth + `requireRole` gates; tokens expire in **8 hours**
- Strong password policy on register / change / reset (min 8 chars, upper, lower, digit, special); login still accepts older weaker hashes
- bcrypt cost 12; cryptographically generated temporary passwords for lecturers / resets / referrals
- Global + route-specific rate limits (login, register, attendance, uploads, admin actions, …)
- `express-validator` on auth and other write paths
- Upload magic-byte checks (`file-type`); authenticated file download with ownership checks
- Production boot fails if required env vars are missing; warns on weak `JWT_SECRET`

---

## Production snapshot

Current hosted surfaces (partner deploy):

| Service | URL |
|---------|-----|
| Frontend | https://veriflow-frontend.onrender.com |
| API | https://veriflow-backend.onrender.com |

Non-local builds hardcode `PRODUCTION_API` to the Render API in `frontend/js/app.js` (and `attendance-scan.html`). Changing the API host requires a frontend redeploy (or code change).

Production checklist and env requirements: [docs/OPERATIONS.md](docs/OPERATIONS.md).

---

## Scripts (`backend/`)

| Script | Purpose |
|--------|---------|
| `npm start` / `npm run dev` | Run API |
| `npm run db:schema` | Apply `schema.sql` to an empty database |
| `npm run db:migrate-pending` | Apply listed additive migrations |
| `npm run db:modules` | Seed module catalogue |
| `npm run storage:setup` | Ensure Storage bucket |
| `node seed.js` | Upsert admin account |
| `node scripts/wipe-data.js` | Remove users + related data (keeps modules/students/settings/postings) |
| `node scripts/wipe-data.js --all` | Truncate all public tables (then re-run `db:modules` + `seed.js`) |

---

## Contributing notes

- Prefer small, reviewable PRs; update `CHANGELOG.md` under `[Unreleased]` for user-visible work.
- Never commit `.env`, credentials, or `veriflow.session.sql`.
- Schema changes: add a numbered migration under `backend/migrations/` and, when appropriate, fold into `schema.sql` for fresh installs; register in `migrate-pending.js` if existing hosted DBs need it.
- Frontend cache: bump `?v=` on linked JS/CSS when shipping static asset changes.
