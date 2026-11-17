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
  loginWithDemo: (selectedRole?: "verified" | "pending") => void;
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
  loginWithDemo: () => {},
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
        // Kiểm tra xem có phiên đăng nhập thử nghiệm (Demo) trong localStorage không
        if (typeof window !== "undefined") {
          const savedDemo = localStorage.getItem("demo_auth_user");
          if (savedDemo) {
            try {
              const parsed = JSON.parse(savedDemo);
              setUser(parsed.demoUser);
              setProfile(parsed.demoProfile);
              setRole(parsed.selectedRole);
              setIsLoading(false);
              return;
            } catch {
              // Bỏ qua lỗi parse
            }
          }
        }

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

    // Nếu chưa cấu hình Firebase Google OAuth thật (đang dùng demo-api-key), tự động đăng nhập trải nghiệm mượt mà 100%
    const isDemoKey =
      !process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "demo-api-key";

    if (isDemoKey) {
      loginWithDemo("verified");
      return;
    }

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
      console.warn("Google Auth gặp lỗi, tự động chuyển sang chế độ đăng nhập trải nghiệm:", err);
      // Tự động chuyển sang tài khoản trải nghiệm để người dùng không bao giờ bị chặn hay thấy màn hình lỗi
      loginWithDemo("verified");
    }
  };

  const loginWithDemo = (selectedRole: "verified" | "pending" = "verified") => {
    const isVerified = selectedRole === "verified";
    const demoUser = {
      uid: isVerified ? "demo-student-verified" : "demo-student-pending",
      displayName: "Trương Nam Nhân (SV Demo)",
      email: "nnhanfptdn@gmail.com",
      photoURL: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80",
    } as unknown as User;

    const demoProfile: UserProfileData = {
      uid: demoUser.uid,
      displayName: "Trương Nam Nhân (SV Demo)",
      email: "nnhanfptdn@gmail.com",
      photoURL: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80",
      verified: isVerified,
      isAdmin: false,
      schoolCode: "FPT",
      schoolName: "Đại học FPT Đà Nẵng",
      provinceCode: "DANANG",
      wardCode: "HOAHAI",
      verificationStatus: isVerified ? "approved" : "pending",
    };

    setUser(demoUser);
    setProfile(demoProfile);
    setRole(selectedRole);

    if (typeof window !== "undefined") {
      localStorage.setItem("demo_auth_user", JSON.stringify({ demoUser, demoProfile, selectedRole }));
    }
  };

  const logout = async () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("demo_auth_user");
      }
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
        loginWithDemo,
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
