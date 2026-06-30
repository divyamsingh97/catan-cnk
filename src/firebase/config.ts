import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase web config. These values are injected at build time from Vite env
 * vars (.env.local locally, repo secrets in CI). They are NOT secret — every
 * Firebase web app ships them to the browser. Security is enforced by Firebase
 * Auth allowed domains + Firestore Security Rules (see firestore.rules).
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
}

/** Throws a clear error if Firebase env vars are missing. */
function assertConfigured<T>(value: T | undefined, name: string): T {
  if (!value) {
    throw new Error(
      `Firebase is not configured (${name}). Copy .env.example to .env.local ` +
        `and fill in your Firebase web config.`
    );
  }
  return value;
}

export const auth = (): Auth => assertConfigured(authInstance, "auth");
export const db = (): Firestore => assertConfigured(dbInstance, "db");

/** Allowlist of friend emails, from VITE_ALLOWLIST (comma-separated). */
export const allowlist: string[] = (import.meta.env.VITE_ALLOWLIST ?? "")
  .split(",")
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAllowed(email: string | null | undefined): boolean {
  if (allowlist.length === 0) return true; // no allowlist configured -> open
  return Boolean(email && allowlist.includes(email.toLowerCase()));
}
