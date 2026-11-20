import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let firestoreStatus = "unknown";
  let firestoreError = null;
  try {
    const snap = await adminDb.collection("universities").limit(1).get();
    firestoreStatus = `Connected! Docs: ${snap.size}`;
  } catch (err: unknown) {
    firestoreStatus = "Failed";
    firestoreError = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  return NextResponse.json({
    ok: true,
    firestoreStatus,
    firestoreError,
    timestamp: Date.now(),
  });
}
