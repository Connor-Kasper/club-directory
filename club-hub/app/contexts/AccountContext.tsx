"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import {
  getFirebaseAuth,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "@/lib/firebase";

export type AccountRole = "student" | "teacher";
export type DemoAccountRole = AccountRole;

export interface Account {
  id: string;
  name: string;
  role: AccountRole;
  title: string;
  initials: string;
  sponsorEmail?: string;
  email?: string;
  dbUserId?: number;
  isAuthenticated: boolean;
}

export type DemoAccount = Account;

export const GUEST_ACCOUNT: Account = {
  id: "guest",
  name: "Guest",
  role: "student",
  title: "Not signed in",
  initials: "G",
  isAuthenticated: false,
};

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "student-demo",
    name: "Student Demo",
    role: "student",
    title: "Guest Profile",
    initials: "SD",
    isAuthenticated: false,
  },
  {
    id: "teacher-demo",
    name: "Derek Miller",
    role: "teacher",
    title: "Sponsor Account",
    initials: "DM",
    sponsorEmail: "djmiller@naperville203.org",
    email: "djmiller@naperville203.org",
    isAuthenticated: false,
  },
];

interface AccountContextValue {
  accounts: Account[];
  currentAccount: Account;
  setCurrentAccountById: (id: string) => void;
  firebaseEnabled: boolean;
  authReady: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function initialsFromName(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const firebaseEnabled = isFirebaseClientConfigured();
  const [currentAccountId, setCurrentAccountId] = useState<string>(DEMO_ACCOUNTS[0].id);
  const [signedInAccount, setSignedInAccount] = useState<Account | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseEnabled) {
      return;
    }

    let cancelled = false;

    const applySessionUser = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { user: Account | null };
        if (!cancelled && data.user) {
          setSignedInAccount({ ...data.user, isAuthenticated: true });
        }
      } catch {
        // Session restore is best-effort until Firebase finishes loading.
      }
    };

    const syncSession = async () => {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        await fetch("/api/auth/session", { method: "DELETE" });
        if (!cancelled) {
          setSignedInAccount(null);
        }
        return;
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const fallback: Account = {
          id: currentUser.uid,
          name: currentUser.displayName ?? currentUser.email ?? "Signed-in user",
          role: "student",
          title: "Student Account",
          initials: initialsFromName(currentUser.displayName ?? "User"),
          email: currentUser.email ?? undefined,
          isAuthenticated: true,
        };
        if (!cancelled) {
          setSignedInAccount(fallback);
          setAuthError("Signed in with Google, but the MySQL user sync is not configured yet.");
        }
        return;
      }

      const data = (await response.json()) as { user: Account };
      if (!cancelled) {
        setSignedInAccount({ ...data.user, isAuthenticated: true });
        setAuthError(null);
      }
    };

    void applySessionUser();

    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      try {
        if (user) {
          await syncSession();
        } else {
          await fetch("/api/auth/session", { method: "DELETE" });
          if (!cancelled) {
            setSignedInAccount(null);
          }
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setAuthError("Could not finish Google sign-in.");
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [firebaseEnabled]);

  const value = useMemo(() => {
    const demoAccount =
      DEMO_ACCOUNTS.find((account) => account.id === currentAccountId) ?? DEMO_ACCOUNTS[0];
    const currentAccount = firebaseEnabled ? signedInAccount ?? GUEST_ACCOUNT : demoAccount;

    return {
      accounts: firebaseEnabled ? (signedInAccount ? [signedInAccount] : [GUEST_ACCOUNT]) : DEMO_ACCOUNTS,
      currentAccount,
      setCurrentAccountById: setCurrentAccountId,
      firebaseEnabled,
      authReady,
      authError,
      signInWithGoogle: async () => {
        if (!firebaseEnabled) {
          throw new Error("Firebase is not configured.");
        }
        setAuthError(null);
        await signInWithPopup(getFirebaseAuth(), getGoogleProvider());
      },
      signOut: async () => {
        if (firebaseEnabled) {
          await firebaseSignOut(getFirebaseAuth());
        }
        await fetch("/api/auth/session", { method: "DELETE" });
        setSignedInAccount(null);
      },
    };
  }, [authError, authReady, currentAccountId, firebaseEnabled, signedInAccount]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);

  if (!context) {
    throw new Error("useAccount must be used within an AccountProvider");
  }

  return context;
}
