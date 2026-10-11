# Xeno — Multi-tenant Shopify Data Ingestion & Insights

> Baseline scaffold. Code lands story-by-story via PRs linked to Jira.

## Stack
- **Frontend:** Next.js (App Router) — `frontend/`
- **Backend:** Node.js 18 + Express — `backend/`
- **DB / ORM:** PostgreSQL + Prisma
- **Auth:** JWT + bcrypt (email/password)
- **Sync:** Shopify webhooks + scheduled sync (node-cron)
- **Deploy:** Vercel (frontend), Render (backend), Railway (Postgres)

## Getting started
See [docs/SETUP.md](docs/SETUP.md) for database (Railway) and local server setup.

## Workflow
1. Every change maps to a Jira story (e.g. `SCRUM-12`).
2. Branch: `feature/SCRUM-12-short-description`
3. Commit/PR title starts with the key: `SCRUM-12: add customers ingestion`
4. PR into `main` → reviewed & merged by the project manager.
