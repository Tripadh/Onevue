/**
 * =========================================================================
 * OneVue — Administrator Source Inspection (read-only)
 * =========================================================================
 *
 * The artifact preview shows what a student would receive: the built,
 * DTO-adapted release. That is the right surface for judging layout, and the
 * wrong surface for judging a source that has not been built yet — a
 * submission that is still awaiting human review has no artifact at all.
 *
 * This module provides the other surface: a read-only view of the retained
 * source snapshot, so an administrator can inspect the files and metadata of
 * a submission before it is built.
 *
 * Guarantees:
 * - Nothing is executed. Files are read as bytes and decoded as text; no
 *   package manager, build script or template code is ever invoked.
 * - The snapshot is verified before anything is read, so only content that
 *   still matches its recorded digest can be served.
 * - Paths resolve inside the verified snapshot directory only.
 * - Binary files are described, never rendered.
 * - Host filesystem paths and credentials never appear in a result.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceSnapshotFile, SourceSnapshotRef, SourceSnapshotStore } from "./template-snapshot";

/** Largest file that source inspection will render as text. */
export const SOURCE_INSPECTION_MAX_FILE_BYTES = 256 * 1024;
/** Largest number of files a single listing may report. */
export const SOURCE_INSPECTION_MAX_FILES = 5000;

export interface SourceFileEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  binary: boolean;
}

export interface SourceSnapshotSummary {
  snapshotId: string;
  templateId: string;
  templateVersion: string;
  sourceUrl: string;
  commitSha: string;
  auditOutcome: string;
  createdAt: string;
  sourceDigest: string;
  totalFiles: number;
  totalBytes: number;
  files: SourceFileEntry[];
}

export interface SourceInspectionFailure {
  ok: false;
  code: string;
  message: string;
}

export type SourceInspectionResult =
  | { ok: true; summary: SourceSnapshotSummary; sourceDir: string }
  | SourceInspectionFailure;

export type SourceFileContentResult =
  | {
      ok: true;
      relativePath: string;
      sizeBytes: number;
      sha256: string;
      binary: boolean;
      content: string;
    }
  | SourceInspectionFailure;

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Hashes a file without holding all of it in memory. */
function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * A NUL byte in the first block is the same signal `file(1)` uses: the content
 * is binary and must not be rendered as text.
 */
function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

interface WalkedFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

