# 09 - Git and GitHub guide

A practical guide for a student project. Everything below uses the command line; the GitHub website or GitHub Desktop do the same things.

## 1. One-time setup

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

## 2. Put the project under Git

```bash
cd flip7-online
git init
git status            # check the list BEFORE adding anything
```

**Check that no secret is about to be committed.** `git status` must *not* list `backend/.env` or `node_modules/`. The provided `.gitignore` already excludes `.env`, `.env.*` (but keeps `.env.example`), `node_modules/`, `dist/`, logs and editor folders.

```bash
git add .
git commit -m "Flip 7 Online: phases 1-8"
```

## 3. Create the GitHub repository

1. On github.com choose **New repository**. Name it `flip7-online`. Keep it **Private** until you have checked the repository for secrets (section 5). Do **not** tick "Add a README" (you already have one).
2. Connect and upload:

```bash
git remote add origin https://github.com/YOUR-NAME/flip7-online.git
git push -u origin main
```

## 4. Daily workflow

```bash
git switch -c feature/short-description     # one branch per piece of work
# ... change code, run the tests (doc 07) ...
git add -p                                  # review every change you are about to stage
git commit -m "Say WHY, in one line"
git push -u origin feature/short-description
```

Open a **Pull Request** on GitHub, read the "Files changed" tab yourself, then **Merge**. Afterwards:

```bash
git switch main && git pull
git branch -d feature/short-description
```

Good habits: commit small and often; run `cd backend && RUN_DB_TESTS=true npm test` and `cd frontend && npm test` before pushing; never commit directly to `main` once other people work on the project.

## 5. Secrets: the one rule that matters

`backend/.env` holds the database password, the session secret and the Google client secret. **It must never reach GitHub.**

- Before every first push run `git ls-files | grep -i "\.env"`. The only result should be `backend/.env.example` (it contains no real values).
- If a secret was ever committed, deleting the file in a later commit is **not enough**: it stays in the history and bots scrape GitHub within minutes. **Rotate it**: create a new Google client secret in the Google Cloud console, choose a new `SESSION_SECRET`, change the database password. Then remove it from history (for example with `git filter-repo`), or simply delete the repository and start a fresh one.
- Share configuration with teammates through `backend/.env.example` and a password manager, never through the repository, chat or screenshots.
- GitHub also offers *Secret scanning* and *Push protection* in the repository's Security settings; turn them on.

## 6. Useful extras

| Task | How |
| --- | --- |
| See what changed | `git diff` (unstaged), `git diff --staged` (staged) |
| Undo an unstaged change to a file | `git restore path/to/file` |
| Undo the last commit but keep the work | `git reset --soft HEAD~1` |
| History | `git log --oneline --graph` |
| Tag a finished phase | `git tag phase-7 && git push --tags` |
| Run the tests on every push | A GitHub Actions workflow (below) |

### Optional: run the tests automatically (GitHub Actions)

Create `.github/workflows/test.yml`:

```yaml
name: tests
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env: { MYSQL_ALLOW_EMPTY_PASSWORD: "yes" }
        ports: ["3306:3306"]
        options: --health-cmd="mysqladmin ping" --health-interval=5s --health-retries=20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: mysql -h127.0.0.1 -uroot < backend/src/db/schema.sql
      - run: cd backend && npm ci && npm test            # add RUN_DB_TESTS=true and the DB_* variables to run the integration tests too
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd frontend && npm ci && npm test && npm run build
```

Use only throw-away values in workflow files; real secrets go into *Settings -> Secrets and variables -> Actions*.

## 7. Licence and credits

Flip 7 is a commercial card game by Op Games. This is a learning project; do not publish or monetise it as a copy of the game, and keep a note in the README that it is an unofficial fan implementation.
