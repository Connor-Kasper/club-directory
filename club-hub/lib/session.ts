import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { FirebaseTokenClaims } from "./verify-firebase-token";

// The app issues its own session cookie after verifying the Google/Firebase
// ID token once at sign-in. Firebase ID tokens expire after one hour and the
// server cannot refresh them, so storing the raw ID token logged users out
// after an hour. This cookie is signed with SESSION_SECRET and lasts 5 days.

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

const ISSUER = "club-hub";
const AUDIENCE = "club-hub-session";

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(claims: FirebaseTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.uid)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<FirebaseTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
