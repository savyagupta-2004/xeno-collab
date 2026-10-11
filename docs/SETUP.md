# Setup Guide

Database runs in the cloud (Railway). Backend and frontend run locally until the deploy story (SCRUM-29).

## Who does what

| Step | Owner |
|---|---|
| Create the Railway project + PostgreSQL, share `DATABASE_URL` privately | Manager |
| Create the Shopify dev store + custom app, share the access token privately | Manager (SCRUM-6) |
| Clone the repo, create `.env`, run backend + frontend locally | Developer |

Secrets (`DATABASE_URL`, Shopify tokens, `JWT_SECRET`) are shared over DM or a password manager. **Never** in GitHub, Jira or Slack channels.

## Prerequisites

- Node.js 18+ (`node -v`)
- Git
- A GitHub account with access to this repo
- Optional: a DB viewer such as Prisma Studio (bundled), TablePlus or DBeaver

## 1. Database on Railway (manager, one time)

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy PostgreSQL**.
3. Open the Postgres service → **Variables** → copy `DATABASE_PUBLIC_URL`.
   - Use the **public** URL for local development. The plain `DATABASE_URL` is internal to Railway and only works from services deployed on Railway.
4. Send that URL privately to the developer.
5. Optional: Railway → Project Settings → Members → invite the developer, so they can see logs and metrics.

> Railway's trial gives one-time credits. If they run out, [Neon](https://neon.tech) is a free-forever Postgres alternative and works the same way. Just swap the URL.

## 2. Clone and configure (developer)

```bash
git clone https://github.com/<owner>/xeno-collab.git
cd xeno-collab
```

Create `backend/.env` by copying `backend/.env.example` (added in SCRUM-7):

```
PORT=5000
DATABASE_URL=<Railway DATABASE_PUBLIC_URL>
JWT_SECRET=<any long random string>
FRONTEND_URL=http://localhost:3000
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## 3. Run the backend locally

```bash
cd backend
npm install
npx prisma migrate dev     # applies migrations to the Railway DB
npm run dev                # http://localhost:5000/api/health
```

Inspect data with `npx prisma studio`.

## 4. Run the frontend locally

```bash
cd frontend
npm install
npm run dev                # http://localhost:3000
```

## 5. Shopify webhooks locally (from SCRUM-19)

Shopify can't reach `localhost`, so expose the backend:

```bash
ngrok http 5000
```

Use the `https://….ngrok-free.app/api/webhooks/shopify` URL as the webhook address.

## Daily workflow

1. Pick a story from the active sprint in Jira and move it to **In Progress**.
2. `git checkout main && git pull`
3. `git checkout -b feature/SCRUM-<id>-short-name`
4. Commit with the key: `git commit -m "SCRUM-<id>: what changed"`
5. Push and open a PR into `main` titled `SCRUM-<id>: …` (the template fills in the checklist).
6. The manager reviews, requests changes or merges. Jira moves the story to Done when GitHub for Jira is connected.

## Rules for the shared database

- Schema changes only through Prisma migrations committed in the PR. No manual `ALTER TABLE` in Railway.
- Never run `prisma migrate reset` on the shared DB without telling the manager, because it wipes all data.
- Pull `main` before creating a new migration to avoid migration conflicts.
