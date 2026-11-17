import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// ▼▼▼  PASTE YOUR FIREBASE CONFIG HERE  ▼▼▼
//
// Recommended: put the values in a ".env" file (see ".env.example") and leave
// this object as-is. Alternatively, replace each `import.meta.env...` expression
// with the literal string from the Firebase console, e.g.  apiKey: "AIzaSy...".
//
// These web config values are NOT secrets — Firestore security rules protect
// your data (see firestore.rules).
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};
// ▲▲▲  END OF CONFIG  ▲▲▲

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