function walkSourceFiles(root: string): WalkedFile[] {
  const files: WalkedFile[] = [];
  const visit = (current: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(current, entry.name);
      const stat = fs.lstatSync(absolutePath);
      // A verified snapshot contains no symbolic links; anything else is
      // refused rather than followed.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) {
        files.push({
          relativePath: path.relative(root, absolutePath).replace(/\\/g, "/"),
          absolutePath,
          sizeBytes: stat.size,
        });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function verifySnapshot(
  snapshotStore: SourceSnapshotStore,
  ref: SourceSnapshotRef
): Promise<{ ok: true; sourceDir: string; files: SourceSnapshotFile[] } | SourceInspectionFailure> {
  try {
    const verified = await snapshotStore.verify(ref);
    return { ok: true, sourceDir: verified.sourceDir, files: verified.files || [] };
  } catch (error) {
    return {
      ok: false,
      code: "SOURCE_SNAPSHOT_INVALID",
      message: `The retained source snapshot could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Lists the files of a retained source snapshot together with its provenance.
 *
 * The snapshot is verified first, so the listing describes content that still
 * matches the digest recorded when the snapshot was taken.
 */
export async function inspectSourceSnapshot(
  snapshotStore: SourceSnapshotStore,
  ref: SourceSnapshotRef,
  options: { maxFiles?: number } = {}
): Promise<SourceInspectionResult> {
  const verified = await verifySnapshot(snapshotStore, ref);
  if (!verified.ok) return verified;

  let walked: WalkedFile[];
  try {
    walked = walkSourceFiles(verified.sourceDir);
  } catch (error) {
    return {
      ok: false,
      code: "SOURCE_SNAPSHOT_UNREADABLE",
      message: `The retained source snapshot could not be listed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const maxFiles = options.maxFiles ?? SOURCE_INSPECTION_MAX_FILES;
  if (walked.length > maxFiles) {
    return {
      ok: false,
      code: "SOURCE_SNAPSHOT_TOO_LARGE",
      message: `The retained source snapshot holds ${walked.length} files, more than the ${maxFiles} file inspection limit.`,
    };
  }

  const files: SourceFileEntry[] = [];
  let totalBytes = 0;
  for (const file of walked) {
    let binary = false;
    try {
      const head = Buffer.alloc(Math.min(file.sizeBytes, 8192));
      const fd = fs.openSync(file.absolutePath, "r");
      try {
        fs.readSync(fd, head, 0, head.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      binary = looksBinary(head);
    } catch {
      // An unreadable file is still listed by name and size.
    }
    const sha256 = sha256File(file.absolutePath);

    // The listing must describe exactly the snapshot that was verified. A
    // file that appeared or changed since the verification is not part of the
    // retained source and must not be presented as if it were.
    const manifestEntry = verified.files.find((entry) => entry.relativePath === file.relativePath);
    if (!manifestEntry || manifestEntry.sha256 !== sha256) {
      return {
        ok: false,
        code: "SOURCE_SNAPSHOT_INVALID",
        message: `The retained source snapshot changed while it was being inspected ('${file.relativePath}'); it cannot be listed.`,
      };
    }

    files.push({
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      sha256,
      binary,
    });
    totalBytes += file.sizeBytes;
  }

  if (verified.files.length !== files.length) {
    return {
      ok: false,
      code: "SOURCE_SNAPSHOT_INVALID",
      message: "The retained source snapshot changed while it was being inspected; it cannot be listed.",
    };
  }

  return {
    ok: true,
    // The verified directory is returned for internal use only (passive
    // metadata inspection); it is a host path and is never sent to a client.
    sourceDir: verified.sourceDir,
    summary: {
      snapshotId: ref.snapshotId,
      templateId: ref.templateId,
      templateVersion: ref.templateVersion,
      sourceUrl: ref.sourceUrl,
      commitSha: ref.commitSha,
      auditOutcome: ref.auditOutcome,
      createdAt: ref.createdAt,
      sourceDigest: ref.sourceDigest,
      totalFiles: files.length,
      totalBytes,
      files,
    },
  };
}

/**
 * Reads one file of a retained source snapshot as text.
 *
 * The path is resolved inside the verified snapshot directory only; a file
 * that is not part of the snapshot, is not a regular file, or is too large to
 * render is refused with a typed failure rather than partially served.
 */
export async function readSourceSnapshotFile(
  snapshotStore: SourceSnapshotStore,
  ref: SourceSnapshotRef,
  relativePath: string,
  options: { maxBytes?: number } = {}
): Promise<SourceFileContentResult> {
  const verified = await verifySnapshot(snapshotStore, ref);
  if (!verified.ok) return verified;

  const raw = String(relativePath || "").replace(/\\/g, "/").trim();
  if (!raw) {
    return { ok: false, code: "INVALID_PATH", message: "A file path is required." };
  }
  if (
    path.isAbsolute(raw) ||
    /^[a-zA-Z]:[\\/]/.test(raw) ||
    raw.split("/").some((segment) => segment === "..")
  ) {
    return { ok: false, code: "UNSAFE_PATH", message: `Refused source path '${relativePath}'.` };
  }

  const root = path.resolve(verified.sourceDir);
  const absolutePath = path.resolve(root, raw);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    return { ok: false, code: "UNSAFE_PATH", message: `Refused source path '${relativePath}'.` };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    return {
      ok: false,
      code: "FILE_NOT_FOUND",
      message: `'${raw}' is not part of the retained source snapshot.`,
    };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      ok: false,
      code: "NOT_A_FILE",
      message: `'${raw}' is not a regular file in the retained source snapshot.`,
    };
  }

  const maxBytes = options.maxBytes ?? SOURCE_INSPECTION_MAX_FILE_BYTES;
  if (stat.size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `'${raw}' is ${stat.size} bytes, larger than the ${maxBytes} byte inspection limit. Its metadata is still listed.`,
    };
  }

  const buffer = fs.readFileSync(absolutePath);
  const contentSha256 = sha256Buffer(buffer);

  // The snapshot was verified a moment ago, but the file could have changed
  // since. The content that is actually served must still match the digest
  // the snapshot was verified against, otherwise a file swapped in between
  // would be shown to a reviewer as if it were the retained source.
  const manifestEntry = verified.files.find((entry) => entry.relativePath === raw);
  if (!manifestEntry) {
    return {
      ok: false,
      code: "FILE_NOT_FOUND",
      message: `'${raw}' is not part of the retained source snapshot.`,
    };
  }
  if (manifestEntry.sha256 !== contentSha256) {
    return {
      ok: false,
      code: "SOURCE_SNAPSHOT_INVALID",
      message: `'${raw}' no longer matches the digest recorded for the retained source snapshot, so it cannot be inspected.`,
    };
  }

  if (looksBinary(buffer)) {
    return {
      ok: true,
      relativePath: raw,
      sizeBytes: stat.size,
      sha256: contentSha256,
      binary: true,
      content: "",
    };
  }

  return {
    ok: true,
    relativePath: raw,
    sizeBytes: stat.size,
    sha256: contentSha256,
    binary: false,
    content: buffer.toString("utf8"),
  };
}
