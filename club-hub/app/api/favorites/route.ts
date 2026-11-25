import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { requireUser } from "@/lib/auth";

export interface StudentFavorite extends RowDataPacket {
  student_id: number;
  club_id: number;
  favorited_at: Date;
}

// The student is always the signed-in user from the session cookie. A
// student_id sent by the client is ignored, so nobody can read or change
// another student's favorites.

async function readClubId(request: NextRequest): Promise<number | null> {
  try {
    const body = (await request.json()) as { club_id?: unknown };
    const clubId = Number(body.club_id);
    return Number.isInteger(clubId) && clubId > 0 ? clubId : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const [rows] = await pool.query<StudentFavorite[]>(
      "SELECT * FROM student_favorites WHERE student_id = ? ORDER BY favorited_at DESC",
      [auth.user.userId]
    );
    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch favorites" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const clubId = await readClubId(request);
  if (!clubId) {
    return NextResponse.json({ error: "club_id is required" }, { status: 400 });
  }

  try {
    await pool.query(
      "INSERT INTO student_favorites (student_id, club_id, favorited_at) VALUES (?, ?, NOW())",
      [auth.user.userId, clubId]
    );
    return NextResponse.json(
      { student_id: auth.user.userId, club_id: clubId, success: true },
      { status: 201 }
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "Club is already favorited" }, { status: 409 });
    }
    if (code === "ER_NO_REFERENCED_ROW_2") {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to add favorite" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const clubId = await readClubId(request);
  if (!clubId) {
    return NextResponse.json({ error: "club_id is required" }, { status: 400 });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM student_favorites WHERE student_id = ? AND club_id = ?",
      [auth.user.userId, clubId]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Favorite not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to remove favorite" }, { status: 500 });
  }
}
