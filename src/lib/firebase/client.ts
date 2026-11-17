import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getStorage,
  connectStorageEmulator,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "cho-pass-sv-dev.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "cho-pass-sv-dev.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456",
};

// Khởi tạo Firebase App (Singleton)
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Kết nối tới Firebase Emulator Suite nếu đang ở môi trường phát triển cục bộ
if (
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" &&
  typeof window !== "undefined"
) {
  // Tránh kết nối lặp lại trong quá trình HMR (Hot Module Replacement)
  // @ts-expect-error global emulator connection flag
  if (!window.__FIREBASE_EMULATORS_CONNECTED__) {
    const authUrl = process.env.NEXT_PUBLIC_EMULATOR_AUTH_URL || "http://127.0.0.1:9099";
    const firestoreHost = process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST || "127.0.0.1";
    const firestorePort = Number(process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT || 8080);
    const storageHost = process.env.NEXT_PUBLIC_EMULATOR_STORAGE_HOST || "127.0.0.1";
    const storagePort = Number(process.env.NEXT_PUBLIC_EMULATOR_STORAGE_PORT || 9199);

    try {
      connectAuthEmulator(auth, authUrl, { disableWarnings: true });
      connectFirestoreEmulator(db, firestoreHost, firestorePort);
      connectStorageEmulator(storage, storageHost, storagePort);
      console.log("⚡ Đã kết nối Firebase Client với Local Emulator Suite thành công.");
      // @ts-expect-error global emulator connection flag
      window.__FIREBASE_EMULATORS_CONNECTED__ = true;
    } catch {
      // Bỏ qua nếu đã kết nối
    }
  }
}
