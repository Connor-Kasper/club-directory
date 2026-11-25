// API tests for the database + Google sign-in backend.
// Run with `npm test` (MySQL must be running, e.g. `docker compose up -d`).
// Uses its own database (club_directory_test) and its own server on port 3999,
// so your dev data is never touched.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";
import { SignJWT } from "jose";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const SECRET = "test-secret-test-secret-test-secret-123";
const TEACHER_EMAIL = "teacher@test.local";

const env = {
  ...process.env,
  DB_NAME: "club_directory_test",
  SESSION_SECRET: SECRET,
  TEACHER_EMAILS: TEACHER_EMAIL,
  NEXT_TELEMETRY_DISABLED: "1",
};

let server;
let db;

function session(uid, { email = `${uid}@test.local`, name = "Test User", secret = SECRET, ...opts } = {}) {
  return new SignJWT({ email, name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(uid)
    .setIssuer(opts.issuer ?? "club-hub")
    .setAudience(opts.audience ?? "club-hub-session")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(new TextEncoder().encode(secret));
}

async function api(path, { cookie, method = "GET", body, rawBody } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = `__session=${cookie}`;
  if (body !== undefined || rawBody !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  // Fresh test database every run.
  const conn = await createConnection({
    host: env.DB_HOST || "localhost",
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD ?? "clubhub",
  }).catch((error) => {
    throw new Error(`MySQL is not reachable (${error.code}). Start it with \`docker compose up -d\`.`);
  });
  await conn.query("DROP DATABASE IF EXISTS club_directory_test");
  await conn.end();
  execFileSync(process.execPath, ["scripts/setup.mjs"], { cwd: root, env, stdio: "ignore" });

  db = await createConnection({
    host: env.DB_HOST || "localhost",
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD ?? "clubhub",
    database: "club_directory_test",
  });

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(PORT)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => (serverOutput += chunk));
  server.stderr.on("data", (chunk) => (serverOutput += chunk));
  let exited = false;
  server.on("exit", () => (exited = true));

  let ready = false;
  for (let i = 0; i < 120 && !ready && !exited; i++) {
    try {
      await fetch(`${BASE}/api/auth/me`);
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ready) {
    throw new Error(
      "The test server did not start. If `npm run dev` is running, stop it first " +
        "(Next.js allows one dev server per folder).\n\n" + serverOutput.slice(-1500)
    );
  }

  // `next dev` compiles each route on first request; do that up front so
  // slow first compiles don't look like test failures.
  for (const path of ["/api/auth/session", "/api/favorites", "/api/clubs", "/api/clubs/1"]) {
    await fetch(BASE + path, { method: "OPTIONS" }).catch(() => {});
  }
});

after(async () => {
  await db?.end();
  if (server?.pid) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
      } catch {}
    } else {
      server.kill("SIGTERM");
    }
  }
});

describe("setup", () => {
  test("creates the three tables and seeds clubs", async () => {
    const [tables] = await db.query("SHOW TABLES");
    const names = tables.map((row) => Object.values(row)[0]).sort();
    assert.deepEqual(names, ["clubs", "student_favorites", "users"]);
    const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM clubs");
    assert.ok(count > 0, "clubs were seeded");
  });

  test("running setup again is safe and changes nothing", async () => {
    const [[before]] = await db.query("SELECT COUNT(*) AS count FROM clubs");
    const out = execFileSync(process.execPath, ["scripts/setup.mjs"], { cwd: root, env }).toString();
    assert.match(out, /up to date/);
    const [[afterRun]] = await db.query("SELECT COUNT(*) AS count FROM clubs");
    assert.equal(afterRun.count, before.count);
  });

  test("gives a clear message when MySQL is not running", () => {
    let message = "";
    try {
      execFileSync(process.execPath, ["scripts/setup.mjs"], {
        cwd: root,
        env: { ...env, DB_HOST: "127.0.0.1", DB_USER: "nobody", DB_PASSWORD: "wrong" },
        stdio: "pipe",
      });
    } catch (error) {
      message = error.stderr.toString();
    }
    assert.match(message, /Could not connect to MySQL/);
    assert.match(message, /docker compose up -d/);
  });
});

