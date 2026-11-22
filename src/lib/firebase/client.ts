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
import { getClientEnv } from "@/lib/env";

const clientEnv = getClientEnv();

const firebaseConfig = {
  apiKey: clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: clientEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: clientEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: clientEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: clientEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: clientEnv.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Khởi tạo Firebase App (Singleton pattern)
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Kết nối tới Firebase Emulator Suite nếu được kích hoạt
if (
  clientEnv.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" &&
  typeof window !== "undefined"
) {
  // @ts-expect-error global emulator connection flag
  if (!window.__FIREBASE_EMULATORS_CONNECTED__) {
    const authUrl = clientEnv.NEXT_PUBLIC_EMULATOR_AUTH_URL || "http://127.0.0.1:9099";
    const firestoreHost = clientEnv.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST || "127.0.0.1";
    const firestorePort = Number(clientEnv.NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT || 8080);
    const storageHost = clientEnv.NEXT_PUBLIC_EMULATOR_STORAGE_HOST || "127.0.0.1";
    const storagePort = Number(clientEnv.NEXT_PUBLIC_EMULATOR_STORAGE_PORT || 9199);

    try {
      connectAuthEmulator(auth, authUrl, { disableWarnings: true });
      connectFirestoreEmulator(db, firestoreHost, firestorePort);
      connectStorageEmulator(storage, storageHost, storagePort);
      // @ts-expect-error global emulator connection flag
      window.__FIREBASE_EMULATORS_CONNECTED__ = true;
    } catch {
      // Bỏ qua nếu đã gắn kết nối trước đó
    }
  }
}

/**
 * authFetch: Helper gửi request API có tự động đính kèm Firebase ID Token.
 * - Tự động lấy token mới nhất của user đang đăng nhập.
 * - Nếu gặp lỗi 401 (token hết hạn/thu hồi), ép làm mới token 1 lần và thử lại.
 * - Nếu vẫn 401, tự động đăng xuất và điều hướng về trang đăng nhập kèm tham số ?next=.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const currentUser = auth.currentUser;
  let token: string | undefined;

  if (currentUser) {
    try {
      token = await currentUser.getIdToken();
    } catch {
      // Bỏ qua lỗi lấy token ban đầu
    }
  }

  const makeHeaders = (bearerToken?: string) => {
    const headers = new Headers(init?.headers);
    if (bearerToken) {
      headers.set("Authorization", `Bearer ${bearerToken}`);
    }
    return headers;
  };

  let response = await fetch(input, {
    ...init,
    headers: makeHeaders(token),
  });

  // Nếu trả về 401 Unauthorized và user đang tồn tại, thử ép làm mới token và gửi lại một lần
  if (response.status === 401 && currentUser) {
    try {
      const refreshedToken = await currentUser.getIdToken(true);
      response = await fetch(input, {
        ...init,
        headers: makeHeaders(refreshedToken),
      });
    } catch {
      // Thất bại khi làm mới token
    }
  }

  return response;
}
