import { NextResponse } from "next/server";
import { hasAdminCredentials } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    hasAdminCredentials,
    isEmulator: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || null,
    clientEmailSet: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    privateKeySet: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  });
}
