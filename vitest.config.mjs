import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/mock-server-only.ts"),
    },
  },
  test: {
    environment: "node",
    env: {
      FIREBASE_PROJECT_ID: "cho-pass-sv-dev",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "cho-pass-sv-dev",
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
      STUDENT_ID_HMAC_SECRET: "dev-emulator-secret-key-32-chars-minimum!!",
    },
  },
});
