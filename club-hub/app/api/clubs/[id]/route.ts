import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ResultSetHeader } from 'mysql2/promise';
import { requireUser } from '@/lib/auth';
import { DbClub, readClubInput, rowToClub } from '@/lib/clubs';

// Next.js 16 passes route params as a Promise.
type RouteContext = { params: Promise<{ id: string }> };

async function readClubId(params: RouteContext['params']) {
  const { id } = await params;
  const clubId = Number(id);
  return Number.isInteger(clubId) && clubId > 0 ? clubId : null;
}

const notFound = () => NextResponse.json({ error: 'Club not found' }, { status: 404 });

// GET a specific club by ID
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const clubId = await readClubId(params);
  if (!clubId) return notFound();

  try {
    const [rows] = await pool.query<DbClub[]>('SELECT * FROM clubs WHERE club_id = ?', [clubId]);
    if (rows.length === 0) return notFound();
    return NextResponse.json(rowToClub(rows[0]), { status: 200 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to fetch club' }, { status: 500 });
  }
}

// UPDATE a club (teachers only). Only the fields you send are changed.
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser({ role: 'teacher' });
  if (auth.error) return auth.error;

  const clubId = await readClubId(params);
  if (!clubId) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
  }

  const input = readClubInput(body, { requireAll: false });
  if ('error' in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }
  if (input.columns.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const assignments = input.columns.map((column) => `${column} = ?`).join(', ');
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE clubs SET ${assignments} WHERE club_id = ?`,
      [...input.values, clubId]
    );
    if (result.affectedRows === 0) return notFound();

    const [rows] = await pool.query<DbClub[]>('SELECT * FROM clubs WHERE club_id = ?', [clubId]);
    return NextResponse.json(rowToClub(rows[0]), { status: 200 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to update club' }, { status: 500 });
  }
}

// DELETE a club (teachers only). Its favorites are removed with it.
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser({ role: 'teacher' });
  if (auth.error) return auth.error;

  const clubId = await readClubId(params);
  if (!clubId) return notFound();

  try {
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM clubs WHERE club_id = ?', [clubId]);
    if (result.affectedRows === 0) return notFound();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to delete club' }, { status: 500 });
  }
}
