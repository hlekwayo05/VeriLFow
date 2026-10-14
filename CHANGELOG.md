# Changelog

All notable changes to **VeriFlow** (tutor employment / management platform for the University of Mpumalanga Student Employment Office).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow chronological project milestones.

---

## [Unreleased]

### Planned / in progress
- Continued mobile UX polish across remaining lecturer surfaces
- Email routing follow-up (clear production `EMAIL_OVERRIDE` when ready for real recipients)
- Coverage-matrix open Fails (auth #3, files #21–22, attendance #25/#28/#29, XSS High sinks) — see full-system-audit canvas; re-score only after fixes, do not invent new finding series mid-pass

---

## [0.12.0] - 2026-10-14

### Added
- Sessions are also flagged when tutors confirmed but no students attended, or when the session actually ran outside 08:00–20:00 (SAST) or past midnight; reasons are stored per session (migration 032: `activated_at`, `completed_at`, `flag_reasons`, `flag_outcome`)
- Admin flag resolution offers Approve, Approve with warning, or Reject, with per-reason guidance; a note is required for warnings and rejections
- Warning and rejection notes are messaged to every assigned tutor and the lecturer (Student Employment Office thread) and shown on the session for tutors and lecturers, with an outcome chip (“Rejected - not claimable”, “Approved with warning”, “Flag approved”)
- HR pack download shows a centred, real-time progress overlay (building, zipping, downloading) with a blurred backdrop
- Styled confirm modal for removing a student (replaces the browser confirm)

### Changed
- HR pack includes every approved tutor / demonstrator in the selected SC or UCDG list, not only those with an accepted offer and staff number
- Toasts redesigned to match the login button (dark card, animated glow border, readable weight), stay at least 10 seconds, pause on hover and dismiss on click; all dashboards use the shared toast
- Flagged sessions table shows “Lecturer” instead of “Reported by”; the investigate view lists flag reasons, scheduled vs actual run time, confirmed tutors and attendance
- Tutors and lecturers see “Flagged - under review” with the reasons while a session awaits resolution

### Removed
- Admin “Reset pwd” buttons for tutors, demonstrators and lecturers (desktop and mobile sheet)

### Fixed
- Dashboard toasts that vanished after about half a second (hidden by dashboard CSS) and overlapping toast elements
- Admin Investigate modal crashing on flagged sessions
- Rejected flagged sessions can no longer be claimed and no longer count towards tutor hours

---

## [0.11.1] - 2026-10-12

### Changed
- README lists the admin login details at the top

---

## [0.11.0] - 2026-10-10

### Added
- Admin approval modal assigns Tutor / Demonstrator and module (from the applicant's course curriculum) alongside responsibility level and cost centre; the assigned module drives lecturer assignment
- Lecturer referrals capture Tutor / Demonstrator (migration 031); approval copies the role onto the application, and referral emails name the role
- Lecturer dashboard shows the latest overdue session (never started) instead of “No upcoming sessions” when nothing is scheduled ahead

### Changed
- Apply Step 2 no longer asks for position type, year & semester, or module; submit screening requires all transcript modules passed plus the minimum average
- Application approval email lists the assigned role and module (with code)
- Pending applications show “Assigned at approval” for module and role in admin and student views

---

## [0.10.0] - 2026-10-10

### Removed
- Job Postings from the admin dashboard, `/api/postings`, and the `postings` table (migration 030)

### Changed
- Apply Step 2 and document screening use global Eligibility Requirements (min average, 3rd-year minimum, module pass mark, CV keywords) instead of per-module posting rules

---

## [0.9.0] - 2026-10-09

### Added
- Admin User Management SC / UCDG cost-centre toggle; HR pack ZIP downloads only the selected centre (required `costCentre` query)
- Tutor / demonstrator Profile field to enter the HR staff number (replaces admin CSV import in the UI)
- Timesheet PDF embeds each session’s attendance register; the Att. figure links to that page
- Lecturer live sessions show Register / End Session only; scheduled sessions keep Activate / Postpone / Cancel with a styled cancel modal

### Changed
- Admin HR pack control is a short “Download HR Pack” pill; staff-number CSV export / upload buttons removed from Tutors and Demonstrators
- Lecturer claim review uses a compact session table and a scrollable panel instead of stacked field cards
- Tutor claims timesheet attendance count opens the register (desktop and mobile)

### Fixed
- Local HR PDF generation falls back to system Chrome when the Puppeteer cache browser is missing; nodemon ignores `.cache` so Chrome install does not restart the API

---

## [0.8.0] - 2026-09-28

### Added
- Application announcement emails include a personal Apply link that prefills surname, initials (from first name and surname), first names, email, and student number on Step 1. Those fields stay editable. Title, cell, and password are left blank. The student list is unchanged.
- Lecturer dashboard shows the next upcoming session (with date) when nothing remains today on the selected module

### Fixed
- Full-system audit remediation (F1–F17): register no longer overwrites passwords on resume; server-side `tempFlag` API gate; production ignores `EMAIL_OVERRIDE` unless `EMAIL_OVERRIDE_ALLOW_IN_PRODUCTION`; JWT `token_version` revocation (migration 028); admin/tutor claim & timesheet XSS escapes; `apiFetch` clears session on 401; claim cache invalidation on create/resubmit/coordinator-approve; block return of approved claims; timesheet PDF uses `confirmed_at` eligibility; unclaimed-session banner copy; generic screening error notes; storage upload fails hard in prod + unlinks temps; crypto session codes; class-list full-replace disabled; omit `staff_number` from lecturer tutor roster; change-password rate limit + login timing dummy hash; apply-step1 tutor role gate when authenticated
- Full-system re-audit remediation (R1–R15): file download auth uses shared `authenticate` (tempFlag + token_version); change-password wrong-password returns 400 (no forced logout); one-time attendance passes (migration 029); claim return/resubmit status-guarded UPDATEs; claim deadline enforced server-side; resolve-flag sets tutor `confirmed_at` + cache invalidate; lecturer tutor/referral DTOs drop email/cell/gpa; register/forgot-password enumeration hardening; Active class-list filter; admin/tutor/lecturer/messaging XSS sweep; TEMP_PASSWORD_REQUIRED redirect; referral/support rate limits; message reply length cap; prod fail-closed if `token_version` column missing
- Full-system third-pass remediation (S1–S6): invalidate prior unused attendance passes when minting; authenticate overlays live DB role + `tempFlag`; prod fail-closed if pass `used_at` missing; legacy `sessionCode` attendance returns 410 unless `ALLOW_LEGACY_ATTENDANCE_CODE`; bump `token_version` when referral promote changes role; escape admin qual chips + lecturer hub module attributes
- Apply Step 2 advances to documents (submit is handled in script, so Next no longer reloads the same page)
- Apply Step 3 submit keeps uploaded files on disk until screening finishes, and casts status so the application update succeeds
- Lecturer lecture icon and Demo label use the dashboard grey instead of purple

---

## [0.7.7] - 2026-09-23

### Fixed
- Application process audit remediation: screening fails closed on errors; draft docs resolved from Supabase for submit; `closing_date` enforced via `accepting_applications`; incomplete apps may finish after window close; draft upload rate-limit + magic-byte checks; academic/submit status locks; posting mins validated before academic save; apply steps require tutor role; demonstrator module pass checks; CV keyword word-boundary matching; tighter student-number + qualification validators; UX copy / cache version cleanup
- Tutor / demonstrator dashboard audit remediation: claim sessions filtered to period + `confirmed_at`; staff-number gate on create/resubmit; pending claims locked (no mid-review update); reject partial session ID lists; disable submit UI without staff number; onboarding pages require tutor role; demonstrator nav/title branding; support ticket thread + reply UX; remove dead lecturer-message modal; enable mobile calendar month nav; profile student-number / SA cell validation
- Lecturer dashboard audit remediation: assigned-only CV/transcript file access; validate session tutorIds; approve submitted claim lines without silent rewrite; session activate/complete status machine; class-list upsert (no default wipe) + import caps; live session code/QR/register UI; mobile calendar nav; real nav badges; referral list no longer mutates orphans; filter/session/claim UX fixes; claims CSV export; support ticket threads; XSS escapes; message/support body limits

---

## [0.7.6] - 2026-09-20

### Fixed
- Admin audit remediation: omit temp passwords from API JSON; block referral approve from demoting admin/lecturer; enforce application approve/reject status transitions; halt admin dashboard init when role gate fails; mobile HR ZIP/CSV CTAs; remove dead Flagged investigate controls and decorative System Flags; staff-number import conflict checks + unique index; persist flag resolution notes; rate-limit sensitive admin mutations; stricter settings PATCH validation; generic PDF/ZIP 500 errors; clearer mobile bottom-nav active state

---

## [0.7.5] - 2026-09-20

### Changed
- Production boot fails on a weak/default `JWT_SECRET` (still warns only in development); email routing left unchanged for now

---

## [0.7.4] - 2026-09-20

### Fixed
- HR Form D / Confirmation PDF generation no longer times out on Render (`setContent` uses `load` instead of `networkidle0`, longer timeout, pages closed after each PDF)

---

## [0.7.3] - 2026-09-20

### Fixed
- Puppeteer Chrome install for Render (HR Form D / Confirmation / ZIP packs): project-local cache via `.puppeteerrc.cjs`, `postinstall` browser download, and Linux-friendly launch flags

---

## [0.7.2] - 2026-09-20

### Fixed
- HR pack ZIP download no longer streams a truncated archive (Windows "invalid ZIP"); build completes before send and the admin UI rejects incomplete downloads

---

## [0.7.1] - 2026-09-20

### Changed
- Form D refuses to generate when `cost_centre` is missing/invalid (no silent school default); prints human-readable Cost Centre next to Institutional Approval; tutor/admin cost-centre labels use Settings approver names

---

## [0.7.0] - 2026-09-08

### Added
- Admin **Download HR packs (ZIP)** - separate tutor and demonstrator packs for accepted appointees without a staff number; each folder has Form D, Confirmation, `CV`, `Academic_Record`, `ID_Copy`, `Tax_Proof`, `Banking_Proof`, plus a staff-number return CSV (`GET /api/users/hr-packs.zip?positionType=`)
- Shared appointment form data loader; tutor and admin HR PDFs both use Puppeteer `formGenerator` (same layout, cost-centre approver, filenames)
- Demonstrators tab HR toolbar (staff-number CSV, ZIP pack, upload staff numbers) and Staff no. column
- Post-approval HR document collection for referred (and any approved) tutors - CV, academic record, ID, tax, and banking proof on onboarding Step 2 and Profile; files write to `applications` (+ user ID/tax/bank sync)
- Lecturer referral form auto-fills course/module from the selected module tab (lecturer only enters name, surname, email, qualification)
- Referral approval sets `student_number` from numeric UMP emails (e.g. `230383025@ump.ac.za` → `230383025`)
- Referral approval fills **Faculty** and **Module year level** from the lecturer's curriculum module

### Changed
- Staff-number CSV export only includes people who have clicked **I accept** (`offer_accepted_at`) and still lack a staff number; filtered by tutor vs demonstrator
- Form D / Confirmation hourly rates read from shared `getRateEntry` instead of a duplicated table
- HR pack supporting docs use stable filenames (no unreliable upload original names)
- **I accept** requires all five HR documents on file (blocks incomplete referred packs)
- Referral create resolves course/module name from `lecturer_modules` by module code (no client course mismatch)
- Referral Approvals table no longer shows Average (referred tutors have no GPA)
- Tutor dashboard appointment banner hides after the offer is accepted (forms stay on Profile)

### Removed
- Stop tracking `.cursor/` in git (local Cursor rules stay on disk; not published to GitHub)

---

## [0.6.0] - 2026-09-03

### Added
- Apply Step 3 required HR documents - ID copy, tax number proof, banking proof (`idFile` / `taxFile` / `bankFile`)
- System Settings **Appointment Configuration** - appointment dates, director name/title/email, School of Computing and UCDG approvers
- Admin PDF downloads for approved applications - Appointment Form D and Confirmation Form via Puppeteer (`GET /api/appointments/:id/form-d|confirmation`)
- HR staff-number workflow - `users.staff_number`, Export for HR CSV, Upload HR Staff Numbers CSV, tutors table column, claim submit gated until staff number assigned, tutor profile status
- Tutor **I accept** on Profile after onboarding - records `offer_accepted_at`, stamps name + date on Form D and Confirmation Form for tutor and admin PDFs (no witnesses)
- In-app acceptance modal matching the tutor dashboard design (replaces browser confirm)
- In-browser **View** for Appointment Form D, Confirmation Form, and application documents (CV, academic record, ID, tax, banking) on tutor and admin sides
- Dashboard appointment-forms banner after onboarding - points tutors to Profile to accept; after accept, shows accepted date and that claims wait on staff number

### Changed
- Appointment Form D period dates read `appointment_start_date` / `appointment_end_date` (with legacy fallback)
- Appointment Form D no longer lists “supporting documents required” (those files are already collected in VeriFlow)
- Approval email points students to complete onboarding and accept the appointment in VeriFlow (no PDF attachment)
- Admin application detail lists generated forms and uploaded documents in one Documents section with View / Download
- Admin Form D / Confirmation PDF responses send a real PDF buffer so in-browser preview opens correctly

---

## [0.5.0] - 2026-09-02

### Security
- **Strong password policy** on register, change-password, and password reset: min 8 characters with uppercase, lowercase, number, and special character (enforced in UI checklist + backend validators). Login still accepts existing weaker passwords. Temporary passwords always meet the same rules.

### Added
- **Forgot password** - self-service reset from the login page; email link expires in one hour (`POST /auth/forgot-password`, `POST /auth/reset-password`)
- **User Management - Demonstrators tab** - approved demonstrators listed separately from tutors (`position_type` filter on `/users/tutors`)
- **User Management - Lecturer CSV import** - bulk create lecturers from CSV with columns `first_name`, `surname`, `email`, `cell_number`, `module_assignment`, `course`; module codes resolved from curriculum; welcome email sent for new accounts
- **Position type (Tutor vs Demonstrator)** on applications - step 2 selection, differentiated document screening (demonstrators skip module pass checks)
- **Cost centre** on approval - School of Computing or UCDG required at coordinator approval; shown in admin detail and tutor profile
- Apply step 1 **auto-fill** - student number extracted from `@ump.ac.za` email; SA cell numbers normalised to `+27` format
- Document **original filename** storage (`cv_original_name`, `transcript_original_name`) so uploads show friendly names instead of internal storage paths
- Shared shimmer **skeleton loaders** (`skeleton.css` + `VF.skeleton`) across lecturer, tutor, and admin dashboards and messaging
- DB performance migration (`019`): indexes, optional pagination, short TTL response cache, `attendance_logs` partitioning
- `backend/scripts/wipe-data.js` - remove users + related operational data; preserves modules, students, settings, postings (`--all` for full truncate)
- Project documentation: expanded `README.md` plus `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/OPERATIONS.md`

### Changed
- Admin applications table shows **Tutor** or **Demo** badge next to module name for every applicant
- Tutor profile shows **Cost centre** in its own card (assigned cost centre + finance contact) for approved tutors
- Referral approval now requires **Cost centre** selection (same as direct application approval)
- Admin Messages - separate **Demonstrators** group in contact picker, inbox filter, compose dropdown, and broadcast flows; tutor/demo split by `position_type`
- Lecturer Messages - tutors and demonstrators shown separately with **Tutor** / **Demo** labels, purple avatar for demonstrators, and Demonstrators inbox filter
- Lecturer **My Team** page - tutors and demonstrators with role badges, filter tabs (All / Tutors / Demonstrators), desktop table view, and separate stats for tutors vs demonstrators
- **Announcement email** - apply button links to `apply-step1.html` (fixes broken `/apply.html`); copy includes Tutor and Demonstrator roles
- **2026 UMP tariff alignment** - qualification display names (including PhD Candidate or Holder), full rate table in backend and admin approval flow, read-only Pay Rate Reference in System Settings, and updated legacy settings defaults (59.66 / 73.87 / 90.92)
- Admin **Analysis** desktop layout matches **Dashboard** (two-column grid, stat cards, Reports sidebar); mobile Analysis layout unchanged
- Lecturer Tutors page desktop view restored to card grid (was broken against 6-column table CSS)
- Reduced decorative comment wallpaper across backend routes, frontend JS/CSS, and dashboard HTML (kept non-obvious “why” notes and useful JSDoc)

### Fixed
- Apply step 3 document upload appeared to reset after first save - nodemon no longer restarts when temp upload files are written; UI re-syncs from server after each save
- Apply step 3 showed internal storage filenames (e.g. `2_cvFile_…pdf`) instead of the uploaded document names after save or page reload
- Tutor dashboard treated cancelled sessions as Upcoming; cancelled sessions now show correctly with clear status/actions
- Submitted page stuck on “Loading your application…” because a top-level `return` made the inline script illegal in the browser

---

## [0.4.0] - 2026-07-29

### Added
- **Admin mobile** - Applications list + full-page application detail, sticky review actions with reveal-on-scroll, document preview sheet
- **Admin mobile User Management** - Compact lecturer/tutor/student cards, person action bottom sheet, sticky Add Lecturer / Add Student / Import CTAs
- **Add Lecturer** bottom sheet with module rows and traveling glow on inputs/buttons
- **Lecturer mobile** - Sessions sticky **New Session** CTA, New Session + Refer a Tutor bottom sheets matching mobile mock
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

## [0.3.0] - 2026-07-28

### Added
- Production-oriented `backend/.env.example` and server bootstrap docs for deployment
- Helmet, CORS allowlists, trust-proxy awareness, and clearer startup diagnostics in `server.js`

### Changed
- Backend prepared for hosted deployment (security headers, origin configuration, runtime warnings for weak JWT secrets)

---

## [0.2.0] - 2026-07-19

### Added
- **Input validation** via `express-validator` for auth, applications, claims, students, and users
- **Rate limiting** middleware across sensitive routes
- **File content validation** (`file-type`) for PDF uploads beyond extension/MIME checks

### Security
- Hardened auth, users, claims, applications, students, messages, postings, referrals, and support routes
- Stricter request validation and safer error handling on write endpoints

---

## [0.1.2] - 2026-07-17

### Fixed
- Attendance rate-limiter IPv6 key generation warning (`express-rate-limit` `ipKeyGenerator`)

---

## [0.1.1] - 2026-07-16

### Added
- Supabase DB tooling: schema apply, module seed, pending migration helpers, connectivity checks
- Session tutors index migration (`017_session_tutors_tutor_index.sql`)

### Changed
- Tutor and lecturer dashboard UI refinements
- Messaging improvements (inbox / thread behaviour)
- Schema and seed tightened for hosted Postgres (Supabase)

---

## [0.1.0] - 2026-07-16

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

## [0.0.1] - 2026-07-14

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
