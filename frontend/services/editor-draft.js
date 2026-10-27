/**
 * Browser-local editor drafts.
 * A draft is restored only for the same account and the same server revision.
 * A newer server profile is never replaced by an older browser copy.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.editorDraft = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function ownerId(session) {
    const user = session && session.user;
    const id = user && (user.id || user._id || user.email);
    return id ? String(id) : "";
  }

  function stampOf(profile) {
    if (!profile || profile.updatedAt == null || profile.updatedAt === "") return "";
    const value = profile.updatedAt;
    if (typeof value === "string") return value;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return String(value);
  }

  function storageKey(kind, session) {
    const owner = ownerId(session);
    if (!owner) return "";
    return "ov_editor_draft_v2_" + kind + "_" + owner;
  }

  function readDraft(storage, kind, session) {
    const key = storageKey(kind, session);
    const owner = ownerId(session);
    if (!key || !storage) return null;
    try {
      const parsed = JSON.parse(storage.getItem(key) || "null");
      if (!parsed || parsed.ownerId !== owner || !parsed.draft || typeof parsed.draft !== "object") return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeDraft(storage, kind, session, draft, baseUpdatedAt) {
    const key = storageKey(kind, session);
    const owner = ownerId(session);
    if (!key || !storage || !draft) return false;
    try {
      storage.setItem(key, JSON.stringify({
        ownerId: owner,
        baseUpdatedAt: baseUpdatedAt || "",
        draft: draft,
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearDraft(storage, kind, session) {
    const key = storageKey(kind, session);
    if (!key || !storage) return;
    try {
      storage.removeItem(key);
    } catch (error) {
      /* The in-memory form remains. */
    }
  }

  /**
   * Restore a local draft only when it belongs to this account and was
   * branched from the profile the server just returned.
   */
  function decideDraftRestore(record, serverProfile) {
    const serverStamp = stampOf(serverProfile);
    if (!record || !record.draft) {
      return { action: "use-server", baseUpdatedAt: serverStamp, stale: false };
    }
    if (record.baseUpdatedAt && serverStamp && record.baseUpdatedAt === serverStamp) {
      return { action: "restore-local", baseUpdatedAt: serverStamp, draft: record.draft, stale: false };
    }
    if (record.baseUpdatedAt && serverStamp && record.baseUpdatedAt !== serverStamp) {
      return { action: "use-server", baseUpdatedAt: serverStamp, stale: true };
    }
    return { action: "use-server", baseUpdatedAt: serverStamp, stale: false };
  }

  return {
    ownerId,
    stampOf,
    storageKey,
    readDraft,
    writeDraft,
    clearDraft,
    decideDraftRestore,
  };
});
