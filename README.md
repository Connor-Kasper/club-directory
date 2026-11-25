# club-directory

**ClubHub** is a Next.js student club directory: browse clubs, favorite them, view a calendar, and (optionally) manage clubs via an admin UI backed by MySQL.

## What it is

A web app (`club-hub/`) for school club discovery and involvement:

- **Dashboard** (`/dashboard`) — landing / overview
- **Clubs** (`/clubs`) — search, filter, view details, favorites
- **Calendar** (`/calendar`) — schedule view
- **Admin** (`/admin`) — club management
- **API** — `/api/clubs`, `/api/favorites`, `/api/auth` over MySQL + Firebase Google sign-in

If the DB is down, clubs fall back to local JSON data.

Stack: Next.js 16, React 19, TypeScript, Tailwind, Sass, Lucide, Firebase Auth.

## How to run it

1. **Install deps** (from `club-hub`):

```bash
cd club-hub
npm install
```

2. **MySQL** — start a local server (needs [Docker Desktop](https://www.docker.com/products/docker-desktop/)):

```bash
docker compose up -d
```

Already have MySQL/MariaDB on port 3306? Skip this. If the next step says it can't connect, set `DB_USER`/`DB_PASSWORD` in `.env.local` and run it again.

3. **Setup** — creates `.env.local` (with a fresh `SESSION_SECRET`), the tables, and sample clubs. Safe to re-run:

```bash
npm run setup
```

4. **Start the app**:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to `/dashboard`. Sign in with Google (enabled on the `clubhub-kasper` Firebase project). Teacher/admin access is granted to emails listed in `TEACHER_EMAILS` in `.env.local`.

Other scripts: `npm test` runs the API tests (uses its own test database); `npm run build` then `npm start` for production; `npm run lint` for linting.

**Adding a club:** add a file to `club-hub/app/data/` (copy an existing one, give it a new `id`) and run `npm run setup`. Details and the API option are in `club-hub/DATABASE_INTEGRATION.md`, along with the table layout.
