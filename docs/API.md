# API reference

Base URL (local): `http://localhost:3000/api`  
Base URL (production): `https://veriflow-backend.onrender.com/api`

Unless noted, protected routes require:

```http
Authorization: Bearer <jwt>
```

Responses typically use `{ errors: [...] }` or `{ errors: [{ field, message }] }` on failure. Success shapes vary by handler.

This document is a **mount map and capability guide**, not an OpenAPI dump. For request bodies, follow the corresponding `validators/*` and route handlers.

---

## Health

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health` | Public | `{ status, project, time }` |

---

## Auth — `/api/auth`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/register` | Public (rate limited) | Create tutor user + incomplete application |
| POST | `/login` | Public (rate limited) | Issue JWT; may return `tempFlag` |
| PATCH | `/change-password` | JWT | Replace temp/current password; clear `temp_password_flag` |

Strong password rules apply to register and change-password. Login validation is intentionally looser.

---

## Public & settings

| Mount | Purpose |
|-------|---------|
| `/api/public` | Unauthenticated settings needed by apply UI (e.g. applications open) |
| `/api/settings` | Admin read/write system settings, announcement blasts |

---

## Applications — `/api/applications`

Applicant (`tutor`) paths typically use `/me/...`. Admin paths list and mutate any application.

| Capability | Notes |
|------------|-------|
| Read / update own application | Academic patch, document upload, submit |
| Submit + screen | Triggers document screening; status → `submitted` or auto-`rejected` |
| Admin list / detail | Filter by status |
| Admin review actions | Move under review, shortlist, approve, reject; assign lecturer / level |

---

## Users — `/api/users`

| Capability | Notes |
|------------|-------|
| Current user profile | `GET` / patch profile fields |
| Onboarding step 1 / 2 | Identity then banking + tax docs |
| Admin create lecturer | Temp password + optional modules; email credentials |
| Admin manage tutors / lecturers | Including soft operational deletes where implemented |
| Admin reset password | New temp password + `temp_password_flag` |

Role gates: most mutations require `admin` or the owning user.

---

## Sessions — `/api/sessions`

Lecturer-centric; tutors see assigned sessions.

| Capability | Notes |
|------------|-------|
| Create / list / get | Module, time window, venue, assigned tutors |
| Activate | Issues session code + starts QR rotation |
| QR payload | Short-lived tokens for attendance page |
| Complete / cancel / flag | Terminal session states |
| Tutor confirmation | Availability / acceptance on `session_tutors` |

Pagination may be available via `page` / `limit` on heavier list endpoints.

---

## Attendance — `/api/attendance`

Mostly unauthenticated student-facing (rate limited).

| Capability | Notes |
|------------|-------|
| Enter with QR | Validates rotating token → issues attendance pass |
| Sign in | Student number + pass → `attendance_logs` |
| Legacy session code | Older clients may still post session codes |

---

## Claims — `/api/claims` and `/api/admin`

| Mount | Actor | Purpose |
|-------|-------|---------|
| `/api/claims` | Tutor / lecturer | Draft/submit month, lecturer approve/return, timesheet PDF |
| `/api/admin` | Admin | Coordinator claim queue / final approve-return |

Claim status machine: see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Referrals — `/api/referrals`

Lecturer creates referral → admin approves/rejects. Approval may create a tutor user and email a temporary password.

---

## Postings — `/api/postings`

Admin CRUD for tutor vacancy postings. Public/applicant surfaces may read active postings depending on route guards in `postings.js`.

---

## Students & class lists

| Mount | Purpose |
|-------|---------|
| `/api/students` | Admin roster CRUD / import (eligibility for apply) |
| `/api/class-lists` | Lecturer upload/manage per-module class lists used at attendance |

---

## Messaging — `/api/messages`

Lecturer↔tutor threads and coordinator threads. Broadcast / message send paths are rate limited.

---

## Support — `/api/support`

Ticket create/list/reply for tutors/lecturers; admin triage.

---

## Files — `/api/files`

Authenticated download / signed URL issuance for application and onboarding documents. Filenames are sanitized; access is ownership- or role-checked in `files.js`.

---

## Error & limit behaviour

| Concern | Behaviour |
|---------|-----------|
| Validation | HTTP 400 + field errors |
| Auth missing/invalid | 401 |
| Wrong role | 403 |
| Rate limit | 429 with message body from limiter |
| CORS reject | 403 `{ errors: ['Not allowed by CORS'] }` |

Global API limiter defaults to a high ceiling in development and a tighter ceiling in production (`RATE_LIMIT_MAX` / `RATE_LIMIT_DISABLED` can adjust).

---

## Client usage

Prefer `VF.apiFetch(path, { method, body })` from `frontend/js/app.js`. It attaches the Bearer token, parses JSON errors, and throws with `.errors` / `.status` for UI toasts.
