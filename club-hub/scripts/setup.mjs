// One-time local setup: `npm run setup`
// 1. Creates .env.local from .env.local.example (with a fresh SESSION_SECRET) if it doesn't exist.
// 2. Creates the MySQL database + tables and adds any clubs from app/data/*.json
//    that aren't in the database yet (this is how you add a new club).
// Safe to run again: it never overwrites .env.local, tables, or existing clubs.
import { createConnection } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const envPath = join(root, ".env.local");
if (!existsSync(envPath)) {
  const example = readFileSync(join(root, ".env.local.example"), "utf8");
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(envPath, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
  console.log("Created .env.local with a new SESSION_SECRET.");
} else {
  console.log(".env.local already exists, leaving it alone.");
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(root, ".env.local"));
loadEnvFile(join(root, ".env"));

const host = process.env.DB_HOST || "localhost";
const user = process.env.DB_USER || "root";
const password = process.env.DB_PASSWORD || "";
const database = process.env.DB_NAME || "club_directory";

const schemaSql = readFileSync(join(root, "sql", "schema.sql"), "utf8");

function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

// Older databases were created before the images/events columns existed.
async function addMissingColumns(connection) {
  const wanted = { images: "JSON NULL", events: "JSON NULL" };
  const [rows] = await connection.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'clubs'",
    [database]
  );
  const existing = new Set(rows.map((row) => row.name));
  for (const [column, type] of Object.entries(wanted)) {
    if (!existing.has(column)) {
      await connection.query(`ALTER TABLE clubs ADD COLUMN ${column} ${type}`);
      console.log(`Added clubs.${column} column.`);
    }
  }
}

// Each app/data/*.json file is one club. Checks a file and returns a list of problems.
function checkClubFile(club) {
  const problems = [];
  if (!Number.isInteger(club.id) || club.id <= 0) problems.push('"id" must be a whole number above 0');
  for (const field of ["name", "category", "description"]) {
    if (typeof club[field] !== "string" || !club[field].trim()) problems.push(`"${field}" is required`);
  }
  if (club.images !== undefined && !(Array.isArray(club.images) && club.images.every((u) => typeof u === "string"))) {
    problems.push('"images" must be a list of image URLs');
  }
  if (
    club.events !== undefined &&
    !(Array.isArray(club.events) && club.events.every((e) => typeof e?.name === "string" && typeof e?.date === "string"))
  ) {
    problems.push('"events" must look like [{ "name": "Kickoff", "date": "Sept 10" }]');
  }
  return problems;
}

function clubColumns(club) {
  return [
    club.name,
    club.description,
    club.category,
    club.time ?? "",
    club.day ?? "",
    club.location ?? "",
    club.sponsor?.email ?? "",
    club.sponsor?.name ?? "",
    club.dues ?? "",
    club.socials?.instagram ?? "",
    club.socials?.twitter ?? "",
    club.socials?.facebook ?? "",
    club.socials?.remind ?? "",
    JSON.stringify(club.images ?? []),
    JSON.stringify(club.events ?? []),
  ];
}

// Adds clubs from app/data/*.json that aren't in the database yet.
// Never overwrites a club that's already there (teachers may have edited it),
// except to fill in photos/events on clubs created before those columns existed.
async function syncClubs(connection) {
  const dataDir = join(root, "app", "data");
  const files = readdirSync(dataDir).filter((name) => name.endsWith(".json")).sort();

  const clubs = [];
  const errors = [];
  const seenIds = new Map();
  for (const file of files) {
    let club;
    try {
      club = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
    } catch (error) {
      errors.push(`${file}: not valid JSON (${error.message})`);
      continue;
    }
    const problems = checkClubFile(club);
    if (seenIds.has(club.id)) problems.push(`"id" ${club.id} is also used by ${seenIds.get(club.id)}`);
    if (problems.length) {
      errors.push(...problems.map((problem) => `${file}: ${problem}`));
      continue;
    }
    seenIds.set(club.id, file);
    clubs.push({ file, club });
  }

  const [rows] = await connection.query("SELECT club_id, name, images FROM clubs");
  const inDb = new Map(rows.map((row) => [row.club_id, row]));
  const nextFreeId = Math.max(0, ...rows.map((row) => row.club_id), ...seenIds.keys()) + 1;

  const added = [];
  for (const { file, club } of clubs) {
    const existing = inDb.get(club.id);
    if (!existing) {
      await connection.query(
        `INSERT INTO clubs (
          club_id, name, description, category, meeting_time, meeting_day, location, contact_email,
          sponsor_name, dues, instagram_url, twitter_url, facebook_url, remind_url, images, events
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [club.id, ...clubColumns(club)]
      );
      added.push(club.name);
    } else if (existing.name !== club.name) {
      // Could be a club a teacher renamed on the site, or a new file reusing an id. Warn only.
      console.warn(
        `Note: ${file} ("${club.name}") was not added because id ${club.id} is already "${existing.name}" in the database.` +
          ` If ${file} is a new club, change its "id" to ${nextFreeId}.`
      );
    } else if (existing.images === null) {
      await connection.query("UPDATE clubs SET images = ?, events = ? WHERE club_id = ?", [
        JSON.stringify(club.images ?? []),
        JSON.stringify(club.events ?? []),
        club.id,
      ]);
    }
  }

  if (added.length) {
    console.log(`Added ${added.length} club(s): ${added.join(", ")}.`);
  } else {
    console.log("Clubs are up to date (no new club files).");
  }
  return errors;
}

let connection;
try {
  connection = await createConnection({ host, user, password });
} catch (error) {
  console.error(`
Could not connect to MySQL at ${user}@${host}:3306 (${error.code ?? error.message}).`);
  console.error("Start it first with `docker compose up -d` (or your own MySQL/MariaDB),");
  console.error("and make sure DB_HOST / DB_USER / DB_PASSWORD in .env.local match it.");
  process.exit(1);
}

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${database}\``);

  for (const statement of splitStatements(schemaSql)) {
    await connection.query(statement);
  }

  await addMissingColumns(connection);
  const errors = await syncClubs(connection);
  if (errors.length) {
    console.error("\nSome club files were skipped. Fix these and run `npm run setup` again:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Database '${database}' is ready.`);
  }
} finally {
  await connection.end();
}
