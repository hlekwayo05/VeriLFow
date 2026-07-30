# Architecture

How VeriFlow is put together. Companion to the [README](../README.md).

---

## System context

```
┌─────────────────────┐     HTTPS      ┌──────────────────────┐
│  Static frontend    │ ─────────────► │  Express API         │
│  (Render / Live     │   Bearer JWT   │  backend/server.js   │
│   Server / CDN)     │ ◄───────────── │                      │
└─────────────────────┘                └──────────┬───────────┘
                                                  │
                         ┌────────────────────────┼────────────────────────┐
                         ▼                        ▼                        ▼
                  PostgreSQL                 Supabase                 Resend
                  (Supabase)                 Storage                  (email)
```

The frontend is multi-page static HTML. Shared client state and HTTP live in `frontend/js/app.js` under the `VF` namespace. Role-specific UI is large page controllers (`tutor-dashboard.js`, `lecturer-dashboard.js`, `admin-dashboard-api.js`).

The API is a classic Express router mount under `/api/*`. There is no GraphQL layer and no ORM — SQL is written with `pg` in route handlers and services.

---

## Domain model (high level)

### Users & roles

`users.role` ∈ `{ admin, lecturer, tutor }`.

Applicants become `tutor` users at registration. Lecturers are created by admin (or via referral approval flows) and usually receive a temporary password (`temp_password_flag`).

JWT claims (8h TTL) include: `userId`, `role`, name/email, `applicationStatus`, `onboardingComplete`, `tempFlag`.

### Applications

Lifecycle (simplified):

```
incomplete → submitted → under_review → shortlisted → approved
                                      ↘ rejected
                         (screening may auto-reject at submit)
```

Key columns live on `applications` (status, documents, academic fields, `assigned_lecturer_id`, screening scores). Eligibility also depends on the admin-uploaded `students` roster and open application window settings.

### Sessions & attendance

```
scheduled → active → completed
                  ↘ cancelled
                  ↘ flagged (edge / abuse cases)
```

- Lecturer creates a session (`sessions`) and assigns tutors (`session_tutors`).
- Activation issues a rotating QR token (`session_qr_tokens`, short TTL ~10s).
- Student opens `attendance-scan.html`, exchanges QR for an attendance pass (`attendance_passes`), then posts student number → `attendance_logs`.
- Class list membership (`class_list_entries`) constrains who may sign in for a module.

### Claims

```
tutor submits month
    → pending_lecturer
        → pending_coordinator   (lecturer approved)
        → returned_by_lecturer
            → pending_coordinator
                → approved | returned_by_coordinator
```

Claims aggregate completed session hours for a tutor/month (`claims` + `claim_sessions`). PDF timesheets are generated server-side (`services/timesheetPdf.js`).

### Messaging & support

- Peer threads: `message_threads` / `messages` / `message_thread_reads` (lecturer ↔ tutor).
- Coordinator threads: `coordinator_*` tables for SEO ↔ user messaging.
- Support tickets: `support_tickets` / `support_ticket_replies`.

### Referrals & postings

- `postings` — public/admin job advertisements for tutor openings.
- `referrals` — lecturer nominates a student; admin approval can provision accounts and email credentials.

---

## Backend layering

| Layer | Location | Responsibility |
|-------|----------|----------------|
| HTTP | `server.js` | Helmet, CORS, rate limits, mount routers, health |
| Routes | `routes/*.js` | AuthZ checks, validation wiring, request orchestration |
| Middleware | `middleware/` | JWT parse, role gate, specialized limiters |
| Validators | `validators/` | Input shape & password rules |
| Services | `services/` | Cross-cutting: mail, storage, QR, screening, cache, PDF |
| Utils | `utils/` | Password policy, pagination, file magic bytes |
| Data | `db.js` + SQL | Connection pool; queries inline in routes |

### Caching

`services/cache.js` is an in-process TTL cache (default ~30s via `API_CACHE_TTL_MS`). Suitable for read-heavy lecturer/admin lists on a single Render instance — not a distributed cache.

