import "server-only";
import type { RowDataPacket } from "mysql2/promise";

// Shared club helpers for /api/clubs routes: one list of editable columns,
// input checking, and turning the JSON columns back into arrays.

export interface ClubEvent {
  name: string;
  date: string;
}

export interface DbClub extends RowDataPacket {
  club_id: number;
  name: string;
  description: string;
  category: string;
  meeting_time: string | null;
  meeting_day: string | null;
  location: string | null;
  contact_email: string | null;
  sponsor_name: string | null;
  dues: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  facebook_url: string | null;
  remind_url: string | null;
  images: string[] | string | null;
  events: ClubEvent[] | string | null;
}

const TEXT_FIELDS = [
  "name",
  "description",
  "category",
  "meeting_time",
  "meeting_day",
  "location",
  "contact_email",
  "sponsor_name",
  "dues",
  "instagram_url",
  "twitter_url",
  "facebook_url",
  "remind_url",
] as const;

const REQUIRED_FIELDS = ["name", "description", "category"] as const;

// MariaDB returns JSON columns as text; MySQL returns them parsed.
function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function rowToClub(row: DbClub) {
  return {
    ...row,
    images: parseJsonArray<string>(row.images),
    events: parseJsonArray<ClubEvent>(row.events),
  };
}

/**
 * Picks the club columns present in a request body and checks them.
 * Returns the columns/values to write, or an error message for a 400.
 */
export function readClubInput(
  body: unknown,
  { requireAll }: { requireAll: boolean }
): { columns: string[]; values: unknown[] } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a JSON object" };
  }
  const input = body as Record<string, unknown>;
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value !== null && typeof value !== "string") {
      return { error: `${field} must be text` };
    }
    columns.push(field);
    values.push(value);
  }

  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    const missing = typeof value !== "string" || value.trim() === "";
    if (missing && (requireAll || field in input)) {
      return { error: `${field} is required` };
    }
  }

  if ("images" in input) {
    const images = input.images;
    if (!Array.isArray(images) || !images.every((url) => typeof url === "string")) {
      return { error: "images must be a list of image URLs" };
    }
    columns.push("images");
    values.push(JSON.stringify(images));
  }

  if ("events" in input) {
    const events = input.events;
    const valid =
      Array.isArray(events) &&
      events.every(
        (event) =>
          event &&
          typeof event === "object" &&
          typeof (event as ClubEvent).name === "string" &&
          typeof (event as ClubEvent).date === "string"
      );
    if (!valid) {
      return { error: 'events must be a list like [{ "name": "Kickoff", "date": "Sept 10" }]' };
    }
    columns.push("events");
    values.push(JSON.stringify(events));
  }

  return { columns, values };
}
