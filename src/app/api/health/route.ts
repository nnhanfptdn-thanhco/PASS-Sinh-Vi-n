import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let adminError = null;
  let adminInfo = null;
  try {
    const admin = await import("@/lib/firebase/admin");
    adminInfo = {
      hasAdminCredentials: admin.hasAdminCredentials,
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
      clientEmailLen: process.env.FIREBASE_CLIENT_EMAIL?.length || 0,
      privateKeyLen: process.env.FIREBASE_PRIVATE_KEY?.length || 0,
    };
  } catch (err: unknown) {
    adminError = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  return NextResponse.json({
    ok: true,
    adminInfo,
    adminError,
    nodeEnv: process.env.NODE_ENV,
    timestamp: Date.now(),
  });
}
