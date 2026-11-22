import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { setupTestEnvironment, getUserContext, getUnauthContext } from "./helpers";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes, updateMetadata } from "firebase/storage";

describe("Firebase Security Rules (Firestore & Storage)", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.clearStorage();
  });

  describe("1. Storage Rules - Listings Images", () => {
    const validFileName = "photo_12345678.webp";
    const userA = "user_a";
    const userB = "user_b";
    const draftId = "draft_12345678";
    const smallPayload = new Uint8Array([1, 2, 3, 4]);

    it("User B không được ghi ảnh vào thư mục của User A", async () => {
      const ctxB = getUserContext(env, userB, { verified: true });
      const storageB = ctxB.storage();
      const fileRef = ref(storageB, `public/listings/${userA}/${draftId}/${validFileName}`);

      await assertFails(
        uploadBytes(fileRef, smallPayload, { contentType: "image/webp" })
      );
    });

    it("User chưa verified không được upload ảnh tin đăng", async () => {
      const ctxA = getUserContext(env, userA, { verified: false });
      const storageA = ctxA.storage();
      const fileRef = ref(storageA, `public/listings/${userA}/${draftId}/${validFileName}`);

      await assertFails(
        uploadBytes(fileRef, smallPayload, { contentType: "image/webp" })
      );
    });

    it("Chủ tin đã verified được upload ảnh hợp lệ vào thư mục của mình", async () => {
      const ctxA = getUserContext(env, userA, { verified: true });
      const storageA = ctxA.storage();
      const fileRef = ref(storageA, `public/listings/${userA}/${draftId}/${validFileName}`);

      await assertSucceeds(
        uploadBytes(fileRef, smallPayload, { contentType: "image/webp" })
      );
    });

    it("Không được update đè file ảnh tin đăng đã tồn tại", async () => {
      const ctxA = getUserContext(env, userA, { verified: true });
      const storageA = ctxA.storage();
      const fileRef = ref(storageA, `public/listings/${userA}/${draftId}/${validFileName}`);

      await assertSucceeds(
        uploadBytes(fileRef, smallPayload, { contentType: "image/webp" })
      );

      // Cố gắng update đè lên file đã có (allow update: if false)
      await assertFails(
        updateMetadata(fileRef, { customMetadata: { updated: "true" } })
      );
    });

    it("User B không được xóa ảnh của User A, nhưng User A và Admin thì được", async () => {
      const ctxA = getUserContext(env, userA, { verified: true });
      const storageA = ctxA.storage();
      const fileRefA = ref(storageA, `public/listings/${userA}/${draftId}/${validFileName}`);
      await uploadBytes(fileRefA, smallPayload, { contentType: "image/webp" });

      const ctxB = getUserContext(env, userB, { verified: true });
      const fileRefB = ref(ctxB.storage(), `public/listings/${userA}/${draftId}/${validFileName}`);
      await assertFails(deleteObject(fileRefB));

      // Admin xóa được
      const ctxAdmin = getUserContext(env, "admin_user", { admin: true });
      const fileRefAdmin = ref(ctxAdmin.storage(), `public/listings/${userA}/${draftId}/${validFileName}`);
      await assertSucceeds(deleteObject(fileRefAdmin));
    });
  });

  describe("2. Storage Rules - Cards & Avatars", () => {
    it("User B không được đọc ảnh thẻ của User A", async () => {
      // Seed ảnh thẻ cho User A
      await env.withSecurityRulesDisabled(async (context) => {
        const fileRef = ref(context.storage(), "private/cards/user_a/card_12345678.webp");
        await uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
      });

      const ctxB = getUserContext(env, "user_b");
      const fileRefB = ref(ctxB.storage(), "private/cards/user_a/card_12345678.webp");
      await assertFails(getBytes(fileRefB));
    });

    it("User B không được upload avatar của User A", async () => {
      const ctxB = getUserContext(env, "user_b");
      const fileRef = ref(ctxB.storage(), "public/avatars/user_a/avatar.webp");
      await assertFails(
        uploadBytes(fileRef, new Uint8Array([1]), { contentType: "image/webp" })
      );
    });

    it("User A được upload avatar của chính mình", async () => {
      const ctxA = getUserContext(env, "user_a");
      const fileRef = ref(ctxA.storage(), "public/avatars/user_a/avatar.webp");
      await assertSucceeds(
        uploadBytes(fileRef, new Uint8Array([1]), { contentType: "image/webp" })
      );
    });
  });

  describe("3. Firestore Rules - Favorites & Follows", () => {
    it("Không thể tạo favorite với userId của người khác", async () => {
      const ctxA = getUserContext(env, "user_a");
      const dbA = ctxA.firestore();
      const favRef = doc(dbA, "favorites", "fav_1");

      await assertFails(
        setDoc(favRef, {
          id: "fav_1",
          userId: "user_b", // Khác auth.uid
          listingId: "listing_123",
          createdAt: serverTimestamp(),
        })
      );
    });

    it("Không thể update đổi userId trong favorite", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const favRef = doc(context.firestore(), "favorites", "fav_1");
        await setDoc(favRef, {
          id: "fav_1",
          userId: "user_a",
          listingId: "listing_123",
          createdAt: new Date(),
        });
      });

      const ctxA = getUserContext(env, "user_a");
      const dbA = ctxA.firestore();
      const favRef = doc(dbA, "favorites", "fav_1");

      // Cấm update hoàn toàn
      await assertFails(
        updateDoc(favRef, {
          userId: "user_b",
        })
      );
    });

    it("Chủ sở hữu được tạo và xóa favorite hợp lệ", async () => {
      const ctxA = getUserContext(env, "user_a");
      const dbA = ctxA.firestore();
      const favRef = doc(dbA, "favorites", "fav_1");

      await assertSucceeds(
        setDoc(favRef, {
          id: "fav_1",
          userId: "user_a",
          listingId: "listing_123",
          createdAt: serverTimestamp(),
        })
      );

      await assertSucceeds(deleteDoc(favRef));
    });

    it("User B không được đọc verifications hoặc usersPrivate của User A", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "verifications", "user_a"), { status: "pending" });
        await setDoc(doc(context.firestore(), "usersPrivate", "user_a"), { email: "a@test.com" });
      });

      const ctxB = getUserContext(env, "user_b");
      const dbB = ctxB.firestore();

      await assertFails(getDoc(doc(dbB, "verifications", "user_a")));
      await assertFails(getDoc(doc(dbB, "usersPrivate", "user_a")));
    });
  });
});
