import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { setupTestEnvironment, getUserContext, getUnauthContext } from "./helpers";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes, updateMetadata } from "firebase/storage";

async function seedApprovedStudent(
  env: RulesTestEnvironment,
  uid: string,
  accountStatus: string = "active"
) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), {
      displayName: `User ${uid}`,
      accountStatus,
      verified: true,
    });
    await setDoc(doc(db, "verifications", uid), {
      userId: uid,
      status: "approved",
      schoolCode: "QSX",
    });
  });
}

async function seedUploadSession(
  env: RulesTestEnvironment,
  params: {
    sessionId: string;
    ownerUid: string;
    kind: "card" | "listing" | "avatar" | "chat";
    allowedPaths: string[];
    status?: string;
    claimed?: boolean;
    expired?: boolean;
  }
) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const expiresAt = params.expired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 3600_000);
    await setDoc(doc(db, "uploadSessions", params.sessionId), {
      sessionId: params.sessionId,
      ownerUid: params.ownerUid,
      kind: params.kind,
      allowedPaths: params.allowedPaths,
      status: params.status ?? "pending",
      claimed: params.claimed ?? false,
      expiresAt,
    });
  });
}

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
    const sessionId = "sess_listing_a";
    const validPath = `public/listings/${userA}/${draftId}/${validFileName}`;
    const smallPayload = new Uint8Array([1, 2, 3, 4]);

    it("User B không được ghi ảnh vào thư mục của User A dù có session/verified", async () => {
      await seedApprovedStudent(env, userB);
      await seedUploadSession(env, {
        sessionId: "sess_listing_b",
        ownerUid: userB,
        kind: "listing",
        allowedPaths: [validPath],
      });

      const ctxB = getUserContext(env, userB, { verified: true });
      const fileRef = ref(ctxB.storage(), validPath);

      await assertFails(
        uploadBytes(fileRef, smallPayload, {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_listing_b" },
        })
      );
    });

    it("User có claim verified cũ nhưng hồ sơ Firestore chưa approved -> TỪ CHỐI upload ảnh tin đăng", async () => {
      await seedUploadSession(env, {
        sessionId,
        ownerUid: userA,
        kind: "listing",
        allowedPaths: [validPath],
      });

      // Stale token verified=true nhưng không có verifications/user_a status=approved
      const ctxA = getUserContext(env, userA, { verified: true });
      const fileRef = ref(ctxA.storage(), validPath);

      await assertFails(
        uploadBytes(fileRef, smallPayload, {
          contentType: "image/webp",
          customMetadata: { sessionId },
        })
      );
    });

    it("Thiếu hoặc sai upload session -> TỪ CHỐI upload dù đã verified", async () => {
      await seedApprovedStudent(env, userA);
      const ctxA = getUserContext(env, userA, { verified: true });
      const fileRef = ref(ctxA.storage(), validPath);

      await assertFails(
        uploadBytes(fileRef, smallPayload, { contentType: "image/webp" })
      );

      // Session không chứa path này
      await seedUploadSession(env, {
        sessionId: "sess_other_path",
        ownerUid: userA,
        kind: "listing",
        allowedPaths: [`public/listings/${userA}/${draftId}/other_1234.webp`],
      });
      await assertFails(
        uploadBytes(fileRef, smallPayload, {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_other_path" },
        })
      );
    });

    it("Chủ tin đã live verified + có upload session hợp lệ -> upload SUCCEEDS, không thể update đè", async () => {
      await seedApprovedStudent(env, userA);
      await seedUploadSession(env, {
        sessionId,
        ownerUid: userA,
        kind: "listing",
        allowedPaths: [validPath],
      });

      const ctxA = getUserContext(env, userA, { verified: true });
      const fileRef = ref(ctxA.storage(), validPath);

      await assertSucceeds(
        uploadBytes(fileRef, smallPayload, {
          contentType: "image/webp",
          customMetadata: { sessionId },
        })
      );

      await assertFails(
        updateMetadata(fileRef, { customMetadata: { updated: "true" } })
      );
    });

    it("Multi-file draft: session ở trạng thái finalized (chưa claimed) vẫn cho phép tải thêm ảnh trong allowedPaths", async () => {
      await seedApprovedStudent(env, userA);
      const secondPath = `public/listings/${userA}/${draftId}/photo_22222222.jpg`;
      await seedUploadSession(env, {
        sessionId: "sess_multi_finalized",
        ownerUid: userA,
        kind: "listing",
        status: "finalized",
        claimed: false,
        allowedPaths: [validPath, secondPath],
      });

      const ctxA = getUserContext(env, userA, { verified: true });
      await assertSucceeds(
        uploadBytes(ref(ctxA.storage(), secondPath), smallPayload, {
          contentType: "image/jpeg",
          customMetadata: { sessionId: "sess_multi_finalized" },
        })
      );
    });

    it("User B không được xóa ảnh của User A, nhưng chủ đã verified và Admin thì được", async () => {
      await seedApprovedStudent(env, userA);
      await seedApprovedStudent(env, userB);
      await seedUploadSession(env, {
        sessionId,
        ownerUid: userA,
        kind: "listing",
        allowedPaths: [validPath],
      });

      const ctxA = getUserContext(env, userA, { verified: true });
      await uploadBytes(ref(ctxA.storage(), validPath), smallPayload, {
        contentType: "image/webp",
        customMetadata: { sessionId },
      });

      const ctxB = getUserContext(env, userB, { verified: true });
      await assertFails(deleteObject(ref(ctxB.storage(), validPath)));

      const ctxAdmin = getUserContext(env, "admin_user", { admin: true });
      await assertSucceeds(deleteObject(ref(ctxAdmin.storage(), validPath)));
    });
  });

  describe("2. Storage Rules - Cards, Avatars & Chats", () => {
    it("User B không được đọc ảnh thẻ của User A", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const fileRef = ref(context.storage(), "private/cards/user_a/card_12345678.webp");
        await uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
      });

      const ctxB = getUserContext(env, "user_b");
      await assertFails(getBytes(ref(ctxB.storage(), "private/cards/user_a/card_12345678.webp")));
    });

    it("Upload ảnh thẻ đòi hỏi upload session kind=card hợp lệ và tài khoản active", async () => {
      await seedUploadSession(env, {
        sessionId: "sess_card_1",
        ownerUid: "user_a",
        kind: "card",
        allowedPaths: ["private/cards/user_a/sess_card_1.webp"],
      });

      const ctxA = getUserContext(env, "user_a");
      await assertSucceeds(
        uploadBytes(ref(ctxA.storage(), "private/cards/user_a/sess_card_1.webp"), new Uint8Array([1, 2]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_card_1" },
        })
      );

      // Tài khoản đang deleting -> TỪ CHỐI
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "pendingDeletions", "user_del"), {
          userId: "user_del",
          deadLetter: false,
        });
      });
      await seedUploadSession(env, {
        sessionId: "sess_card_del",
        ownerUid: "user_del",
        kind: "card",
        allowedPaths: ["private/cards/user_del/sess_card_del.webp"],
      });
      const ctxDel = getUserContext(env, "user_del");
      await assertFails(
        uploadBytes(ref(ctxDel.storage(), "private/cards/user_del/sess_card_del.webp"), new Uint8Array([1]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_card_del" },
        })
      );
    });

    it("Avatar: yêu cầu live verified + session, User khác không thể ghi", async () => {
      await seedApprovedStudent(env, "user_a");
      await seedApprovedStudent(env, "user_b");
      await seedUploadSession(env, {
        sessionId: "sess_avatar_a",
        ownerUid: "user_a",
        kind: "avatar",
        allowedPaths: ["public/avatars/user_a/avatar.webp"],
      });

      const ctxB = getUserContext(env, "user_b", { verified: true });
      await assertFails(
        uploadBytes(ref(ctxB.storage(), "public/avatars/user_a/avatar.webp"), new Uint8Array([1]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_avatar_a" },
        })
      );

      const ctxA = getUserContext(env, "user_a", { verified: true });
      await assertSucceeds(
        uploadBytes(ref(ctxA.storage(), "public/avatars/user_a/avatar.webp"), new Uint8Array([1]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_avatar_a" },
        })
      );

      // Safari iOS/iPadOS fallback JPEG avatar (.jpg)
      await seedUploadSession(env, {
        sessionId: "sess_avatar_jpg",
        ownerUid: "user_a",
        kind: "avatar",
        allowedPaths: ["public/avatars/user_a/avatar.jpg"],
      });
      await assertSucceeds(
        uploadBytes(ref(ctxA.storage(), "public/avatars/user_a/avatar.jpg"), new Uint8Array([1]), {
          contentType: "image/jpeg",
          customMetadata: { sessionId: "sess_avatar_jpg" },
        })
      );
    });

    it("Private chat attachments: chỉ participant active trong conversation active + verified + session đọc/ghi được", async () => {
      await seedApprovedStudent(env, "user_a");
      await seedApprovedStudent(env, "user_b");
      await seedApprovedStudent(env, "user_c");

      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "conversations", "conv_active"), {
          participantIds: ["user_a", "user_b"],
          status: "active",
          blockedBy: {},
        });
        await setDoc(doc(context.firestore(), "conversations", "conv_blocked"), {
          participantIds: ["user_a", "user_b"],
          status: "blocked",
          blockedBy: { user_b: true },
        });
      });

      const chatFile = "private/chats/conv_active/sess_chat_1_0.webp";
      await seedUploadSession(env, {
        sessionId: "sess_chat_1",
        ownerUid: "user_a",
        kind: "chat",
        allowedPaths: [chatFile],
      });

      const ctxA = getUserContext(env, "user_a", { verified: true });
      await assertSucceeds(
        uploadBytes(ref(ctxA.storage(), chatFile), new Uint8Array([1, 2, 3]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_chat_1" },
        })
      );

      // Participant B đọc được; User C (người thứ 3) và Unauth bị từ chối
      const ctxB = getUserContext(env, "user_b", { verified: true });
      await assertSucceeds(getBytes(ref(ctxB.storage(), chatFile)));

      const ctxC = getUserContext(env, "user_c", { verified: true });
      await assertFails(getBytes(ref(ctxC.storage(), chatFile)));
      await assertFails(getBytes(ref(getUnauthContext(env).storage(), chatFile)));

      // Conversation đã blocked -> TỪ CHỐI upload
      const blockedFile = "private/chats/conv_blocked/sess_chat_blk_0.webp";
      await seedUploadSession(env, {
        sessionId: "sess_chat_blk",
        ownerUid: "user_a",
        kind: "chat",
        allowedPaths: [blockedFile],
      });
      await assertFails(
        uploadBytes(ref(ctxA.storage(), blockedFile), new Uint8Array([1]), {
          contentType: "image/webp",
          customMetadata: { sessionId: "sess_chat_blk" },
        })
      );
    });
  });

  describe("3. Firestore Rules - Favorites, Follows & Option A listingsPrivate", () => {
    it("Client bị cấm tạo hoặc xóa favorite trực tiếp", async () => {
      const ctxA = getUserContext(env, "user_a");
      const favRef = doc(ctxA.firestore(), "favorites", "fav_1");

      await assertFails(
        setDoc(favRef, {
          id: "fav_1",
          userId: "user_a",
          listingId: "listing_123",
          createdAt: serverTimestamp(),
        })
      );

      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "favorites", "fav_1"), {
          id: "fav_1",
          userId: "user_a",
          listingId: "listing_123",
          createdAt: new Date(),
        });
      });

      await assertFails(deleteDoc(favRef));
    });

    it("OPTION A HARDENING: Kể cả khi confirmedBuyerId == user_b, user_b VẪN BỊ CẤM đọc trực tiếp listingsPrivate qua SDK", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "listingsPrivate", "listing_1"), {
          sellerId: "user_a",
          exactAddress: "Số 1 Đại Cồ Việt, Hà Nội",
          confirmedBuyerId: "user_b",
          confirmedUntil: new Date(Date.now() + 72 * 3600_000).toISOString(),
        });
      });

      const ctxB = getUserContext(env, "user_b", { verified: true });
      await assertFails(getDoc(doc(ctxB.firestore(), "listingsPrivate", "listing_1")));

      // Chủ tin đọc được
      const ctxA = getUserContext(env, "user_a");
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "listingsPrivate", "listing_1")));
    });

    it("User B không được đọc verifications hoặc usersPrivate của User A", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "verifications", "user_a"), { status: "pending" });
        await setDoc(doc(context.firestore(), "usersPrivate", "user_a"), { email: "a@test.com" });
      });

      const ctxB = getUserContext(env, "user_b");
      await assertFails(getDoc(doc(ctxB.firestore(), "verifications", "user_a")));
      await assertFails(getDoc(doc(ctxB.firestore(), "usersPrivate", "user_a")));
    });
  });

  describe("4. Strict Access Control - Conversations, NnhanAI, Deleting Lock & Internal Queues", () => {
    it("User không được tự nâng role, verified, accountStatus hay sửa displayName trực tiếp", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users", "user_a"), {
          displayName: "User A",
          role: "pending",
          verified: false,
          accountStatus: "active",
        });
      });

      const ctxA = getUserContext(env, "user_a");
      const userRefA = doc(ctxA.firestore(), "users", "user_a");

      await assertFails(updateDoc(userRefA, { role: "admin" }));
      await assertFails(updateDoc(userRefA, { verified: true }));
      await assertFails(updateDoc(userRefA, { accountStatus: "banned" }));
      await assertFails(updateDoc(userRefA, { studentIdHash: "fake_hash" }));
      await assertFails(updateDoc(userRefA, { displayName: deleteField() }));
      await assertFails(updateDoc(userRefA, { photoURL: "https://evil.com/malicious.jpg" }));
      await assertFails(updateDoc(userRefA, { displayName: "User A Updated" }));

      await assertSucceeds(
        updateDoc(userRefA, {
          photoURL: "https://lh3.googleusercontent.com/a/valid-avatar-1234",
        })
      );
    });

    it("Conversations & Messages: MỌI ghi từ Client đều bị chặn (server-only); user deleting không đọc được", async () => {
      await seedApprovedStudent(env, "user_a");
      await seedApprovedStudent(env, "user_b");
      await seedApprovedStudent(env, "user_c");

      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "conversations", "conv_123"), {
          participantIds: ["user_a", "user_b"],
          status: "active",
          updatedAt: new Date(),
        });
        await setDoc(doc(context.firestore(), "conversations", "conv_123", "messages", "msg_seed"), {
          senderId: "user_a",
          text: "Chào bạn",
          createdAt: new Date(),
        });
      });

      // Participant A đọc được
      const ctxA = getUserContext(env, "user_a", { verified: true });
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "conversations", "conv_123")));
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "conversations", "conv_123", "messages", "msg_seed")));

      // Third-party C đọc -> FAILS
      const ctxC = getUserContext(env, "user_c", { verified: true });
      await assertFails(getDoc(doc(ctxC.firestore(), "conversations", "conv_123")));
      await assertFails(getDoc(doc(ctxC.firestore(), "conversations", "conv_123", "messages", "msg_seed")));

      // Mọi ghi trực tiếp message hoặc update conversation từ client -> FAILS
      await assertFails(
        setDoc(doc(ctxA.firestore(), "conversations", "conv_123", "messages", "msg_client"), {
          senderId: "user_a",
          text: "Gửi trực tiếp",
          createdAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(ctxA.firestore(), "conversations", "conv_123"), {
          lastMessage: "Bypass server",
        })
      );

      // Khi user_a có marker pendingDeletions -> không còn quyền đọc trực tiếp
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "pendingDeletions", "user_a"), { userId: "user_a" });
      });
      await assertFails(getDoc(doc(ctxA.firestore(), "conversations", "conv_123")));
    });

    it("aiConversations: chỉ owner đang active đọc được, người khác đọc hoặc client ghi đều FAILS", async () => {
      await seedApprovedStudent(env, "user_a");
      await seedApprovedStudent(env, "user_b");

      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "aiConversations", "ai_1"), {
          ownerUid: "user_a",
          title: "Tìm quạt cũ",
        });
        await setDoc(doc(context.firestore(), "aiConversations", "ai_1", "messages", "m1"), {
          role: "user",
          text: "Gợi ý quạt",
        });
      });

      const ctxA = getUserContext(env, "user_a");
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "aiConversations", "ai_1")));
      await assertSucceeds(getDoc(doc(ctxA.firestore(), "aiConversations", "ai_1", "messages", "m1")));

      const ctxB = getUserContext(env, "user_b");
      await assertFails(getDoc(doc(ctxB.firestore(), "aiConversations", "ai_1")));
      await assertFails(getDoc(doc(ctxB.firestore(), "aiConversations", "ai_1", "messages", "m1")));

      await assertFails(
        setDoc(doc(ctxA.firestore(), "aiConversations", "ai_new"), { ownerUid: "user_a" })
      );
    });

    it("Các collection nội bộ (queues, quotas, locks) bị khóa đọc/ghi tuyệt đối từ client", async () => {
      const ctxAdmin = getUserContext(env, "admin_1", { admin: true });
      const db = ctxAdmin.firestore();

      await assertFails(getDoc(doc(db, "uploadSessions", "s1")));
      await assertFails(getDoc(doc(db, "userUploadQuotas", "q1")));
      await assertFails(getDoc(doc(db, "claimsSyncJobs", "c1")));
      await assertFails(getDoc(doc(db, "storageCleanupJobs", "st1")));
      await assertFails(getDoc(doc(db, "listingOperationJobs", "l1")));
      await assertFails(getDoc(doc(db, "deadLetterAlerts", "d1")));
      await assertFails(getDoc(doc(db, "activeReservationLocks", "r1")));
      await assertFails(getDoc(doc(db, "pendingDeletions", "user_a")));
    });

    it("Client cấm tạo hoặc sửa trực tiếp vào listings và reservations", async () => {
      const ctxA = getUserContext(env, "user_a", { verified: true });
      const dbA = ctxA.firestore();

      await assertFails(
        setDoc(doc(dbA, "listings", "new_listing"), {
          title: "Hack tin đăng",
          price: 1000,
          sellerId: "user_a",
          status: "active",
        })
      );

      await assertFails(
        setDoc(doc(dbA, "reservations", "new_res"), {
          listingId: "listing_1",
          buyerId: "user_a",
          status: "confirmed",
        })
      );
    });
  });
});
