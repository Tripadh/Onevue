import * as fs from "node:fs";
import * as path from "node:path";
import { LifecycleRecord } from "./template-lifecycle";

export interface ReconciliationCandidate {
  path: string;
  kind: "INCOMPLETE_SNAPSHOT" | "ORPHAN_ARTIFACT";
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationOptions {
  snapshotRoot?: string;
  artifactRoot?: string;
  lifecycleRecords: LifecycleRecord[];
  publishedArtifacts?: Array<{ templateId: string; templateVersion: string }>;
  dryRun?: boolean;
}

export interface ReconciliationReport {
  dryRun: boolean;
  candidates: ReconciliationCandidate[];
  removed: string[];
}

function within(root: string, candidate: string): boolean {
  return path.resolve(candidate).startsWith(path.resolve(root) + path.sep);
}

export function reconcileLocalArtifacts(options: ReconciliationOptions): ReconciliationReport {
  const dryRun = options.dryRun !== false;
  const candidates: ReconciliationCandidate[] = [];
  const removed: string[] = [];
  const catalogRefs = new Set(options.lifecycleRecords.filter((record) => record.status === "CATALOG_ELIGIBLE").map((record) => `${record.templateId}@${record.templateVersion}`));
  const publishedRefs = new Set((options.publishedArtifacts || []).map((ref) => `${ref.templateId}@${ref.templateVersion}`));

  if (options.snapshotRoot) {
    const snapshotsRoot = path.resolve(options.snapshotRoot, "snapshots");
    if (fs.existsSync(snapshotsRoot)) {
      for (const snapshotId of fs.readdirSync(snapshotsRoot)) {
        const snapshotDir = path.join(snapshotsRoot, snapshotId);
        if (!fs.statSync(snapshotDir).isDirectory()) continue;
        const metadataPath = path.join(snapshotDir, "snapshot.json");
        const sourceDir = path.join(snapshotDir, "source");
        if (!fs.existsSync(metadataPath) || !fs.existsSync(sourceDir)) {
          candidates.push({ path: snapshotDir, kind: "INCOMPLETE_SNAPSHOT", reason: "Snapshot metadata or source directory is incomplete." });
        }
      }
    }
  }

  if (options.artifactRoot) {
    const templatesRoot = path.resolve(options.artifactRoot, "templates");
    if (fs.existsSync(templatesRoot)) {
      for (const templateId of fs.readdirSync(templatesRoot)) {
        const templateDir = path.join(templatesRoot, templateId);
        if (!fs.statSync(templateDir).isDirectory()) continue;
        for (const version of fs.readdirSync(templateDir)) {
          const artifactDir = path.join(templateDir, version);
          if (!fs.statSync(artifactDir).isDirectory()) continue;
          const key = `${templateId}@${version}`;
          if (catalogRefs.has(key) || publishedRefs.has(key)) continue;
          const manifestPath = path.join(artifactDir, "onevue-manifest.json");
          if (!fs.existsSync(manifestPath)) {
            candidates.push({ path: artifactDir, kind: "ORPHAN_ARTIFACT", reason: "Artifact has no release manifest." });
            continue;
          }
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (manifest.templateId !== templateId || manifest.templateVersion !== version || !manifest.manifestSha256) {
              candidates.push({ path: artifactDir, kind: "ORPHAN_ARTIFACT", reason: "Artifact manifest is inconsistent with its immutable path." });
            }
          } catch {
            candidates.push({ path: artifactDir, kind: "ORPHAN_ARTIFACT", reason: "Artifact manifest is malformed." });
          }
        }
      }
    }
  }

  if (!dryRun) {
    for (const candidate of candidates) {
      const root = candidate.kind === "INCOMPLETE_SNAPSHOT" ? options.snapshotRoot : options.artifactRoot;
      if (!root || !within(root, candidate.path)) continue;
      fs.rmSync(candidate.path, { recursive: true, force: true });
      removed.push(candidate.path);
    }
  }

  return { dryRun, candidates, removed };
}
