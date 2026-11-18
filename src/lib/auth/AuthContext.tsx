"use client";

import * as React from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  IdTokenResult,
} from "firebase/auth";
import { doc, onSnapshot, Unsubscribe } from "firebase/firestore";
import { auth, db, googleProvider, authFetch } from "@/lib/firebase/client";
import { isEmbeddedWebView } from "@/lib/utils/webview";
import { getFirebaseAuthErrorMessage } from "@/lib/auth/errors";

export type UserRole = "guest" | "pending" | "verified" | "admin";

export interface UserProfileData {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  schoolCode?: string;
  schoolName?: string;
  campusId?: string;
  campusName?: string;
  provinceCode?: string;
  wardCode?: string;
  verified: boolean;
  isAdmin: boolean;
  isGraduating?: boolean;
  verificationStatus?: "none" | "pending" | "approved" | "rejected" | "expired";
}

interface AuthContextType {
  user: User | null;
  profile: UserProfileData | null;
  role: UserRole;
  isLoading: boolean;
  isSigningIn: boolean;
  isWebView: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  getIdToken: () => Promise<string | undefined>;
  errorMessage: string | null;
  clearError: () => void;
}

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  profile: null,
  role: "guest",
  isLoading: true,
  isSigningIn: false,
  isWebView: false,
  loginWithGoogle: async () => {},
  logout: async () => {},
  refreshClaims: async () => {},
  getIdToken: async () => undefined,
  errorMessage: null,
  clearError: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [role, setRole] = React.useState<UserRole>("guest");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [isWebView, setIsWebView] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setIsWebView(isEmbeddedWebView());

    // Xử lý kết quả trả về từ signInWithRedirect nếu có
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          // Thành công từ redirect
        }
      })
      .catch((err: unknown) => {
        const firebaseErr = err as { code?: string };
        const msg = getFirebaseAuthErrorMessage(firebaseErr?.code);
        if (msg) {
          setErrorMessage(msg);
        }
      });

    let unsubUserDoc: Unsubscribe | null = null;
    let unsubVerificationDoc: Unsubscribe | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      // Dọn dẹp listeners cũ nếu đổi user
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
      if (unsubVerificationDoc) {
        unsubVerificationDoc();
        unsubVerificationDoc = null;
      }

      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setRole("guest");
        setIsLoading(false);
        return;
      }

      try {
        // 1. Lấy Claims từ ID Token hiện tại NGAY LẬP TỨC (từ memory cache, mất 0ms)
        const tokenResult: IdTokenResult = await currentUser.getIdTokenResult();
        const isAdmin = Boolean(tokenResult.claims.admin);
        const isVerified = Boolean(tokenResult.claims.verified);

        // Đọc cache profile cục bộ đã xác thực nếu có
        let cachedProfile: Partial<UserProfileData> | null = null;
        try {
          const cachedStr =
            typeof window !== "undefined"
              ? localStorage.getItem(`cho_pass_profile_${currentUser.uid}`)
              : null;
          if (cachedStr) cachedProfile = JSON.parse(cachedStr);
        } catch {
          // Bỏ qua lỗi đọc cache
        }

        const effectiveAdmin = Boolean(isAdmin || cachedProfile?.isAdmin);
        const effectiveVerified = Boolean(isVerified || cachedProfile?.verified);

        let currentRole: UserRole = "pending";
        if (effectiveAdmin) currentRole = "admin";
        else if (effectiveVerified) currentRole = "verified";
        setRole(currentRole);

        // Khởi tạo profile sơ bộ từ token và cache ngay lập tức
        setProfile({
          uid: currentUser.uid,
          displayName:
            cachedProfile?.displayName || currentUser.displayName || "Sinh viên",
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          schoolCode: cachedProfile?.schoolCode,
          schoolName: cachedProfile?.schoolName,
          campusId: cachedProfile?.campusId,
          provinceCode: cachedProfile?.provinceCode,
          wardCode: cachedProfile?.wardCode,
          verified: effectiveVerified,
          isAdmin: effectiveAdmin,
          verificationStatus:
            cachedProfile?.verificationStatus || (isVerified ? "approved" : "none"),
        });

        // Bỏ cờ isLoading NGAY LẬP TỨC để toàn bộ giao diện phản hồi 60 FPS, không bị đơ/lag
        setIsLoading(false);

        // 2. Chạy Bootstrap API ngầm trong nền (Fire-and-forget, không chặn render giao diện)
        authFetch("/api/auth/bootstrap", {
          method: "POST",
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              if (data?.claimsChanged) {
                await currentUser.getIdToken(true);
              }
            }
          })
          .catch(() => {});

        // 3. Đăng ký Snapshot Firestore đọc users/{uid} và verifications/{uid} thời gian thực
        let userDocData: Record<string, unknown> = {};
        let verificationStatus: "none" | "pending" | "approved" | "rejected" | "expired" =
          effectiveVerified ? "approved" : "none";

        const updateCombinedProfile = () => {
          setProfile((prev) => ({
            uid: currentUser.uid,
            displayName:
              (userDocData.displayName as string) ||
              prev?.displayName ||
              currentUser.displayName ||
              "Sinh viên",
            email: currentUser.email,
            photoURL: (userDocData.photoURL as string) || currentUser.photoURL,
            schoolCode: (userDocData.schoolCode as string) || prev?.schoolCode,
            schoolName: (userDocData.schoolName as string) || prev?.schoolName,
            campusId: (userDocData.campusId as string) || prev?.campusId,
            campusName: (userDocData.campusName as string) || prev?.campusName,
            provinceCode: (userDocData.provinceCode as string) || prev?.provinceCode,
            wardCode: (userDocData.wardCode as string) || prev?.wardCode,
            verified: Boolean(userDocData.verified || effectiveVerified || prev?.verified),
            isAdmin: effectiveAdmin,
            isGraduating: (userDocData.isGraduating as boolean) ?? prev?.isGraduating,
            verificationStatus:
              verificationStatus !== "none"
                ? verificationStatus
                : prev?.verificationStatus || "none",
          }));
        };

        const userDocRef = doc(db, "users", currentUser.uid);
        unsubUserDoc = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              userDocData = docSnap.data();
              updateCombinedProfile();
            }
            setIsLoading(false);
          },
          () => {
            setIsLoading(false);
          }
        );

        const verificationDocRef = doc(db, "verifications", currentUser.uid);
        unsubVerificationDoc = onSnapshot(
          verificationDocRef,
          async (verifSnap) => {
            if (verifSnap.exists()) {
              const vData = verifSnap.data();
              verificationStatus = (vData.status as typeof verificationStatus) || "pending";

              // Nếu hồ sơ đã duyệt mà claim chưa có verified, tự động làm mới token
              if (verificationStatus === "approved" && !isVerified) {
                try {
                  const refreshedToken = await currentUser.getIdTokenResult(true);
                  if (refreshedToken.claims.verified) {
                    setRole(refreshedToken.claims.admin ? "admin" : "verified");
                  }
                } catch {
                  // Bỏ qua lỗi làm mới token
                }
              }
            } else {
              verificationStatus = isVerified ? "approved" : "none";
            }
            updateCombinedProfile();
          },
          () => {
            // Người dùng chưa có hồ sơ xác minh
            verificationStatus = isVerified ? "approved" : "none";
            updateCombinedProfile();
          }
        );
      } catch {
        setRole("pending");
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
      if (unsubVerificationDoc) unsubVerificationDoc();
    };
  }, []);

  const refreshClaims = async () => {
    if (!auth.currentUser) return;
    try {
      let cachedProfile: Partial<UserProfileData> | null = null;
      try {
        const cachedStr =
          typeof window !== "undefined"
            ? localStorage.getItem(`cho_pass_profile_${auth.currentUser.uid}`)
            : null;
        if (cachedStr) cachedProfile = JSON.parse(cachedStr);
      } catch {
        // Bỏ qua lỗi đọc cache
      }

      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const isAdmin = Boolean(tokenResult.claims.admin || cachedProfile?.isAdmin);
      const isVerified = Boolean(
        tokenResult.claims.verified || cachedProfile?.verified
      );

      let currentRole: UserRole = "pending";
      if (isAdmin) currentRole = "admin";
      else if (isVerified) currentRole = "verified";

      setRole(currentRole);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              ...cachedProfile,
              verified: isVerified,
              isAdmin,
              verificationStatus:
                cachedProfile?.verificationStatus ||
                (isVerified ? "approved" : prev.verificationStatus),
            }
          : (cachedProfile as UserProfileData | null)
      );
    } catch {
      // Bỏ qua lỗi làm mới token
    }
  };

  const getIdToken = async (): Promise<string | undefined> => {
    if (!auth.currentUser) return undefined;
    try {
      return await auth.currentUser.getIdToken();
    } catch {
      return undefined;
    }
  };

  const loginWithGoogle = async () => {
    setErrorMessage(null);

    // Kiểm tra trình duyệt nhúng Zalo / Facebook / TikTok...
    if (isEmbeddedWebView()) {
      setErrorMessage(
        "Bạn đang mở trong ứng dụng Zalo/Facebook/TikTok. Vui lòng bấm vào biểu tượng ba chấm (...) ở góc trên và chọn 'Mở bằng Chrome' hoặc 'Mở bằng Safari' để đăng nhập Google an toàn."
      );
      return;
    }

    if (isSigningIn) return;
    setIsSigningIn(true);

    try {
      // Mặc định đăng nhập bằng Popup đồng bộ
      await signInWithPopup(auth, googleProvider);
    } catch (popupErr: unknown) {
      const err = popupErr as { code?: string; message?: string };
      const code = err?.code;

      if (code === "auth/popup-blocked") {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr: unknown) {
          const rErr = redirectErr as { code?: string };
          const msg = getFirebaseAuthErrorMessage(rErr?.code);
          if (msg) setErrorMessage(msg);
        }
      } else if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        // Người dùng tự đóng hoặc huỷ popup: Im lặng, không hiển thị thông báo đỏ
      } else {
        const msg = getFirebaseAuthErrorMessage(code);
        if (msg) {
          setErrorMessage(msg);
        }
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setRole("guest");
      setUser(null);
      setProfile(null);
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } catch (err) {
      console.error("Lỗi đăng xuất:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        isLoading,
        isSigningIn,
        isWebView,
        loginWithGoogle,
        logout,
        refreshClaims,
        getIdToken,
        errorMessage,
        clearError: () => setErrorMessage(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return React.useContext(AuthContext);
}
