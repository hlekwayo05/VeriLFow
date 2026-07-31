# Changelog

All notable changes to **VeriFlow** (tutor employment / management platform for the University of Mpumalanga Student Employment Office).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow chronological project milestones.

---

## [Unreleased]

### Security
- **Strong password policy** on register, change-password, and password reset: min 8 characters with uppercase, lowercase, number, and special character (enforced in UI checklist + backend validators). Login still accepts existing weaker passwords. Temporary passwords always meet the same rules.

### Added
- Shared shimmer **skeleton loaders** (`skeleton.css` + `VF.skeleton`) across lecturer, tutor, and admin dashboards and messaging
- DB performance migration (`019`): indexes, optional pagination, short TTL response cache, `attendance_logs` partitioning
- `backend/scripts/wipe-data.js` — remove users + related operational data; preserves modules, students, settings, postings (`--all` for full truncate)
- Project documentation: expanded `README.md` plus `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/OPERATIONS.md`

### Changed
- Admin Analysis desktop layout uses full-width grid (payout/module charts side-by-side); mobile Analysis kept on original compact sizing
- Lecturer Tutors page desktop view restored to card grid (was broken against 6-column table CSS)
- Reduced decorative comment wallpaper across backend routes, frontend JS/CSS, and dashboard HTML (kept non-obvious “why” notes and useful JSDoc)

### Fixed
- Tutor dashboard treated cancelled sessions as Upcoming; cancelled sessions now show correctly with clear status/actions
- Submitted page stuck on “Loading your application…” because a top-level `return` made the inline script illegal in the browser

### Planned / in progress
- Continued mobile UX polish across remaining lecturer surfaces
- Production hardening follow-ups (stronger JWT secrets, email routing)

---

## [0.4.0] — 2026-07-29

### Added
- **Admin mobile** — Applications list + full-page application detail, sticky review actions with reveal-on-scroll, document preview sheet
- **Admin mobile User Management** — Compact lecturer/tutor/student cards, person action bottom sheet, sticky Add Lecturer / Add Student / Import CTAs
- **Add Lecturer** bottom sheet with module rows and traveling glow on inputs/buttons
- **Lecturer mobile** — Sessions sticky **New Session** CTA, New Session + Refer a Tutor bottom sheets matching mobile mock
- Shared mobile design system styles: `veriflow-mobile.css`, `admin-mobile-pages.css`, `lecturer-mobile-pages.css`, `auth-onboarding.css`
- Traveling conic **glow** on primary CTAs and focused form inputs (login, apply, onboarding, admin/lecturer sheets)

### Changed
- Tutor / lecturer / admin dashboards redesigned for phone viewports (hubs, filter tabs, cards, empty states)
- Application submit flow supports reusing previously uploaded CV/transcript while validating fresh uploads
- Landing / apply / onboarding / login pages aligned to mist + teal mobile visual language
- Collaborator workflow: local mobile UI merged with partner backend; shared remote set to `hlekwayo05/VeriLFow`

### Fixed
- Onboarding dropdown focus glow now matches other inputs
- Application detail review actions only appear after scrolling to end of content

---

## [0.3.0] — 2026-07-28

### Added
- Production-oriented `backend/.env.example` and server bootstrap docs for deployment
- Helmet, CORS allowlists, trust-proxy awareness, and clearer startup diagnostics in `server.js`

### Changed
- Backend prepared for hosted deployment (security headers, origin configuration, runtime warnings for weak JWT secrets)

---

## [0.2.0] — 2026-07-19

### Added
- **Input validation** via `express-validator` for auth, applications, claims, students, and users
- **Rate limiting** middleware across sensitive routes
- **File content validation** (`file-type`) for PDF uploads beyond extension/MIME checks

### Security
- Hardened auth, users, claims, applications, students, messages, postings, referrals, and support routes
- Stricter request validation and safer error handling on write endpoints

---

## [0.1.2] — 2026-07-17

### Fixed
- Attendance rate-limiter IPv6 key generation warning (`express-rate-limit` `ipKeyGenerator`)

---

## [0.1.1] — 2026-07-16

### Added
- Supabase DB tooling: schema apply, module seed, pending migration helpers, connectivity checks
- Session tutors index migration (`017_session_tutors_tutor_index.sql`)

### Changed
- Tutor and lecturer dashboard UI refinements
- Messaging improvements (inbox / thread behaviour)
- Schema and seed tightened for hosted Postgres (Supabase)

---

## [0.1.0] — 2026-07-16

### Added
- Supabase Storage dual-write for application documents with signed download URLs
- Storage bucket setup script (`storage:setup`)
- Project README and private-repo `.gitignore` / `.env.example` guidance

### Security
- Removed hardcoded seed passwords (use `ADMIN_SEED_PASSWORD` and related env vars)
- Closed session-related IDOR gaps on session access

### Changed
- File download/serving routed through authenticated signed URLs where applicable
- Seed script and upload paths updated for Storage-backed files

---

## [0.0.1] — 2026-07-14

### Added
- Initial **VeriFlow** platform:
  - Student application portal (multi-step apply, tracker, onboarding)
  - Tutor dashboard (sessions, attendance QR, claims)
  - Lecturer dashboard (sessions, tutors, claims, class lists, referrals)
  - Admin/coordinator dashboard (applications, users, postings, support, reporting)
  - Messaging between roles
  - JWT auth, PostgreSQL schema, Resend email hooks
  - Early mobile-responsive dashboard shells

---

## Role summary (current)

| Role | Highlights |
|------|------------|
| **Student** | Apply, upload CV/transcript, track status, onboarding |
| **Tutor** | Sessions, QR attendance, monthly claims, mobile hub |
| **Lecturer** | Schedule sessions, refer tutors, approve claims, class lists |
| **Admin** | Review applications, manage users, postings, support, mobile review sheets |

## Contributors

- Sthembiso Khoza
- hlekwayo05