describe("sign-in session", () => {
  test("signed-out visitor gets user: null (not an error)", async () => {
    const res = await api("/api/auth/me");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { user: null });
  });

  test("missing idToken is a 400", async () => {
    const res = await api("/api/auth/session", { method: "POST", body: {} });
    assert.equal(res.status, 400);
  });

  test("fake Google token is rejected", async () => {
    const res = await api("/api/auth/session", { method: "POST", body: { idToken: "not-a-real-token" } });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null, "no cookie is set");
  });

  test("Firebase-looking token signed by someone else is rejected", async () => {
    const forged = await new SignJWT({ email: "x@test.local" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("attacker")
      .setIssuer("https://securetoken.google.com/clubhub-kasper")
      .setAudience("clubhub-kasper")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("whatever-whatever-whatever-whatever"));
    const res = await api("/api/auth/session", { method: "POST", body: { idToken: forged } });
    assert.equal(res.status, 401);
  });

  test("malformed JSON body is rejected cleanly", async () => {
    const res = await api("/api/auth/session", { method: "POST", rawBody: "{oops" });
    assert.equal(res.status, 401);
  });

  test("valid session cookie signs the user in and creates their DB row", async () => {
    const res = await api("/api/auth/me", { cookie: await session("uid-alice", { name: "Alice Smith" }) });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.name, "Alice Smith");
    assert.equal(res.json.user.role, "student");
    assert.equal(res.json.user.initials, "AS");
    assert.ok(res.json.user.dbUserId > 0);
    const [rows] = await db.query("SELECT * FROM users WHERE firebase_uid = 'uid-alice'");
    assert.equal(rows.length, 1);
  });

  test("signing in again reuses the same user row", async () => {
    const a = await api("/api/auth/me", { cookie: await session("uid-alice") });
    const b = await api("/api/auth/me", { cookie: await session("uid-alice") });
    assert.equal(a.json.user.dbUserId, b.json.user.dbUserId);
    const [rows] = await db.query("SELECT * FROM users WHERE firebase_uid = 'uid-alice'");
    assert.equal(rows.length, 1);
  });

  test("name changes on the Google account are picked up", async () => {
    await api("/api/auth/me", { cookie: await session("uid-alice", { name: "Alice Jones" }) });
    const [[row]] = await db.query("SELECT name FROM users WHERE firebase_uid = 'uid-alice'");
    assert.equal(row.name, "Alice Jones");
  });

  test("same email with a new Firebase uid keeps the same account", async () => {
    const first = await api("/api/auth/me", { cookie: await session("uid-old", { email: "moved@test.local" }) });
    const second = await api("/api/auth/me", { cookie: await session("uid-new", { email: "moved@test.local" }) });
    assert.equal(second.status, 200);
    assert.equal(second.json.user.dbUserId, first.json.user.dbUserId);
  });

  test("emails in TEACHER_EMAILS get the teacher role (case-insensitive)", async () => {
    const res = await api("/api/auth/me", {
      cookie: await session("uid-teacher", { email: TEACHER_EMAIL.toUpperCase() }),
    });
    assert.equal(res.json.user.role, "teacher");
    assert.equal(res.json.user.title, "Sponsor Account");
  });

  for (const [label, makeCookie] of [
    ["wrong secret", () => session("uid-x", { secret: "a-different-secret-a-different-secret" })],
    ["expired", () => session("uid-x", { exp: Math.floor(Date.now() / 1000) - 60 })],
    ["wrong issuer", () => session("uid-x", { issuer: "someone-else" })],
    ["wrong audience", () => session("uid-x", { audience: "other-app" })],
    ["garbage", async () => "abc.def.ghi"],
  ]) {
    test(`session cookie rejected: ${label}`, async () => {
      const res = await api("/api/auth/me", { cookie: await makeCookie() });
      assert.deepEqual(res.json, { user: null });
    });
  }

  test("sign out clears the cookie", async () => {
    const res = await api("/api/auth/session", { method: "DELETE" });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie");
    assert.match(cookie, /__session=;/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/i);
  });
});