### Document screening

On application submit, `documentScanner.js` / `pdfText.js` extract text (PDF parse + optional OCR) and score against thresholds from settings. Failures can auto-reject with reasons surfaced to the applicant.

---

## Frontend architecture

### API base resolution (`VF.API_BASE`)

1. Host is `localhost`, `127.0.0.1`, or private LAN (`192.168.*` / `10.*`) → `http(s)://<host>:3000/api`
2. Otherwise → hardcoded production API `https://veriflow-backend.onrender.com/api`

`attendance-scan.html` duplicates this logic (standalone page; students may open it without the full dashboard bundle).

### Auth UX

- Token stored in `sessionStorage` (`vf_token`) — tab-scoped, not shared across browsers.
- `VF.requireAuth` / `VF.requireRole` gate pages.
- `tempFlag` → force `change-password.html`.
- Tutors are routed by application / onboarding state (`VF.routeTutor`, `resolveTutorRoute`).

### Page map

| Area | Pages |
|------|-------|
| Auth | `login.html`, `change-password.html` |
| Apply | `apply-step1..3.html`, `submitted.html`, `rejected.html`, `tracker.html` |
| Onboarding | `onboarding-step1.html`, `onboarding-step2.html` |
| Dashboards | `dashboard.html` (tutor), `lecturer-dashboard.html`, `admin-dashboard.html` |
| Attendance | `attendance-scan.html` |

Mobile layouts are CSS-driven (`veriflow-mobile.css`, `*-mobile-pages.css`) with the same HTML shells — not a separate mobile app.

---

## Auth & password policy

| Action | Rules |
|--------|-------|
| Register / change password / reset | Strong password (`utils/passwordPolicy.js`): ≥8 chars, upper, lower, digit, special |
| Login | Length/presence only — existing weaker passwords remain usable |
| Temp passwords | `utils/tempPassword.js` always satisfies strong policy |

Forced password change clears `temp_password_flag` via `PATCH /api/auth/change-password`.

---

## Files & email

### Storage path

1. Multer writes to disk under `backend/uploads/` (or related paths).
2. `services/storage.js` uploads to Supabase bucket `veriflow-uploads`.
3. Clients fetch via `/api/files/...` with JWT; server returns signed URLs (or streams local fallback).

Do not expose the uploads directory as a public static mount.

### Email

`services/mailer.js` sends transactional mail through Resend: approvals, rejections, lecturer welcome, password reset, claim status, announcements, referrals.

- `EMAIL_OVERRIDE` — when set, all recipients are rewritten (dev / Resend sandbox).
- Link bases: `FRONTEND_URL`, `PORTAL_URL`.

---

## QR attendance sequence

```
Lecturer activates session
        │
        ▼
Rotating token written (session_qr_tokens)
        │
        ▼
QR encodes FRONTEND_URL attendance page + token payload
        │
        ▼
Student scans → POST /api/attendance/enter → attendance_pass
        │
        ▼
Student enters student number → POST /api/attendance
        │
        ▼
Row in attendance_logs (validated against class list / session window)
```

Rate limited by IP + student number to reduce brute force on student numbers.

---

## Settings

Runtime configuration (application window open/closed, screening thresholds, announcement content, etc.) is stored in `settings` / `system_settings` and exposed via `/api/public` (read) and `/api/settings` (admin write). Prefer these over redeploys for operational toggles.

---

## Design constraints (intentional)

- **Static MPA** — simple hosting, no build step; trade-off is duplicated logic and cache-busting query params.
- **SQL in routes** — fast to change for a small team; keep transactions careful on multi-table writes (claims, wipe of users, session complete).
- **Single-region Render + Supabase** — cold starts and pooler limits matter; prefer session pooler for `DATABASE_URL`.
- **Hardcoded production API URL** — removes env injection on static hosting; couples frontend deploys to that hostname.
