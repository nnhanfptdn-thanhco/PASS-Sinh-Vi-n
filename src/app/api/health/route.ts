import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await import("@/lib/firebase/admin");
    return NextResponse.json({
      ok: true,
      hasAdminCredentials: admin.hasAdminCredentials,
      keys: Object.keys(admin),
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      errorName: err?.name,
      errorMessage: err?.message,
      errorStack: err?.stack,
    });
  }
}
