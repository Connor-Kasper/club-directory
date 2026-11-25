import { NextRequest, NextResponse } from "next/server";
import { toClientAccount, upsertUserFromClaims } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { verifyFirebaseIdToken } from "@/lib/verify-firebase-token";

function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// Sign in: the browser sends the Firebase ID token it got from Google sign-in.
// We verify it once against Google's public keys, then replace it with our own
// signed 5-day session cookie so the user stays signed in after the ID token
// expires (1 hour).
export async function POST(request: NextRequest) {
  let claims;
  try {
    const { idToken } = (await request.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ error: "idToken is required" }, { status: 400 });
    }
    claims = await verifyFirebaseIdToken(idToken);
  } catch (error) {
    console.error("Rejected Firebase ID token:", error);
    return NextResponse.json({ error: "Invalid sign-in token" }, { status: 401 });
  }

  let sessionToken: string;
  try {
    sessionToken = await createSessionToken(claims);
  } catch (error) {
    console.error("Failed to create auth session:", error);
    return NextResponse.json({ error: "Server session is not configured" }, { status: 500 });
  }

  const user = await upsertUserFromClaims(claims);
  const response = NextResponse.json({ user: toClientAccount(user) }, { status: 200 });
  response.cookies.set({
    ...sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
    value: sessionToken,
  });
  return response;
}

// Sign out: clear the session cookie.
export async function DELETE() {
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.set({
    ...sessionCookieOptions(0),
    value: "",
  });
  return response;
}
