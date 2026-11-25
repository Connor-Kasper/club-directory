# Database Integration Guide

## Overview
This document describes how the Club Directory application integrates with a MySQL database to manage clubs and student favorites.

## Database Schema

### Tables

Canonical schema lives in `sql/schema.sql`. Create it with `npm run setup`.

#### `users`
Stores Google/Firebase identities and app roles.
- `user_id` (INT, UN, AI, PK) - Unique identifier
- `firebase_uid` (VARCHAR(128), unique) - Firebase Auth UID
- `name` (VARCHAR(120)) - Display name
- `email` (VARCHAR(255), unique) - Account email
- `role` (ENUM student/teacher) - App role; teachers listed in `TEACHER_EMAILS`
- `created_at` / `last_login_at` (DATETIME)

#### `clubs`
Stores all club information.
- `club_id` (INT, UN, AI, PK) - Unique identifier
- `name` (VARCHAR(120)) - Club name
- `description` (VARCHAR(1000)) - Club description
- `category` (VARCHAR(45)) - Club category
- `meeting_time` (VARCHAR(45)) - Meeting time
- `meeting_day` (VARCHAR(45)) - Meeting day
- `location` (VARCHAR(120)) - Location
- `contact_email` (VARCHAR(255)) - Contact email
- `sponsor_name` (VARCHAR(120)) - Sponsor name
- `dues` (VARCHAR(45)) - Dues
- `instagram_url` (VARCHAR(255)) - Instagram URL
- `twitter_url` (VARCHAR(255)) - Twitter URL
- `facebook_url` (VARCHAR(255)) - Facebook URL
- `remind_url` (VARCHAR(255)) - Remind URL
- `images` (JSON) - List of photo URLs, e.g. `["/images/chess.jpg"]`
- `events` (JSON) - List like `[{ "name": "Kickoff", "date": "Sept 10" }]`

#### `student_favorites`
Tracks which clubs a signed-in user has favorited.
- `student_id` (INT, UN, PK) - `users.user_id`
- `club_id` (INT, UN, PK) - Club ID
- `favorited_at` (DATETIME) - Timestamp when favorited

## Adding a club

**Option 1: a club file (best for clubs that ship with the app)**

1. Copy an existing file in `app/data/`, e.g. `robotics.json`, to `app/data/chess.json`.
2. Give it an `"id"` no other club uses. If you guess wrong, `npm run setup` tells you the next free id.
3. Fill in the details. Only `id`, `name`, `category` and `description` are required.
   Put photos in `public/images/` and list them as `"/images/chess.jpg"`.
4. Run `npm run setup`. It prints `Added 1 club(s): Chess Club`.

Every teammate gets the club the next time they pull and run `npm run setup`.
Setup only adds clubs that aren't in the database yet. It never overwrites a club, so edits made on the site are kept.
If a file has a mistake (bad JSON, missing field, duplicate id) setup lists the file and the problem, skips it, and still adds the others.

**Option 2: the API (signed in as a teacher)**

`POST /api/clubs` with a JSON body using the column names above, for example
`{ "name": "Chess Club", "description": "...", "category": "Academics", "images": [], "events": [] }`.
`PUT /api/clubs/[id]` changes only the fields you send.

## API Endpoints

### Clubs
- `GET /api/clubs` - Fetch all clubs
- `GET /api/clubs/[id]` - Fetch a specific club
- `POST /api/clubs` - Create a new club (teachers only)
- `PUT /api/clubs/[id]` - Update a club (teachers only)
- `DELETE /api/clubs/[id]` - Delete a club (teachers only)

### Student Favorites
Sign-in required. The student is always the signed-in user; any `student_id` sent by the client is ignored.
- `GET /api/favorites` - Get favorites for the signed-in user
- `POST /api/favorites` - Add a club to favorites (`{ club_id }`)
- `DELETE /api/favorites` - Remove a club from favorites (`{ club_id }`)

### Auth
- `POST /api/auth/session` - Verify the Google/Firebase ID token once, upsert `users`, and set a 5-day `__session` cookie signed with `SESSION_SECRET`
- `GET /api/auth/me` - Return the current session user
- `DELETE /api/auth/session` - Clear the session cookie

## Setup Instructions

### 1. Environment Configuration
Start MySQL (`docker compose up -d`), then from `club-hub` run:

```bash
npm run setup
```

This creates `.env.local` from `.env.local.example` (with a random `SESSION_SECRET`) if you don't have one yet, creates the tables, and seeds clubs. It is safe to run again.

### Tests
`npm test` runs the API tests against a separate `club_directory_test` database on port 3999 (MySQL must be running; stop `npm run dev` first).

### 2. Database Connection
The application uses the `mysql2/promise` package with connection pooling.

**File:** `club-hub/lib/db.ts`
```typescript
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'club_directory',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
```

### 3. Using Database Data in Components

The clubs page now fetches data from the database:

```typescript
// club-hub/app/clubs/page.tsx
import { getClubsFromDatabase } from '../data/db-clubs';

const loadClubs = async () => {
  try {
    const dbClubs = await getClubsFromDatabase();
    setClubsData(dbClubs);
  } catch (err) {
    // Falls back to JSON data if database is unavailable
    setClubsData(getClubs());
  }
};
```

## Features

### Database Integration
- ✅ Fetch clubs from MySQL database
- ✅ Create new clubs
- ✅ Update club information
- ✅ Delete clubs
- ✅ Manage student favorites
- ✅ Track favorited timestamps

### Fallback Support
If the database connection fails, the application automatically falls back to loading clubs from JSON files, ensuring the application remains functional.

### Error Handling
- Database connection errors are logged and handled gracefully
- HTTP error responses with appropriate status codes
- User-friendly error messages in the UI

## Files Structure

```
club-hub/
├── sql/schema.sql                     # users, clubs, student_favorites
├── scripts/setup.mjs                  # npm run setup
├── tests/api.test.mjs                 # npm test
├── lib/
│   ├── db.ts                          # MySQL connection pool
│   ├── firebase.ts                    # Google sign-in client (browser)
│   ├── verify-firebase-token.ts       # Checks Google ID tokens
│   ├── session.ts                     # Signed 5-day session cookie
│   ├── clubs.ts                       # Club fields + input checks for /api/clubs
│   └── auth.ts                        # Session user, MySQL upsert, requireUser()
├── app/
│   ├── api/
│   │   ├── auth/                      # session + me
│   │   ├── clubs/
│   │   └── favorites/
│   └── clubs/page.tsx
├── .env.local.example
└── DATABASE_INTEGRATION.md
```

## Notes

- The database connection uses a connection pool for better performance
- All queries are parameterized to prevent SQL injection
- The application transforms database records to match the internal `Club` interface
- Future enhancements can include club events and images in the database