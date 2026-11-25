import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type FirebaseTokenClaims = {
  uid: string;
  email?: string;
  name?: string;
};

function projectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
}

const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseTokenClaims> {
  const pid = projectId();
  if (!pid) {
    throw new Error("Firebase project ID is missing.");
  }

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://securetoken.google.com/${pid}`,
    audience: pid,
  });

  if (!payload.sub) {
    throw new Error("Firebase token is missing a subject.");
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}
