"use client";

import * as React from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  getRedirectResult,
  signOut,
  IdTokenResult,
} from "firebase/auth";
import { doc, onSnapshot, Unsubscribe } from "firebase/firestore";
import { auth, db, googleProvider, authFetch } from "@/lib/firebase/client";
import { isEmbeddedWebView } from "@/lib/utils/webview";
import { getFirebaseAuthErrorMessage } from "@/lib/auth/errors";
import { deriveRole, UserRole } from "@/lib/auth/role";

export { deriveRole };
export type { UserRole };

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
  adminClaimMissing: boolean;
  isLoading: boolean;
  isVerificationLoaded: boolean;
  isSigningIn: boolean;
  isWebView: boolean;
  loginWithGoogle: () => Promise<void>;
  reauthenticateWithGoogle: () => Promise<boolean>;
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
  adminClaimMissing: false,
  isLoading: true,
  isVerificationLoaded: false,
  isSigningIn: false,
  isWebView: false,
  loginWithGoogle: async () => {},
  reauthenticateWithGoogle: async () => false,
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
  const [adminClaimMissing, setAdminClaimMissing] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isVerificationLoaded, setIsVerificationLoaded] = React.useState(false);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [isWebView, setIsWebView] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Giữ kết quả deriveRole mới nhất trong ref để các callback onSnapshot KHÔNG bao giờ ghi đè bằng closure cũ
  const derivedRoleRef = React.useRef<ReturnType<typeof deriveRole>>(deriveRole({}));

  const refreshClaims = React.useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      const tokenResult = await u.getIdTokenResult(true);
      const d = deriveRole(tokenResult.claims as Record<string, unknown>);
      derivedRoleRef.current = d;
      setRole(d.role);
      setAdminClaimMissing(d.adminClaimMissing);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              verified: d.isAdmin || d.isVerified || prev.verificationStatus === "approved",
              isAdmin: d.isAdmin,
              verificationStatus:
                d.isAdmin || d.isVerified ? "approved" : prev.verificationStatus,
            }
          : null
      );
    } catch {
      // Giữ nguyên role hiện tại — KHÔNG hạ cấp khi lỗi mạng
    }
  }, []);

  React.useEffect(() => {
    setIsWebView(isEmbeddedWebView());

    // Xử lý kết quả trả về từ signInWithRedirect / reauthenticateWithRedirect (đặc biệt trên Safari iPhone/iPad)
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          // onAuthStateChanged sẽ tiếp quản cập nhật state
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
    let authSeq = 0;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      const seq = ++authSeq;

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
        derivedRoleRef.current = deriveRole({});
        setProfile(null);
        setRole("guest");
        setAdminClaimMissing(false);
        setIsVerificationLoaded(true);
        setIsLoading(false);
        return;
      }

      setIsVerificationLoaded(false);

      try {
        // 1. Lấy Claims từ ID Token hiện tại NGAY LẬP TỨC
        const tokenResult: IdTokenResult = await currentUser.getIdTokenResult();
        if (seq !== authSeq) return;

        const initialD = deriveRole(tokenResult.claims as Record<string, unknown>);
        derivedRoleRef.current = initialD;
        setRole(initialD.role);
        setAdminClaimMissing(initialD.adminClaimMissing);

        // Khởi tạo profile sơ bộ; để verificationStatus = undefined nếu chưa chắc chắn để tránh redirect sớm sang onboarding
        setProfile({
          uid: currentUser.uid,
          displayName: currentUser.displayName || "Sinh viên",
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          verified: initialD.isAdmin || initialD.isVerified,
          isAdmin: initialD.isAdmin,
          verificationStatus: initialD.isAdmin || initialD.isVerified ? "approved" : undefined,
        });

        setIsLoading(false);

        // 2. Chạy Bootstrap API trong nền & cập nhật lại claims nếu máy chủ vừa cấp quyền (Admin/Verified)
        authFetch("/api/auth/bootstrap", {
          method: "POST",
        })
          .then(async (res) => {
            if (seq !== authSeq) return;
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              if (data?.claimsChanged) {
                await currentUser.getIdToken(true);
                if (seq !== authSeq) return;
                await refreshClaims();
              }
            }
          })
          .catch(() => {});

        // 3. Đăng ký Snapshot Firestore đọc users/{uid} và verifications/{uid} thời gian thực
        let userDocData: Record<string, unknown> = {};
        let verificationStatus: "none" | "pending" | "approved" | "rejected" | "expired" | undefined =
          initialD.isAdmin || initialD.isVerified ? "approved" : undefined;

        const updateCombinedProfile = () => {
          if (seq !== authSeq) return;
          const latestD = derivedRoleRef.current;
          const isAppApproved =
            latestD.isAdmin ||
            (verificationStatus === undefined || verificationStatus === "none"
              ? latestD.isVerified
              : verificationStatus === "approved");

          const effectiveVerificationStatus =
            verificationStatus !== undefined && verificationStatus !== "none"
              ? verificationStatus
              : latestD.isAdmin || latestD.isVerified
              ? "approved"
              : verificationStatus;

          setProfile((prev) => ({
            uid: currentUser.uid,
            displayName:
              (userDocData.displayName as string) ||
              prev?.displayName ||
              currentUser.displayName ||
              "Sinh viên",
            email: currentUser.email,
            photoURL:
              userDocData.photoURL !== undefined
                ? ((userDocData.photoURL as string | null) ?? null)
                : prev?.photoURL ?? currentUser.photoURL,
            schoolCode: (userDocData.schoolCode as string) || prev?.schoolCode,
            schoolName: (userDocData.schoolName as string) || prev?.schoolName,
            campusId: (userDocData.campusId as string) || prev?.campusId,
            campusName: (userDocData.campusName as string) || prev?.campusName,
            provinceCode: (userDocData.provinceCode as string) || prev?.provinceCode,
            wardCode: (userDocData.wardCode as string) || prev?.wardCode,
            verified: isAppApproved,
            isAdmin: latestD.isAdmin,
            isGraduating: (userDocData.isGraduating as boolean) ?? prev?.isGraduating,
            verificationStatus: effectiveVerificationStatus,
          }));
        };

        const userDocRef = doc(db, "users", currentUser.uid);
        unsubUserDoc = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (seq !== authSeq) return;
            if (docSnap.exists()) {
              userDocData = docSnap.data();
              updateCombinedProfile();
            }
            setIsLoading(false);
          },
          () => {
            if (seq === authSeq) setIsLoading(false);
          }
        );

        const verificationDocRef = doc(db, "verifications", currentUser.uid);
        unsubVerificationDoc = onSnapshot(
          verificationDocRef,
          async (verifSnap) => {
            if (seq !== authSeq) return;
            const latestD = derivedRoleRef.current;
            if (verifSnap.exists()) {
              const vData = verifSnap.data();
              verificationStatus = (vData.status as typeof verificationStatus) || "pending";

              // Nếu hồ sơ đã duyệt mà claim chưa có verified, tự động làm mới token
              if (verificationStatus === "approved" && !latestD.isVerified) {
                try {
                  const refreshedToken = await currentUser.getIdTokenResult(true);
                  if (seq !== authSeq) return;
                  const refreshedD = deriveRole(refreshedToken.claims as Record<string, unknown>);
                  derivedRoleRef.current = refreshedD;
                  setRole(refreshedD.role);
                  setAdminClaimMissing(refreshedD.adminClaimMissing);
                } catch {
                  // Bỏ qua lỗi làm mới token
                }
              }
            } else {
              verificationStatus = latestD.isAdmin || latestD.isVerified ? "approved" : "none";
            }
            setIsVerificationLoaded(true);
            updateCombinedProfile();
          },
          () => {
            if (seq !== authSeq) return;
            const latestD = derivedRoleRef.current;
            verificationStatus = latestD.isAdmin || latestD.isVerified ? "approved" : "none";
            setIsVerificationLoaded(true);
            updateCombinedProfile();
          }
        );
      } catch {
        const fallbackD = deriveRole({});
        derivedRoleRef.current = fallbackD;
        setRole(fallbackD.role);
        setAdminClaimMissing(fallbackD.adminClaimMissing);
        setIsVerificationLoaded(true);
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
      if (unsubVerificationDoc) unsubVerificationDoc();
    };
  }, [refreshClaims]);

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

    if (isEmbeddedWebView()) {
      setErrorMessage(
        "Bạn đang mở trong ứng dụng Zalo/Facebook/TikTok. Vui lòng bấm vào biểu tượng ba chấm (...) và chọn 'Mở bằng Safari' (iPhone/iPad) hoặc 'Mở bằng Chrome' (Android) để đăng nhập Google an toàn."
      );
      return;
    }

    if (isSigningIn) return;
    setIsSigningIn(true);

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (popupErr: unknown) {
      const err = popupErr as { code?: string; message?: string };
      const code = err?.code;

      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/internal-error"
      ) {
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
        // Người dùng tự đóng hoặc huỷ popup
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

  const reauthenticateWithGoogle = async (): Promise<boolean> => {
    const u = auth.currentUser;
    if (!u) return false;
    setErrorMessage(null);
    try {
      await reauthenticateWithPopup(u, googleProvider);
      await u.getIdToken(true);
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/internal-error"
      ) {
        try {
          await reauthenticateWithRedirect(u, googleProvider);
          return false;
        } catch (rErr) {
          const msg = getFirebaseAuthErrorMessage((rErr as { code?: string })?.code);
          if (msg) setErrorMessage(msg);
          return false;
        }
      }
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        const msg = getFirebaseAuthErrorMessage(code);
        if (msg) setErrorMessage(msg);
      }
      return false;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      derivedRoleRef.current = deriveRole({});
      setRole("guest");
      setUser(null);
      setProfile(null);
      setIsVerificationLoaded(true);
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
        adminClaimMissing,
        isLoading,
        isVerificationLoaded,
        isSigningIn,
        isWebView,
        loginWithGoogle,
        reauthenticateWithGoogle,
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
