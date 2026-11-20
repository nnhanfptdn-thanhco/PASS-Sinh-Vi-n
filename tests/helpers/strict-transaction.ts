/**
 * Helper mô phỏng Firestore Strict Transaction semantics
 * Ném lỗi "Firestore transactions require all reads to be executed before all writes."
 * nếu có bất kỳ lệnh get() nào được gọi sau set(), update(), hoặc delete().
 */
export function makeStrictTransaction(store: Map<string, any>) {
  let wrote = false;

  return {
    get: async (refOrQuery: any) => {
      if (wrote) {
        throw new Error("Firestore transactions require all reads to be executed before all writes.");
      }
      if (typeof refOrQuery?.__get === "function") {
        return await refOrQuery.__get();
      }
      const key = refOrQuery?.path || refOrQuery?.id || "doc";
      const exists = store.has(key);
      return {
        exists,
        id: refOrQuery?.id || key,
        data: () => (exists ? store.get(key) : undefined),
      };
    },
    set: (ref: any, data: any) => {
      wrote = true;
      const key = ref?.path || ref?.id || "doc";
      store.set(key, data);
    },
    update: (ref: any, data: any) => {
      wrote = true;
      const key = ref?.path || ref?.id || "doc";
      const prev = store.get(key) || {};
      store.set(key, { ...prev, ...data });
    },
    delete: (ref: any) => {
      wrote = true;
      const key = ref?.path || ref?.id || "doc";
      store.delete(key);
    },
  };
}
