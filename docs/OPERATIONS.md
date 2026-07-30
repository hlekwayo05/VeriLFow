# Operations

Runbooks for local setup, database lifecycle, environment, and production (Render).

---

## Environment variables

Copy [`.env.example`](../.env.example) into `backend/.env` for local work. Production should set the same keys in the host’s secret store (`backend/.env.example` is the thinner deploy-oriented checklist).

### Required in production

Boot fails if these are missing when `NODE_ENV=production` (`server.js`):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (prefer Supabase **session** pooler, port 5432) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | **service_role** key — never the anon key, never ship to the browser |
| `JWT_SECRET` | ≥32 random characters (`openssl rand -hex 32`) |
| `CORS_ORIGIN` | Comma-separated exact origins (no trailing slash) |

### Strongly recommended

| Variable | Purpose |
|----------|---------|
| `FRONTEND_URL` | Base used in QR links and many emails (e.g. `https://veriflow-frontend.onrender.com/frontend`) |
| `PORTAL_URL` | Apply deep-link in emails |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Transactional mail |
| `ADMIN_SEED_PASSWORD` | Only for `node seed.js` — not read at runtime for login |
| `TRUST_PROXY` | `1` (or true) behind Render so rate limits see client IPs |

### Development helpers

| Variable | Purpose |
|----------|---------|
| `EMAIL_OVERRIDE` | Redirect **all** outbound email to one inbox |
| `DATABASE_SSL` | Force SSL when needed outside Supabase auto-detect |
| `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_MS` / `DB_CONNECT_TIMEOUT_MS` | Pool tuning |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_DISABLED` | Soften or disable global limiter |
| `API_CACHE_TTL_MS` | In-process cache TTL (default ~30000) |

Never commit `backend/.env`.

---

## Database lifecycle

### Fresh database

```bash
cd backend
npm run db:schema           # applies backend/schema.sql — expect failure if objects already exist
npm run db:migrate-pending  # apply additive migrations listed in scripts/migrate-pending.js
npm run db:modules          # module catalogue
node seed.js                # admin user
npm run storage:setup
```

### Existing database (hosted)

Prefer additive migrations only:

```bash
npm run db:migrate-pending
# or targeted: node scripts/run-migration-0xx.js / migrate-*.js one-offs
```

`migrate-pending.js` currently applies:

- `010_session_tutor_confirmation.sql`
- `013_tutor_onboarding_persist.sql`
- `014_class_list_email.sql`
- `016_end_time_and_qr_tables.sql`
- `017_session_tutors_tutor_index.sql`
- `018_session_cancelled_status.sql`
- `019_perf_indexes_partition.sql`

When you add a migration that older environments need, append it to that list **and** fold the change into `schema.sql` for greenfield installs.

### Empty all data (keep schema)

```bash
cd backend
node scripts/wipe-data.js
node seed.js                # restore admin
npm run db:modules          # restore modules if required
```

`wipe-data.js` truncates every `public` table with `RESTART IDENTITY CASCADE`. Irreversible. Do not run against production unless that is explicitly intended.

### Seeded admin

| Field | Value |
|-------|-------|
| Email | `veriflow@ump.ac.za` |
| Password | `ADMIN_SEED_PASSWORD` from `.env` at seed time |

Re-running `seed.js` upserts that admin and removes known demo emails if present.

---

## Local process model

Terminal A — API:

```bash
cd backend && npm run dev
```

Terminal B — static UI (example):

```bash
# from repo root, any static server that preserves /frontend paths
npx --yes serve -l 5500 .
```

Then open `http://localhost:5500/frontend/pages/login.html`.

Align:

```env
CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500
FRONTEND_URL=http://localhost:5500/frontend
PORTAL_URL=http://localhost:5500/frontend/pages/apply-step1.html
```

Phone QR testing on LAN: use your machine’s LAN IP in `FRONTEND_URL` and add that origin to `CORS_ORIGIN`. Non-production CORS also permits private LAN origins automatically.

---

## Production (Render)

Current partner deployment:

| Tier | Service |
|------|---------|
| Web static / static site | `https://veriflow-frontend.onrender.com` |
| Web service (Node) | `https://veriflow-backend.onrender.com` |

### Backend service

- Root / start: `backend` → `npm start` (or `node server.js`)
- `NODE_ENV=production`
- Set all required env vars above
- Example CORS:

  ```text
  CORS_ORIGIN=https://veriflow-frontend.onrender.com
  FRONTEND_URL=https://veriflow-frontend.onrender.com/frontend
  ```

- Leave `EMAIL_OVERRIDE` empty for real recipient delivery
- Verify Resend domain before expecting `@ump.ac.za` inbox delivery

### Frontend service

Static files from the repo. Production hosts are **not** treated as localhost, so the browser calls the hardcoded:

```text
https://veriflow-backend.onrender.com/api
```

in `frontend/js/app.js` and `frontend/pages/attendance-scan.html`.

If the API hostname changes, update those constants and redeploy the frontend.

### Post-deploy smoke

1. `GET /api/health` → `status: ok`
2. Login as seeded admin
3. Confirm CORS (browser network tab — no CORS errors from the frontend origin)
4. Upload a small PDF on apply/onboarding and open it back via Files
5. Create a session, activate, open attendance URL on a phone

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Login fails after wipe | Admin row gone — run `node seed.js` |
| CORS errors in browser | Origin missing from `CORS_ORIGIN` or trailing slash mismatch |
| Rate limit / wrong IP bans | `TRUST_PROXY` not set behind Render |
| Supabase connect timeouts | Using direct IPv6-only host; switch to session pooler URL |
| Emails only to one inbox | `EMAIL_OVERRIDE` still set |
| Files 401 / broken preview | Missing JWT, Storage misconfig, or bucket not created (`storage:setup`) |
| Frontend hits wrong API | Non-local host using hardcoded Render URL; or local not detected as LAN |
| `db:schema` fails mid-way | DB not empty — use migrations instead of re-applying full schema |
| Weak password rejected on apply | Expected — strong policy on register (see `passwordPolicy.js`) |

---

## Security ops checklist

- [ ] Rotate `JWT_SECRET` if leaked; existing sessions invalidate
- [ ] Rotate Supabase service key if exposed in logs/chat
- [ ] Confirm `ADMIN_SEED_PASSWORD` is strong and not reused across envs
- [ ] Confirm production `EMAIL_OVERRIDE` is blank
- [ ] Confirm `CORS_ORIGIN` is exact production frontend origin(s) only
- [ ] Keep Render / Supabase access limited to the team
- [ ] After shared DB wipes, re-seed and notify partners before they debug “broken login”
