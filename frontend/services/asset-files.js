/**
 * Client-side checks for the existing asset upload API.
 * The server repeats these checks and is the authority.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.assetFiles = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const POLICIES = {
    "profile-photo": { maxBytes: 2 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], label: "JPEG, PNG, or WebP up to 2 MB" },
    "portfolio-image": { maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], label: "JPEG, PNG, or WebP up to 5 MB" },
    "portfolio-media": { maxBytes: 8 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], label: "JPEG, PNG, WebP, or PDF up to 8 MB" },
    resume: { maxBytes: 10 * 1024 * 1024, mimeTypes: ["application/pdf"], label: "PDF up to 10 MB" },
    evidence: { maxBytes: 8 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], label: "JPEG, PNG, WebP, or PDF up to 8 MB" },
    certificate: { maxBytes: 8 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], label: "JPEG, PNG, WebP, or PDF up to 8 MB" },
  };

  const PRIVATE_PURPOSES = ["resume", "evidence", "certificate", "profile-photo"];

  function mimeFromName(name) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "pdf") return "application/pdf";
    return "";
  }

  function policyFor(purpose) {
    return POLICIES[purpose] || null;
  }

  function validateAssetFile(purpose, file) {
    const policy = policyFor(purpose);
    if (!policy) return "This field does not accept a file upload.";
    if (!file) return "Choose a file.";
    const size = typeof file.size === "number" ? file.size : 0;
    if (size <= 0) return "The selected file is empty.";
    if (size > policy.maxBytes) return "That file is too large. Use " + policy.label + ".";
    const mime = file.type || mimeFromName(file.name);
    if (policy.mimeTypes.indexOf(mime) === -1) {
      return "That file type is not supported. Use " + policy.label + ".";
    }
    return "";
  }

  function isPrivatePurpose(purpose) {
    return PRIVATE_PURPOSES.indexOf(purpose) !== -1;
  }

  return { POLICIES, policyFor, validateAssetFile, isPrivatePurpose, mimeFromName };
});
