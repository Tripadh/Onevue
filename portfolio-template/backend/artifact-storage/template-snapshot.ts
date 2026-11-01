import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const COMMIT_SHA_REGEX = /^[a-f0-9]{40}$/i;
const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

export interface SourceSnapshotFile {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface SourceSnapshotRef {
  snapshotId: string;
  relativePath: string;
  templateId: string;
  templateVersion: string;
  sourceUrl: string;
  commitSha: string;
  auditOutcome: string;
  sourceDigest: string;
  snapshotDigest: string;
  createdAt: string;
}

export interface SourceSnapshotCreateInput {
  snapshotId: string;
  sourceDir: string;
  templateId: string;
  templateVersion: string;
  sourceUrl: string;
  commitSha: string;
  auditOutcome: string;
}

export interface VerifiedSourceSnapshot {
  ref: SourceSnapshotRef;
  sourceDir: string;
}

export interface SourceSnapshotStore {
  create(input: SourceSnapshotCreateInput): Promise<SourceSnapshotRef>;
  verify(ref: SourceSnapshotRef): Promise<VerifiedSourceSnapshot>;
  remove(ref: SourceSnapshotRef): Promise<void>;
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function digestMetadata(metadata: Omit<SourceSnapshotRef, "snapshotDigest"> & { files: SourceSnapshotFile[] }): string {
  return crypto.createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}

function walkFiles(root: string): SourceSnapshotFile[] {
  const files: SourceSnapshotFile[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error(`Snapshot source contains an unsupported entry: '${relativePath}'.`);
      }
      if (stat.isDirectory()) visit(fullPath);
      else files.push({ relativePath, sizeBytes: stat.size, sha256: sha256File(fullPath) });
    }
  };
  visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export class FileSystemSourceSnapshotStore implements SourceSnapshotStore {
  private root: string;
  private maxFiles: number;
  private maxBytes: number;

  constructor(root: string, options: { maxFiles?: number; maxBytes?: number } = {}) {
    if (!root || !path.isAbsolute(root)) throw new Error("A configured absolute source snapshot root is required.");
    this.root = path.resolve(root);
    this.maxFiles = options.maxFiles || 2500;
    this.maxBytes = options.maxBytes || 100 * 1024 * 1024;
    fs.mkdirSync(this.root, { recursive: true });
  }

  private snapshotDir(snapshotId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(snapshotId)) throw new Error("Invalid source snapshot ID.");
    return path.resolve(this.root, "snapshots", snapshotId);
  }

  async create(input: SourceSnapshotCreateInput): Promise<SourceSnapshotRef> {
    if (!fs.existsSync(input.sourceDir) || !fs.statSync(input.sourceDir).isDirectory()) throw new Error("Source snapshot input directory is missing.");
    if (!TEMPLATE_ID_REGEX.test(input.templateId) || !SEMVER_REGEX.test(input.templateVersion)) throw new Error("Invalid source snapshot template identity.");
    if (!COMMIT_SHA_REGEX.test(input.commitSha)) throw new Error("Invalid source snapshot commit SHA.");
    if (!input.sourceUrl || !input.auditOutcome) throw new Error("Source snapshot provenance is incomplete.");

    const finalDir = this.snapshotDir(input.snapshotId);
    if (fs.existsSync(finalDir)) throw new Error("Source snapshot already exists and is immutable.");
    const stagingDir = fs.mkdtempSync(path.join(this.root, ".snapshot-staging-"));
    try {
      const sourceRoot = path.resolve(input.sourceDir);
      const copy = (current: string, destination: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const sourcePath = path.join(current, entry.name);
          const targetPath = path.join(destination, entry.name);
          const stat = fs.lstatSync(sourcePath);
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Snapshot source contains an unsupported entry: '${path.relative(sourceRoot, sourcePath)}'.`);
          if (stat.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            copy(sourcePath, targetPath);
          } else {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
          }
        }
      };
      copy(sourceRoot, path.join(stagingDir, "source"));
      const files = walkFiles(path.join(stagingDir, "source"));
      const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
      if (files.length > this.maxFiles || totalBytes > this.maxBytes) throw new Error("Source snapshot exceeds configured resource limits.");
      const sourceDigest = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
      const metadata = {
        snapshotId: input.snapshotId,
        relativePath: `snapshots/${input.snapshotId}/source`,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        sourceUrl: input.sourceUrl,
        commitSha: input.commitSha.toLowerCase(),
        auditOutcome: input.auditOutcome,
        sourceDigest,
        createdAt: new Date().toISOString(),
        files,
      };
      const { files: _files, ...refMetadata } = metadata;
      const ref: SourceSnapshotRef = { ...refMetadata, snapshotDigest: digestMetadata(metadata) };
      fs.writeFileSync(path.join(stagingDir, "snapshot.json"), JSON.stringify({ ...ref, files }, null, 2), "utf8");
      fs.mkdirSync(path.dirname(finalDir), { recursive: true });
      fs.renameSync(stagingDir, finalDir);
      return ref;
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async verify(ref: SourceSnapshotRef): Promise<VerifiedSourceSnapshot> {
    if (!ref || typeof ref.snapshotId !== "string") throw new Error("Source snapshot reference is malformed.");
    const finalDir = this.snapshotDir(ref.snapshotId);
    const metadataPath = path.join(finalDir, "snapshot.json");
    const sourceDir = path.join(finalDir, "source");
    if (!fs.existsSync(metadataPath) || !fs.existsSync(sourceDir)) throw new Error("Source snapshot is missing or incomplete.");
    const stored = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as SourceSnapshotRef & { files: SourceSnapshotFile[] };
    const { files, ...storedRef } = stored;
    const { snapshotDigest: _storedDigest, ...storedMetadata } = storedRef;

    // Compare every provenance field explicitly. Persistence layers (for example
    // MongoDB) may reorder object keys, so serialized-key-order equality would
    // reject a valid snapshot after a storage round trip.
    const provenanceMatches =
      storedRef.snapshotId === ref.snapshotId &&
      storedRef.relativePath === ref.relativePath &&
      storedRef.templateId === ref.templateId &&
      storedRef.templateVersion === ref.templateVersion &&
      storedRef.sourceUrl === ref.sourceUrl &&
      String(storedRef.commitSha).toLowerCase() === String(ref.commitSha).toLowerCase() &&
      storedRef.auditOutcome === ref.auditOutcome &&
      storedRef.sourceDigest === ref.sourceDigest &&
      storedRef.createdAt === ref.createdAt &&
      storedRef.snapshotDigest === ref.snapshotDigest;

    if (!provenanceMatches || digestMetadata({ ...storedMetadata, files }) !== ref.snapshotDigest) {
      throw new Error("Source snapshot provenance or digest does not match the approved reference.");
    }
    const actualFiles = walkFiles(sourceDir);
    if (JSON.stringify(actualFiles) !== JSON.stringify(files)) throw new Error("Source snapshot content digest does not match its stored manifest.");
    return { ref, sourceDir };
  }

  async remove(ref: SourceSnapshotRef): Promise<void> {
    fs.rmSync(this.snapshotDir(ref.snapshotId), { recursive: true, force: true });
  }
}
