import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";

// In-memory rate limiting map: uid -> { count: number, resetAt: number }
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + 3600 * 1000 });
    return true;
  }

  if (entry.count >= 30) {
    return false;
  }

  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const uid = token.uid;

    if (!checkRateLimit(uid)) {
      return NextResponse.json(
        { error: "Bạn đã gửi quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 1 giờ." },
        { status: 429 }
      );
    }

    const userRef = adminDb.collection("users").doc(uid);
    const userPrivateRef = adminDb.collection("usersPrivate").doc(uid);

    // 1. Transaction: Đảm bảo tạo mới hoặc cập nhật thông tin an toàn
    await adminDb.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        // Tạo mới profile người dùng cơ bản (Public)
        // Tuyệt đối không lưu email vào collection users công khai
        transaction.set(userRef, {
          uid,
          displayName: token.name || "Sinh viên",
          photoURL: token.picture || null,
          verified: false,
          rating: null,
          activeListingsCount: 0,
          completedDealsCount: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastLoginAt: FieldValue.serverTimestamp(),
        });

        // Lưu thông tin riêng tư vào usersPrivate (chỉ chủ tài khoản / admin xem)
        transaction.set(
          userPrivateRef,
          {
            uid,
            email: token.email || null,
            emailVerified: Boolean(token.email_verified),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // Tài khoản đã tồn tại: Chỉ cập nhật lastLoginAt và các trường hiển thị nếu đang trống
        const existingData = userSnap.data() || {};
        const updateData: Record<string, unknown> = {
          lastLoginAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (!existingData.displayName && token.name) {
          updateData.displayName = token.name;
        }
        if (!existingData.photoURL && token.picture) {
          updateData.photoURL = token.picture;
        }

        // Tuyệt đối KHÔNG ghi đè verified, rating, các bộ đếm
        transaction.update(userRef, updateData);

        transaction.set(
          userPrivateRef,
          {
            email: token.email || null,
            emailVerified: Boolean(token.email_verified),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    // 2. Admin Bootstrap: Tự động gán quyền Admin nếu email nằm trong ADMIN_EMAILS
    let claimsChanged = false;
    const adminEmailsConfig = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
    const adminEmails = adminEmailsConfig
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = (token.email || "").toLowerCase();
    const isEmailVerified = Boolean(token.email_verified);

    if (
      userEmail &&
      isEmailVerified &&
      adminEmails.includes(userEmail) &&
      token.admin !== true
    ) {
      const currentAuthUser = await adminAuth.getUser(uid);
      const existingClaims = currentAuthUser.customClaims || {};

      await adminAuth.setCustomUserClaims(uid, {
        ...existingClaims,
        admin: true,
        verified: true,
        role: "admin",
      });

      claimsChanged = true;

      // Ghi nhật ký phân quyền admin
      await adminDb.collection("adminLogs").add({
        action: "BOOTSTRAP_ADMIN_CLAIM_GRANTED",
        targetUid: uid,
        targetEmail: userEmail,
        grantedAt: FieldValue.serverTimestamp(),
        reason: "Configured in ADMIN_EMAILS environment variable",
      });
    }

    return NextResponse.json({
      ok: true,
      claimsChanged,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
