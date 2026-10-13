# Developer Guide

Welcome! This page covers how we work: picking a task, naming branches, committing and opening PRs.
For installing and running the project, see [SETUP.md](SETUP.md).

---

## The big picture

```
Jira story  →  your branch  →  commits  →  Pull Request  →  Savya reviews  →  merged into main
```

- Every piece of work starts from a **Jira story** with a key like **`XENO-5`**.
- You never push to `main` directly. Everything goes through a **Pull Request (PR)**.
- **Savya** (`savyagupta-2004`) reviews and merges every PR.

## Read these first (day 1)

1. **The project brief:** the Epic **[XENO-1](https://xeno-analytics.atlassian.net/browse/XENO-1)**. It explains what we're building, the scope, the release date (3 Nov) and the **Definition of Done** that every story must meet.
2. **The board:** https://xeno-analytics.atlassian.net/jira/software/projects/XENO/boards/2 (your stories for this sprint).
3. **The roadmap:** the **Timeline** tab in Jira shows the Epic and all stories across the 3 sprints.
4. **[SETUP.md](SETUP.md):** get the project running on your machine.

### What we're building, in one paragraph
A web app where a Shopify store owner signs up, connects their store, and sees a dashboard of their business (customers, orders, revenue, top customers, trends). Behind it, our backend pulls data from Shopify (and receives live updates via webhooks), saves it in PostgreSQL, and keeps every store's data separate (multi-tenant). Stack: Express + Prisma + PostgreSQL (Railway) on the backend, Next.js on the frontend.

---

## Step 1: Pick your story

1. Open the Jira board and look at the **active sprint**.
2. Take the **top story that's still in To Do**. Stories are already in the right order, so work top to bottom.
3. Drag it to **In Progress**.
4. Read the **Acceptance criteria** carefully. That's your checklist; the PR is "done" when every point is true.

> One story at a time. Finish (or get it into review) before starting the next.

---

## Step 2: Create your branch

Always start from the latest `main`:

```bash
git checkout main
git pull
git checkout -b <branch-name>
```

### Branch naming

Format: **`type/XENO-<number>-short-description`**, all lowercase, words joined with `-`.

| You are… | Type | Example |
|---|---|---|
| Building something new from a story | `feature` | `feature/XENO-5-auth-api` |
| Fixing a bug | `fix` | `fix/XENO-11-duplicate-customers` |
| Only changing docs or README | `docs` | `docs/XENO-26-readme` |
| Setup, config, CI, dependencies | `chore` | `chore/XENO-24-ci-pipeline` |

✅ `feature/XENO-2-backend-setup`
❌ `my-branch`, `backend`, `XENO2`, `Feature/Backend Setup`

> **The `XENO-<number>` in the name is important.** It's how Jira automatically shows your branch and PR on the story.

---

## Step 3: Commit your work

Commit small and often, not one giant commit at the end.

Format: **`XENO-<number>: what you did`**

```bash
git add .
git commit -m "XENO-5: add register and login endpoints"
```

✅ `XENO-5: hash passwords with bcrypt`
✅ `XENO-5: return 409 when email already exists`
❌ `changes`, `fixed stuff`, `final`, `asdf`

### Never commit

- `.env` files or any secrets (database URL, Shopify tokens, JWT secret)
- `node_modules/`

The `.gitignore` already blocks these, but double-check `git status` before committing.

---

## Before you push: run the checks locally

The same checks run automatically on every PR (see "CI checks" below). Run them first so you don't get a red PR:

```bash
cd backend
npm run format      # auto-fixes formatting
npm run lint        # must show no errors
npm test            # all tests must pass
```

Adding a new feature? **Add tests for it** in `backend/tests/`. A PR without tests for new logic will be sent back.

---

## Step 4: Push and open a Pull Request

```bash
git push -u origin <branch-name>
```

Then on GitHub:

1. Click **"Compare & pull request"** (the yellow banner), or go to **Pull requests → New pull request**.
2. **Base:** `main` ← **Compare:** your branch.
3. **Title:** `XENO-<number>: <story name from Jira>`
   - Example: `XENO-5: Tenant onboarding & email authentication API`
4. **Description:** the template appears automatically. Fill in:
   - **Jira:** the story key, e.g. `XENO-5`
   - **What changed:** 2–4 bullet points in plain words
   - **How to test:** the steps Savya can follow to check it works
   - Tick every box in the **Checklist**
5. On the right side, **Reviewers** → add **`savyagupta-2004`**.
6. **Assignees** → assign yourself.
7. Click **Create pull request**.
8. In Jira, move the story to **In Review**.

---

### CI checks (automatic)

When you open or update a PR, GitHub runs our pipeline. You'll see it at the bottom of the PR:

| Check | What it means |
|---|---|
| **Backend (Node 22 / 24)** | Formatting, lint, tests, dependency audit, and the server actually starts |
| **Frontend** | Lint and production build (once the frontend exists) |
| **Security scan (CodeQL)** | Looks for security bugs in the code |
| **Dependency review** | Blocks new packages that have known serious vulnerabilities |
| **CI passed** | ✅ only if everything above passed |

- ✅ **All green:** Savya can review.
- ❌ **Red:** click **Details** next to the failed check, read the error, fix it on your branch and push again. The checks re-run on their own.
- A red PR is **not reviewed or merged**, so fix it first.

---

## Step 5: Review and merge

- Savya will either **approve**, or leave **comments / request changes**.
- If changes are requested:
  1. Fix them on the **same branch**.
  2. Commit and push again (`git push`). The PR updates by itself, so don't open a new one.
  3. Reply to each comment (e.g. "Done" or explain why not).
  4. Click **Re-request review** next to Savya's name.
- Once approved, **Savya merges** the PR and the story moves to **Done**.

After your PR is merged, clean up and get ready for the next story:

```bash
git checkout main
git pull
git branch -d <your-old-branch>
```

---

## If your branch is behind main

If GitHub says your branch is out of date or has conflicts:

```bash
git checkout main
git pull
git checkout <your-branch>
git merge main
```

Fix any conflicts, then commit and push. Stuck on a conflict? Ask before force-pushing anything.

---

## Golden rules

1. **Story key everywhere:** branch, commits and PR title all have `XENO-<number>`.
2. **Never push to `main`.** Always use a branch and a PR.
3. **One story = one branch = one PR.**
4. **Green CI before review.** Never ask for a review on a red PR.
5. **Keep Jira updated:** To Do → In Progress → In Review → (Savya) Done.
6. **No secrets in code.** `.env` stays on your machine; use `.env.example` for variable names.
7. **Database changes only through Prisma migrations** included in your PR.
8. **Stuck for more than ~1 hour? Ask.** Comment on the Jira story or message Savya. Asking early is a good thing, not a weakness.

---

## Quick cheat sheet

```bash
# start a story
git checkout main && git pull
git checkout -b feature/XENO-5-auth-api

# save work
git add .
git commit -m "XENO-5: add login endpoint"
git push -u origin feature/XENO-5-auth-api

# after merge
git checkout main && git pull
git branch -d feature/XENO-5-auth-api
```

PR title → `XENO-5: Tenant onboarding & email authentication API`
Reviewer → `savyagupta-2004`
