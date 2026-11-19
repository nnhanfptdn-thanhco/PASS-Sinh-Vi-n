import { NextResponse } from "next/server";
import { hasAdminCredentials } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    hasAdminCredentials,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? "CONFIGURED" : "MISSING",
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? "CONFIGURED" : "MISSING",
    timestamp: Date.now(),
  });
}
