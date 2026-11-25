import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "./db";
import { readSessionToken, SESSION_COOKIE } from "./session";

export type AuthRole = "student" | "teacher";

export interface AuthUser {
  userId: number;
  firebaseUid: string;
  name: string;
  email: string;
  role: AuthRole;
}

interface UserRow extends RowDataPacket {
  user_id: number;
  firebase_uid: string;
  name: string;
  email: string;
  role: AuthRole;
}

function teacherEmails() {
  return new Set(
    (process.env.TEACHER_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function resolveRole(email: string | undefined): AuthRole {
  if (!email) return "student";
  return teacherEmails().has(email.toLowerCase()) ? "teacher" : "student";
}

function mapUser(row: UserRow): AuthUser {
  return {
    userId: row.user_id,
    firebaseUid: row.firebase_uid,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export async function upsertUserFromClaims(claims: {
  uid: string;
  email?: string;
  name?: string;
}): Promise<AuthUser> {
  const email = claims.email ?? `${claims.uid}@users.noreply`;
  const name = claims.name ?? email.split("@")[0] ?? "Student";
  const role = resolveRole(claims.email);
  const fallback: AuthUser = {
    userId: 0,
    firebaseUid: claims.uid,
    name,
    email,
    role,
  };

  try {
    const connection = await pool.getConnection();

    try {
      await connection.query(
        `INSERT INTO users (firebase_uid, name, email, role, last_login_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           firebase_uid = VALUES(firebase_uid),
           name = VALUES(name),
           email = VALUES(email),
           last_login_at = NOW(),
           role = IF(VALUES(role) = 'teacher', 'teacher', role)`,
        [claims.uid, name, email, role]
      );

      const [rows] = await connection.query<UserRow[]>(
        "SELECT user_id, firebase_uid, name, email, role FROM users WHERE firebase_uid = ?",
        [claims.uid]
      );

      if (!rows[0]) {
        return fallback;
      }

      return mapUser(rows[0]);
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("MySQL user sync unavailable:", error);
    return fallback;
  }
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) {
    return null;
  }

  const claims = await readSessionToken(session);
  if (!claims) {
    return null;
  }

  return upsertUserFromClaims(claims);
}

/**
 * For API routes: returns the signed-in user, or a ready-to-return error
 * response (401 not signed in, 403 wrong role, 503 database unavailable).
 */
export async function requireUser(
  options: { role?: AuthRole } = {}
): Promise<{ user: AuthUser; error?: never } | { user?: never; error: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  }
  if (options.role && user.role !== options.role) {
    return { error: NextResponse.json({ error: "Not allowed" }, { status: 403 }) };
  }
  // upsertUserFromClaims returns userId 0 when MySQL could not be reached.
  if (user.userId === 0) {
    return { error: NextResponse.json({ error: "Database unavailable" }, { status: 503 }) };
  }
  return { user };
}

export function toClientAccount(user: AuthUser) {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return {
    id: user.firebaseUid,
    dbUserId: user.userId,
    name: user.name,
    role: user.role,
    title: user.role === "teacher" ? "Sponsor Account" : "Student Account",
    initials: initials || "U",
    email: user.email,
    sponsorEmail: user.role === "teacher" ? user.email : undefined,
    isAuthenticated: true,
  };
}
