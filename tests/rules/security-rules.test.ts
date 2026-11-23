import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { setupTestEnvironment, getUserContext, getUnauthContext } from "./helpers";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField } from "firebase/firestore";
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
      const ctxB = getUserContext(env, "user_b", { verified: true });
      const fileRef = ref(ctxB.storage(), "public/avatars/user_a/avatar.webp");
      await assertFails(
        uploadBytes(fileRef, new Uint8Array([1]), { contentType: "image/webp" })
      );
    });

    it("User chưa verified không được upload avatar", async () => {
      const ctxA = getUserContext(env, "user_a", { verified: false });
      const fileRef = ref(ctxA.storage(), "public/avatars/user_a/avatar.webp");
      await assertFails(
        uploadBytes(fileRef, new Uint8Array([1]), { contentType: "image/webp" })
      );
    });

    it("User A đã verified được upload avatar của chính mình", async () => {
      const ctxA = getUserContext(env, "user_a", { verified: true });
      const fileRef = ref(ctxA.storage(), "public/avatars/user_a/avatar.webp");
      await assertSucceeds(
        uploadBytes(fileRef, new Uint8Array([1]), { contentType: "image/webp" })
      );
    });
  });

  describe("3. Firestore Rules - Favorites & Follows (Server-Only Writes)", () => {
    it("Client bị cấm tạo favorite trực tiếp (phải qua Server API /api/favorites/toggle)", async () => {
      const ctxA = getUserContext(env, "user_a");
      const dbA = ctxA.firestore();
      const favRef = doc(dbA, "favorites", "fav_1");

      await assertFails(
        setDoc(favRef, {
          id: "fav_1",
          userId: "user_a",
          listingId: "listing_123",
          createdAt: serverTimestamp(),
        })
      );
    });

    it("Client bị cấm xóa favorite trực tiếp (phải qua Server API)", async () => {
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

      // Cấm xóa trực tiếp
      await assertFails(deleteDoc(favRef));
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

  describe("4. Strict Access Control - Role Escalation, PII & Direct Client Writes", () => {
    it("User không được tự nâng role, verified, hay studentIdHash trên doc users của chính mình", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users", "user_a"), {
          displayName: "User A",
          role: "pending",
          verified: false,
        });
      });

      const ctxA = getUserContext(env, "user_a");
      const userRefA = doc(ctxA.firestore(), "users", "user_a");

      // Thử tự nâng role lên admin -> FAILS
      await assertFails(updateDoc(userRefA, { role: "admin" }));
      // Thử tự set verified: true -> FAILS
      await assertFails(updateDoc(userRefA, { verified: true }));
      // Thử chèn studentIdHash -> FAILS
      await assertFails(updateDoc(userRefA, { studentIdHash: "fake_hash" }));
      // Thử xóa trường displayName bằng deleteField() -> FAILS
      await assertFails(updateDoc(userRefA, { displayName: deleteField() }));
      // Thử cập nhật photoURL từ domain độc hại / lạ -> FAILS
      await assertFails(updateDoc(userRefA, { photoURL: "https://evil.com/malicious.jpg" }));
      // Thử cập nhật displayName trực tiếp từ client -> FAILS (bắt buộc qua Server API /api/account/profile)
      await assertFails(updateDoc(userRefA, { displayName: "User A Updated" }));
      // Cập nhật photoURL từ Google Photos hoặc Firebase Storage hợp lệ -> SUCCEEDS
      await assertSucceeds(
        updateDoc(userRefA, {
          photoURL: "https://lh3.googleusercontent.com/a/valid-avatar-1234",
        })
      );
    });

    it("Tin nhắn trong hội thoại: chỉ thành viên đã xác minh mới được gửi tin nhắn", async () => {
      // Seed cuộc hội thoại giữa user_a và user_b
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "conversations", "conv_123"), {
          participantIds: ["user_a", "user_b"],
          updatedAt: new Date(),
        });
      });

      // User A chưa verified -> Gửi tin nhắn FAILS
      const ctxUnverified = getUserContext(env, "user_a", { verified: false });
      const msgRefUnverified = doc(ctxUnverified.firestore(), "conversations", "conv_123", "messages", "msg_1");
      await assertFails(
        setDoc(msgRefUnverified, {
          senderId: "user_a",
          text: "Xin chào bạn",
          createdAt: serverTimestamp(),
        })
      );

      // User A đã verified -> Gửi tin nhắn SUCCEEDS
      const ctxVerified = getUserContext(env, "user_a", { verified: true });
      const msgRefVerified = doc(ctxVerified.firestore(), "conversations", "conv_123", "messages", "msg_2");
      await assertSucceeds(
        setDoc(msgRefVerified, {
          senderId: "user_a",
          text: "Xin chào bạn",
          createdAt: serverTimestamp(),
        })
      );
    });

    it("User B không được đọc listingsPrivate của User A khi chưa chốt giữ chỗ", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "listingsPrivate", "listing_1"), {
          sellerId: "user_a",
          exactAddress: "Số 1 Đại Cồ Việt, Hà Nội",
          confirmedBuyerId: null,
        });
      });

      const ctxB = getUserContext(env, "user_b");
      const dbB = ctxB.firestore();
      await assertFails(getDoc(doc(dbB, "listingsPrivate", "listing_1")));

      // Chủ sở hữu đọc được
      const ctxA = getUserContext(env, "user_a");
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "listingsPrivate", "listing_1")));
    });

    it("Client cấm tạo hoặc sửa trực tiếp vào collection listings và reservations", async () => {
      const ctxA = getUserContext(env, "user_a", { verified: true });
      const dbA = ctxA.firestore();

      // Cố ghi vào listings từ client -> FAILS
      await assertFails(
        setDoc(doc(dbA, "listings", "new_listing"), {
          title: "Hack tin đăng",
          price: 1000,
          sellerId: "user_a",
          status: "active",
        })
      );

      // Cố ghi vào reservations từ client -> FAILS
      await assertFails(
        setDoc(doc(dbA, "reservations", "new_res"), {
          listingId: "listing_1",
          buyerId: "user_a",
          status: "confirmed",
        })
      );
    });

    it("User B không được ghi ảnh vào thư mục thẻ SV private/cards/user_a của User A", async () => {
      const ctxB = getUserContext(env, "user_b");
      const cardRef = ref(ctxB.storage(), "private/cards/user_a/card_1234.webp");
      await assertFails(
        uploadBytes(cardRef, new Uint8Array([1, 2, 3]), { contentType: "image/webp" })
      );
    });
  });
});