describe("favorites", () => {
  let alice;
  let bob;
  let clubId;
  let otherClubId;

  before(async () => {
    alice = await session("uid-fav-alice");
    bob = await session("uid-fav-bob");
    const [clubs] = await db.query("SELECT club_id FROM clubs ORDER BY club_id LIMIT 2");
    clubId = clubs[0].club_id;
    otherClubId = clubs[1].club_id;
  });

  test("signed-out requests are refused", async () => {
    assert.equal((await api("/api/favorites")).status, 401);
    assert.equal((await api("/api/favorites", { method: "POST", body: { club_id: clubId } })).status, 401);
    assert.equal((await api("/api/favorites", { method: "DELETE", body: { club_id: clubId } })).status, 401);
  });

  test("old student_id trick no longer works", async () => {
    assert.equal((await api("/api/favorites?student_id=1")).status, 401);
    const res = await api("/api/favorites", { method: "POST", body: { student_id: 1, club_id: clubId } });
    assert.equal(res.status, 401);
  });

  test("new user starts with no favorites", async () => {
    const res = await api("/api/favorites", { cookie: alice });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
  });

  test("add a favorite, then see it in the list", async () => {
    const add = await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: clubId } });
    assert.equal(add.status, 201);
    const list = await api("/api/favorites", { cookie: alice });
    assert.deepEqual(list.json.map((f) => f.club_id), [clubId]);
  });

  test("club_id sent as a string still works", async () => {
    const add = await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: String(otherClubId) } });
    assert.equal(add.status, 201);
  });

  test("favoriting twice says it's already a favorite", async () => {
    const res = await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: clubId } });
    assert.equal(res.status, 409);
  });

  test("a student_id in the body is ignored (saves to the signed-in user)", async () => {
    const res = await api("/api/favorites", {
      cookie: bob,
      method: "POST",
      body: { student_id: 999999, club_id: clubId },
    });
    assert.equal(res.status, 201);
    assert.notEqual(res.json.student_id, 999999);
  });

  test("students only see their own favorites", async () => {
    const res = await api("/api/favorites", { cookie: bob });
    assert.deepEqual(res.json.map((f) => f.club_id), [clubId]);
  });

  test("one student removing a favorite doesn't affect another", async () => {
    const del = await api("/api/favorites", { cookie: bob, method: "DELETE", body: { club_id: clubId } });
    assert.equal(del.status, 200);
    const aliceList = await api("/api/favorites", { cookie: alice });
    assert.ok(aliceList.json.some((f) => f.club_id === clubId), "Alice still has it");
  });

  test("removing a favorite that isn't there is a 404", async () => {
    const res = await api("/api/favorites", { cookie: bob, method: "DELETE", body: { club_id: clubId } });
    assert.equal(res.status, 404);
  });

  test("favoriting a club that doesn't exist is a 404", async () => {
    const res = await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: 987654 } });
    assert.equal(res.status, 404);
  });

  for (const bad of [0, -1, 1.5, "abc", null, undefined]) {
    test(`bad club_id (${JSON.stringify(bad)}) is a 400`, async () => {
      const res = await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: bad } });
      assert.equal(res.status, 400);
    });
  }

  test("non-JSON body is a 400, not a crash", async () => {
    const res = await api("/api/favorites", { cookie: alice, method: "POST", rawBody: "nope" });
    assert.equal(res.status, 400);
  });

  test("favorites are removed when the club is deleted", async () => {
    const teacher = await session("uid-fav-teacher", { email: TEACHER_EMAIL });
    const created = await api("/api/clubs", {
      cookie: teacher,
      method: "POST",
      body: { name: "Temp Club", description: "d", category: "Other" },
    });
    const tempId = created.json.club_id;
    await api("/api/favorites", { cookie: alice, method: "POST", body: { club_id: tempId } });
    await api(`/api/clubs/${tempId}`, { cookie: teacher, method: "DELETE" });
    const list = await api("/api/favorites", { cookie: alice });
    assert.ok(!list.json.some((f) => f.club_id === tempId));
  });

  test("many quick favorite clicks don't break anything", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api("/api/favorites", { cookie: bob, method: "POST", body: { club_id: otherClubId } })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1);
    assert.equal(statuses.filter((s) => s === 409).length, 9);
  });
});

