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

// Quyền hạn suy ra duy nhất từ Firebase Auth Custom Claims (không để lộ email admin ra client bundle)
export function deriveRole(claims: Record<string, unknown>) {
  const isAdmin = claims.admin === true || claims.role === "admin";
  const isVerified = claims.verified === true || claims.role === "verified" || isAdmin;
  const role: UserRole = isAdmin ? "admin" : isVerified ? "verified" : "pending";
  return { isAdmin, isVerified, role, adminClaimMissing: false };
}

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
  adminClaimMissing: false,
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
  const [adminClaimMissing, setAdminClaimMissing] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [isWebView, setIsWebView] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const refreshClaims = React.useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      const tokenResult = await u.getIdTokenResult(true);
      const d = deriveRole(tokenResult.claims as Record<string, unknown>);
      setRole(d.role);
      setAdminClaimMissing(d.adminClaimMissing);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              verified: d.isVerified || prev.verificationStatus === "approved",
              isAdmin: d.isAdmin,
              verificationStatus: d.isVerified ? "approved" : prev.verificationStatus,
            }
          : null
      );
    } catch {
      // Giữ nguyên role hiện tại — KHÔNG hạ cấp khi lỗi mạng
    }
  }, []);

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
        setProfile(null);
        setRole("guest");
        setAdminClaimMissing(false);
        setIsLoading(false);
        return;
      }

      try {
        // 1. Lấy Claims từ ID Token hiện tại NGAY LẬP TỨC (từ memory cache, mất 0ms)
        const tokenResult: IdTokenResult = await currentUser.getIdTokenResult();
        if (seq !== authSeq) return;

        const d = deriveRole(tokenResult.claims as Record<string, unknown>);
        setRole(d.role);
        setAdminClaimMissing(d.adminClaimMissing);

        // Khởi tạo profile sơ bộ từ token ngay lập tức (không đọc localStorage giả mạo)
        setProfile({
          uid: currentUser.uid,
          displayName: currentUser.displayName || "Sinh viên",
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          verified: d.isVerified,
          isAdmin: d.isAdmin,
          verificationStatus: d.isVerified ? "approved" : "none",
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
                await refreshClaims();
              }
            }
          })
          .catch(() => {});

        // 3. Đăng ký Snapshot Firestore đọc users/{uid} và verifications/{uid} thời gian thực
        let userDocData: Record<string, unknown> = {};
        let verificationStatus: "none" | "pending" | "approved" | "rejected" | "expired" =
          d.isVerified ? "approved" : "none";

        const updateCombinedProfile = () => {
          if (seq !== authSeq) return;
          const isAppApproved =
            d.isAdmin || (verificationStatus === "none" ? d.isVerified : verificationStatus === "approved");

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
            verified: isAppApproved,
            isAdmin: d.isAdmin,
            isGraduating: (userDocData.isGraduating as boolean) ?? prev?.isGraduating,
            verificationStatus:
              verificationStatus !== "none"
                ? verificationStatus
                : d.isVerified
                ? "approved"
                : "none",
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
            if (verifSnap.exists()) {
              const vData = verifSnap.data();
              verificationStatus = (vData.status as typeof verificationStatus) || "pending";

              // Nếu hồ sơ đã duyệt mà claim chưa có verified, tự động làm mới token
              if (verificationStatus === "approved" && !d.isVerified) {
                try {
                  const refreshedToken = await currentUser.getIdTokenResult(true);
                  if (seq !== authSeq) return;
                  const refreshedD = deriveRole(refreshedToken.claims as Record<string, unknown>);
                  setRole(refreshedD.role);
                  setAdminClaimMissing(refreshedD.adminClaimMissing);
                } catch {
                  // Bỏ qua lỗi làm mới token
                }
              }
            } else {
              verificationStatus = d.isVerified ? "approved" : "none";
            }
            updateCombinedProfile();
          },
          () => {
            if (seq !== authSeq) return;
            verificationStatus = d.isVerified ? "approved" : "none";
            updateCombinedProfile();
          }
        );
      } catch {
        const fallbackD = deriveRole({});
        setRole(fallbackD.role);
        setAdminClaimMissing(fallbackD.adminClaimMissing);
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
        adminClaimMissing,
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
