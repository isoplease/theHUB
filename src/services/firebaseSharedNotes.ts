import { invoke, isTauri } from '@tauri-apps/api/core';
import { getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  type Unsubscribe,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseSharedNotesConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.appId
  && import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
);

const firebaseApp = firebaseSharedNotesConfigured
  ? getApps()[0] ?? initializeApp(firebaseConfig)
  : null;

// Keep the shared Google session across app restarts. Use in-memory persistence only
// as a last fallback when the WebView's durable storage is unavailable.
export const sharedNotesAuth = firebaseApp
  ? initializeAuth(firebaseApp, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
  })
  : null;

const sharedNotesDb = firebaseApp ? getFirestore(firebaseApp) : null;

export interface SharedNoteSnapshot {
  readonly content: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly hasPendingWrites: boolean;
}

export class SharedNoteRevisionConflict extends Error {
  constructor() {
    super('The shared note changed on another device');
    this.name = 'SharedNoteRevisionConflict';
  }
}

function randomUrlSafeValue(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  new Uint8Array(digest).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function listenForSharedNotesAuth(
  callback: (user: User | null) => void,
): Unsubscribe | undefined {
  return sharedNotesAuth ? onAuthStateChanged(sharedNotesAuth, callback) : undefined;
}

export async function signInToSharedNotes(): Promise<User> {
  if (!sharedNotesAuth) throw new Error('Firebase shared notes are not configured');

  if (!isTauri()) {
    const credential = await signInWithPopup(sharedNotesAuth, new GoogleAuthProvider());
    return credential.user;
  }

  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('Google desktop OAuth client is not configured');

  const state = randomUrlSafeValue(32);
  const codeVerifier = randomUrlSafeValue(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const idToken = await invoke<string>('google_oauth_sign_in', {
    clientId,
    state,
    codeVerifier,
    codeChallenge,
  });
  const credential = GoogleAuthProvider.credential(idToken);
  return (await signInWithCredential(sharedNotesAuth, credential)).user;
}

export async function signOutOfSharedNotes(): Promise<void> {
  if (sharedNotesAuth) await signOut(sharedNotesAuth);
}

function sharedNoteRef(user: User) {
  if (!sharedNotesDb) throw new Error('Firebase shared notes are not configured');
  return doc(sharedNotesDb, 'users', user.uid, 'quickNotes', 'sharedV');
}

export function subscribeToSharedNote(
  user: User,
  onValue: (snapshot: SharedNoteSnapshot | null, fromCache: boolean) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    sharedNoteRef(user),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.exists()) {
        onValue(null, snapshot.metadata.fromCache);
        return;
      }
      const data = snapshot.data();
      if (typeof data.content !== 'string'
        || data.content.length > 230_000
        || !Number.isInteger(data.revision)
        || data.revision < 1) {
        onError(new Error('Shared note data is invalid'));
        return;
      }
      const timestamp = data.updatedAt?.toDate?.();
      onValue({
        content: data.content,
        updatedAt: timestamp instanceof Date ? timestamp.toISOString() : new Date().toISOString(),
        revision: data.revision,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      }, snapshot.metadata.fromCache);
    },
    onError,
  );
}

export async function saveSharedNote(user: User, content: string, expectedRevision: number): Promise<number> {
  if (!sharedNotesDb) throw new Error('Firebase shared notes are not configured');
  if (content.length > 230_000) throw new Error('Shared note is too large');
  return runTransaction(sharedNotesDb, async (transaction) => {
    const reference = sharedNoteRef(user);
    const current = await transaction.get(reference);
    const currentRevision = current.exists() ? current.data().revision : 0;
    if (!Number.isInteger(currentRevision) || currentRevision !== expectedRevision) {
      throw new SharedNoteRevisionConflict();
    }
    const nextRevision = currentRevision + 1;
    transaction.set(reference, {
      content,
      revision: nextRevision,
      updatedAt: serverTimestamp(),
      ownerUid: user.uid,
    });
    return nextRevision;
  });
}
