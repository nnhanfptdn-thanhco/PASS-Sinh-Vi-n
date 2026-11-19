import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";

let testEnv: RulesTestEnvironment | null = null;

export async function setupTestEnvironment(): Promise<RulesTestEnvironment> {
  if (!testEnv) {
    const firestoreRules = fs.readFileSync(
      path.resolve(process.cwd(), "firestore.rules"),
      "utf8"
    );
    const storageRules = fs.readFileSync(
      path.resolve(process.cwd(), "storage.rules"),
      "utf8"
    );

    testEnv = await initializeTestEnvironment({
      projectId: "demo-chopass",
      firestore: {
        rules: firestoreRules,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(":")[0] || "127.0.0.1",
        port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":")[1]) || 8080,
      },
      storage: {
        rules: storageRules,
        host: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(":")[0] || "127.0.0.1",
        port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(":")[1]) || 9199,
      },
    });
  }
  return testEnv;
}

export function getUserContext(
  env: RulesTestEnvironment,
  uid: string,
  claims: { verified?: boolean; admin?: boolean } = {}
) {
  return env.authenticatedContext(uid, claims);
}

export function getUnauthContext(env: RulesTestEnvironment) {
  return env.unauthenticatedContext();
}
