import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, isAllowed } from "./config";

export interface Profile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
}

const provider = new GoogleAuthProvider();

/**
 * Signs in with Google. On the web this uses the Firebase popup flow; inside
 * the Capacitor (Android) shell it uses the native Google sign-in plugin and
 * then signs the JS SDK in with the returned credential. Rejects if the email
 * is not on the allowlist.
 */
export async function signInWithGoogle(): Promise<Profile> {
  let user: User;
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import(
      "@capacitor-firebase/authentication"
    );
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error("Google sign-in was cancelled.");
    const credential = GoogleAuthProvider.credential(idToken);
    const cred = await signInWithCredential(auth(), credential);
    user = cred.user;
  } else {
    const cred = await signInWithPopup(auth(), provider);
    user = cred.user;
  }
  if (!isAllowed(user.email)) {
    await fbSignOut(auth());
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import(
        "@capacitor-firebase/authentication"
      );
      await FirebaseAuthentication.signOut();
    }
    throw new Error(
      `${user.email ?? "This account"} is not on the invite list for this game.`
    );
  }
  return upsertProfile(user);
}

export async function signOut(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import(
      "@capacitor-firebase/authentication"
    );
    await FirebaseAuthentication.signOut();
  }
  await fbSignOut(auth());
}

/** Creates/updates the player's profile document in Firestore. */
export async function upsertProfile(user: User): Promise<Profile> {
  const profile: Profile = {
    uid: user.uid,
    displayName: user.displayName ?? user.email ?? "Player",
    email: user.email,
    photoURL: user.photoURL
  };
  const ref = doc(db(), "players", user.uid);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      ...profile,
      lastSeen: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() })
    },
    { merge: true }
  );
  return profile;
}

/**
 * Subscribes to auth state. Calls `cb` with the current Profile (or null when
 * signed out / not allowlisted). Returns an unsubscribe function.
 */
export function watchAuth(cb: (profile: Profile | null) => void): () => void {
  return onAuthStateChanged(auth(), async (user) => {
    if (!user || !isAllowed(user.email)) {
      cb(null);
      return;
    }
    cb(await upsertProfile(user));
  });
}
