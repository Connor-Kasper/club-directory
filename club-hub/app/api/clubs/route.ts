import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ResultSetHeader } from 'mysql2/promise';
import { requireUser } from '@/lib/auth';
import { DbClub, readClubInput, rowToClub } from '@/lib/clubs';

export type { DbClub };

// GET all clubs
export async function GET() {
  try {
    const [rows] = await pool.query<DbClub[]>('SELECT * FROM clubs ORDER BY club_id ASC');
    return NextResponse.json(rows.map(rowToClub), { status: 200 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to fetch clubs' }, { status: 500 });
  }
}

// POST a new club (teachers only). name, description and category are required.
export async function POST(request: NextRequest) {
  const auth = await requireUser({ role: 'teacher' });
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
  }

  const input = readClubInput(body, { requireAll: true });
  if ('error' in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const placeholders = input.columns.map(() => '?').join(', ');
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO clubs (${input.columns.join(', ')}) VALUES (${placeholders})`,
      input.values
    );
    const [rows] = await pool.query<DbClub[]>('SELECT * FROM clubs WHERE club_id = ?', [result.insertId]);
    return NextResponse.json(rowToClub(rows[0]), { status: 201 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to create club' }, { status: 500 });
  }
}
