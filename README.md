# VeriFlow — Tutor Management System

## About

VeriFlow is a tutor management web application built for the Student Employment Office at the University of Mpumalanga. It manages the full lifecycle of student tutor applications, from submission through to session management, attendance tracking, and monthly claim processing.

## Tech Stack

- Frontend: Vanilla HTML, CSS, JavaScript
- Backend: Node.js with Express
- Database: PostgreSQL (Supabase hosted)
- File Storage: Supabase Storage
- Email: Resend API
- Authentication: JWT

## Roles

- **Students** — apply for tutor positions
- **Tutors** — manage sessions, log attendance, submit monthly claims
- **Lecturers** — schedule sessions, verify claims, manage class lists
- **Admin/Coordinator** — full system management, approvals, reporting

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL or Supabase account
- Resend account for email

### Installation

```bash
cd backend
npm install
cp ../.env.example .env
# Fill in your .env values (DATABASE_URL, JWT_SECRET, SUPABASE_*, RESEND_*)
npm run db:schema
npm run storage:setup
npm run dev
```

Serve the `frontend/` pages with any static server (for example Live Server on port 5500) and point `CORS_ORIGIN` / `FRONTEND_URL` at that origin.

### Environment Variables

See `.env.example` for all required variables. Never commit `backend/.env`.

Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Supabase pooler recommended) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (server-side Storage only) |
| `JWT_SECRET` | Signing key for auth tokens |
| `ADMIN_SEED_PASSWORD` | Password used only by `seed.js` |
| `RESEND_API_KEY` | Transactional email |

### Key Features

- Student application portal with document screening
- QR code attendance system
- Monthly timesheet and claims workflow
- Role-based dashboards for tutors, lecturers, and coordinators
- Automated email notifications
- Supabase Storage for document management

## Project Structure

```
veriflow/
├── frontend/          # HTML/CSS/JS frontend
│   ├── pages/         # All HTML pages
│   ├── css/           # Stylesheets
│   ├── js/            # JavaScript files
│   └── images/        # Brand assets
├── backend/           # Node.js backend
│   ├── routes/        # Express route handlers
│   ├── services/      # Business logic + Storage client
│   ├── middleware/    # Auth middleware
│   ├── migrations/    # Database migrations
│   ├── uploads/       # Local upload fallback (gitignored)
│   └── schema.sql     # Full database schema
└── README.md
```

## Deployment

1. Point `DATABASE_URL` at Supabase (session pooler).
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Run `npm run storage:setup` to ensure the `veriflow-uploads` bucket exists.
4. Deploy the Express API and serve the frontend over HTTPS.
5. Configure `CORS_ORIGIN`, `FRONTEND_URL`, and Resend for production domains.

See your deployment guide for host-specific steps (Render, Railway, Vercel, etc.).
