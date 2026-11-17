"use client";

import * as React from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  IdTokenResult,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase/client";
import { isEmbeddedWebView } from "@/lib/utils/webview";

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
  isWebView: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  errorMessage: string | null;
  clearError: () => void;
}

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  profile: null,
  role: "guest",
  isLoading: true,
  isWebView: false,
  loginWithGoogle: async () => {},
  logout: async () => {},
  refreshClaims: async () => {},
  errorMessage: null,
  clearError: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [role, setRole] = React.useState<UserRole>("guest");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isWebView, setIsWebView] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setIsWebView(isEmbeddedWebView());

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const tokenResult: IdTokenResult = await currentUser.getIdTokenResult(true);
          const claims = tokenResult.claims;
          const isAdmin = Boolean(claims.admin);
          const isVerified = Boolean(claims.verified);

          let currentRole: UserRole = "pending";
          if (isAdmin) currentRole = "admin";
          else if (isVerified) currentRole = "verified";

          setRole(currentRole);
          setProfile({
            uid: currentUser.uid,
            displayName: currentUser.displayName || "Sinh viên",
            email: currentUser.email,
            photoURL: currentUser.photoURL,
            verified: isVerified,
            isAdmin,
            verificationStatus: isVerified ? "approved" : "pending",
          });
        } catch {
          setRole("pending");
        }
      } else {
        setRole("guest");
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const refreshClaims = async () => {
    if (!auth.currentUser) return;
    try {
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const isAdmin = Boolean(tokenResult.claims.admin);
      const isVerified = Boolean(tokenResult.claims.verified);

      let currentRole: UserRole = "pending";
      if (isAdmin) currentRole = "admin";
      else if (isVerified) currentRole = "verified";

      setRole(currentRole);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              verified: isVerified,
              isAdmin,
              verificationStatus: isVerified ? "approved" : "pending",
            }
          : null
      );
    } catch {
      // Bỏ qua lỗi làm mới token
    }
  };

  const loginWithGoogle = async () => {
    setErrorMessage(null);

    // Kiểm tra trình duyệt nhúng Zalo / Facebook
    if (isEmbeddedWebView()) {
      setErrorMessage(
        "Bạn đang mở trong ứng dụng Zalo/Facebook. Vui lòng bấm vào dấu ba chấm (...) và chọn 'Mở bằng Chrome' hoặc 'Mở bằng Safari' để đăng nhập Google an toàn."
      );
      return;
    }

    try {
      const isMobile =
        typeof window !== "undefined" &&
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      if (isMobile) {
        await signInWithRedirect(auth, googleProvider);
      } else {
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (popupErr: unknown) {
          const err = popupErr as { code?: string };
          if (
            err.code === "auth/popup-blocked" ||
            err.code === "auth/cancelled-popup-request"
          ) {
            // Dự phòng chuyển sang redirect nếu trình duyệt chặn popup
            await signInWithRedirect(auth, googleProvider);
          } else {
            throw popupErr;
          }
        }
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      console.error("Lỗi đăng nhập Google:", e);

      // Thông báo lỗi tiếng Việt thân thiện
      switch (e.code) {
        case "auth/network-request-failed":
          setErrorMessage("Mất kết nối mạng. Vui lòng kiểm tra lại Wifi/4G của bạn.");
          break;
        case "auth/popup-closed-by-user":
          setErrorMessage("Cửa sổ đăng nhập đã bị đóng trước khi hoàn tất.");
          break;
        case "auth/user-disabled":
          setErrorMessage("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ hỗ trợ hoặc gửi kháng nghị.");
          break;
        default:
          setErrorMessage("Không thể đăng nhập Google lúc này. Vui lòng thử lại sau giây lát.");
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setRole("guest");
      setUser(null);
      setProfile(null);
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
        isWebView,
        loginWithGoogle,
        logout,
        refreshClaims,
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