describe("clubs", () => {
  let student;
  let teacher;
  let clubId;

  before(async () => {
    student = await session("uid-club-student");
    teacher = await session("uid-club-teacher", { email: TEACHER_EMAIL });
    const [[club]] = await db.query("SELECT club_id FROM clubs ORDER BY club_id LIMIT 1");
    clubId = club.club_id;
  });

  test("anyone can list clubs", async () => {
    const res = await api("/api/clubs");
    assert.equal(res.status, 200);
    assert.ok(res.json.length > 0);
  });

  test("anyone can view one club, including the new day/sponsor/dues fields", async () => {
    const res = await api(`/api/clubs/${clubId}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.club_id, clubId);
    for (const key of ["meeting_day", "sponsor_name", "dues"]) assert.ok(key in res.json, key);
    assert.ok(Array.isArray(res.json.images) && res.json.images.length > 0, "photos come back from the DB");
    assert.ok(Array.isArray(res.json.events), "events come back as a list");
  });

  test("unknown club is a 404", async () => {
    assert.equal((await api("/api/clubs/987654")).status, 404);
  });

  test("signed-out visitors can't create, edit or delete clubs", async () => {
    assert.equal((await api("/api/clubs", { method: "POST", body: { name: "x" } })).status, 401);
    assert.equal((await api(`/api/clubs/${clubId}`, { method: "PUT", body: { name: "x" } })).status, 401);
    assert.equal((await api(`/api/clubs/${clubId}`, { method: "DELETE" })).status, 401);
  });

  test("students can't create, edit or delete clubs", async () => {
    assert.equal((await api("/api/clubs", { cookie: student, method: "POST", body: { name: "x" } })).status, 403);
    assert.equal(
      (await api(`/api/clubs/${clubId}`, { cookie: student, method: "PUT", body: { name: "x" } })).status,
      403
    );
    assert.equal((await api(`/api/clubs/${clubId}`, { cookie: student, method: "DELETE" })).status, 403);
    const [[row]] = await db.query("SELECT club_id FROM clubs WHERE club_id = ?", [clubId]);
    assert.ok(row, "club still exists");
  });

  test("teachers can create, edit and delete a club", async () => {
    const created = await api("/api/clubs", {
      cookie: teacher,
      method: "POST",
      body: { name: "Robotics", description: "Build robots", category: "STEM", location: "Room 101" },
    });
    assert.equal(created.status, 201);
    const id = created.json.club_id;
    assert.ok(id);

    const updated = await api(`/api/clubs/${id}`, {
      cookie: teacher,
      method: "PUT",
      body: { name: "Robotics Club", description: "Build robots", category: "STEM", location: "Room 102" },
    });
    assert.equal(updated.status, 200);
    const [[row]] = await db.query("SELECT name, location FROM clubs WHERE club_id = ?", [id]);
    assert.deepEqual({ ...row }, { name: "Robotics Club", location: "Room 102" });

    assert.equal((await api(`/api/clubs/${id}`, { cookie: teacher, method: "DELETE" })).status, 200);
    assert.equal((await api(`/api/clubs/${id}`)).status, 404);
  });
});

describe("adding clubs", () => {
  const dataDir = join(root, "app", "data");
  const tempFiles = [];

  function runSetup() {
    const result = spawnSync(process.execPath, ["scripts/setup.mjs"], { cwd: root, env, encoding: "utf8" });
    return { code: result.status, out: result.stdout + result.stderr };
  }

  function writeClubFile(name, club) {
    const path = join(dataDir, name);
    tempFiles.push(path);
    writeFileSync(path, typeof club === "string" ? club : JSON.stringify(club, null, 2));
  }

  after(() => {
    for (const path of tempFiles) rmSync(path, { force: true });
  });

  test("a new club file shows up after `npm run setup`, with photos and events", async () => {
    writeClubFile("zz-test-chess.json", {
      id: 9001,
      name: "Chess Club",
      category: "Academics",
      description: "Play chess.",
      day: "Fridays",
      images: ["https://example.com/chess.jpg"],
      events: [{ name: "Tournament", date: "Nov 3" }],
    });
    const { code, out } = runSetup();
    assert.equal(code, 0, out);
    assert.match(out, /Added 1 club\(s\): Chess Club/);

    const res = await api("/api/clubs/9001");
    assert.equal(res.status, 200);
    assert.equal(res.json.meeting_day, "Fridays");
    assert.deepEqual(res.json.images, ["https://example.com/chess.jpg"]);
    assert.deepEqual(res.json.events, [{ name: "Tournament", date: "Nov 3" }]);
  });

  test("setup doesn't overwrite a club a teacher edited on the site", async () => {
    const teacher = await session("uid-add-teacher", { email: TEACHER_EMAIL });
    await api("/api/clubs/9001", { cookie: teacher, method: "PUT", body: { location: "Library" } });
    const { code, out } = runSetup();
    assert.equal(code, 0, out);
    assert.equal((await api("/api/clubs/9001")).json.location, "Library");
  });

  test("a club deleted from the database comes back on the next setup", async () => {
    await db.query("DELETE FROM clubs WHERE club_id = 9001");
    const { out } = runSetup();
    assert.match(out, /Added 1 club\(s\): Chess Club/);
    assert.equal((await api("/api/clubs/9001")).status, 200);
  });

  test("a file reusing an existing id is skipped with a hint for the next free id", async () => {
    writeClubFile("zz-test-dupe.json", { id: 1, name: "Dupe Club", category: "Other", description: "x" });
    const { code, out } = runSetup();
    rmSync(join(dataDir, "zz-test-dupe.json"));
    assert.equal(code, 1, "two files with the same id is an error");
    assert.match(out, /zz-test-dupe\.json/);
    assert.match(out, /"id" 1 is also used by/);
  });

  test("broken club files are reported clearly and don't stop the other clubs", async () => {
    writeClubFile("zz-test-broken.json", "{ not json");
    writeClubFile("zz-test-missing.json", { id: 9002, name: "No Category Club", description: "x" });
    writeClubFile("zz-test-good.json", { id: 9003, name: "Good Club", category: "Other", description: "x" });
    const { code, out } = runSetup();
    rmSync(join(dataDir, "zz-test-broken.json"));
    rmSync(join(dataDir, "zz-test-missing.json"));
    assert.equal(code, 1);
    assert.match(out, /zz-test-broken\.json: not valid JSON/);
    assert.match(out, /zz-test-missing\.json: "category" is required/);
    assert.match(out, /Added 1 club\(s\): Good Club/);
    assert.equal((await api("/api/clubs/9002")).status, 404);
  });

  test("teachers can add a club with photos and events from the API", async () => {
    const teacher = await session("uid-add-teacher", { email: TEACHER_EMAIL });
    const res = await api("/api/clubs", {
      cookie: teacher,
      method: "POST",
      body: {
        name: "Art Club",
        description: "Paint things",
        category: "Arts",
        images: ["/images/art.jpg"],
        events: [{ name: "Gallery Night", date: "Dec 1" }],
      },
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json.images, ["/images/art.jpg"]);
    assert.deepEqual(res.json.events, [{ name: "Gallery Night", date: "Dec 1" }]);
  });

  test("editing one field leaves the rest alone", async () => {
    const teacher = await session("uid-add-teacher", { email: TEACHER_EMAIL });
    const before = (await api("/api/clubs/9001")).json;
    const res = await api("/api/clubs/9001", { cookie: teacher, method: "PUT", body: { dues: "$10" } });
    assert.equal(res.status, 200);
    assert.deepEqual({ ...res.json, dues: before.dues }, before);
    assert.equal(res.json.dues, "$10");
  });

  for (const [label, method, path, body, message] of [
    ["missing name", "POST", "/api/clubs", { description: "x", category: "y" }, /name is required/],
    ["blank category", "POST", "/api/clubs", { name: "x", description: "x", category: " " }, /category is required/],
    ["images not a list", "POST", "/api/clubs", { name: "x", description: "x", category: "y", images: "a.jpg" }, /images/],
    ["bad event", "PUT", "/api/clubs/9001", { events: [{ name: "No date" }] }, /events/],
    ["number for text", "PUT", "/api/clubs/9001", { location: 5 }, /location must be text/],
    ["clearing the name", "PUT", "/api/clubs/9001", { name: "" }, /name is required/],
    ["empty update", "PUT", "/api/clubs/9001", {}, /Nothing to update/],
  ]) {
    test(`bad club input is a clear 400: ${label}`, async () => {
      const teacher = await session("uid-add-teacher", { email: TEACHER_EMAIL });
      const res = await api(path, { cookie: teacher, method, body });
      assert.equal(res.status, 400);
      assert.match(res.json.error, message);
    });
  }

  test("old databases get the photo/event columns added and filled in", async () => {
    await db.query("ALTER TABLE clubs DROP COLUMN images, DROP COLUMN events");
    const { code, out } = runSetup();
    assert.equal(code, 0, out);
    assert.match(out, /Added clubs\.images column/);
    const res = await api("/api/clubs/1");
    assert.ok(res.json.images.length > 0, "photos were filled in from the JSON file");
  });
});
