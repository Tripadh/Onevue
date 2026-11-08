/* Admin → Template ingestion (Phase 5.15 & Phase 1 Core Integration).
   Submit a GitHub repository URL and manage the full OneVue ingestion lifecycle:
   validate → pin commit → audit → isolated build → immutable storage → review → catalog. */
const { useState: taUseState, useEffect: taUseEffect, useCallback: taUseCallback, useMemo: taUseMemo } = React;

const TA_STAGE_LABELS = {
  VALIDATE_REPOSITORY: "Repository validation",
  PIN_COMMIT: "Immutable commit pin",
  DUPLICATE_CHECK: "Duplicate / update check",
  SOURCE_SNAPSHOT: "Source snapshot",
  AUDIT: "License & security audit",
  BUILD_BOUNDARY: "Build isolation boundary",
  PROVISION: "Private repository provisioning",
  ADAPT_BUILD_STORE: "Adapt · build · package · store",
  CATALOG: "Public catalog registration",
};

const TA_STATUS_TONE = {
  succeeded: "verified",
  in_progress: "warning",
  failed: "danger",
  skipped: "neutral",
};

function taShortSha(sha) {
  return sha ? String(sha).slice(0, 12) : "—";
}

const TA_UNAVAILABLE_STATUSES = new Set([
  "build_failed",
  "provisioning_unavailable",
  "storage_unavailable",
  "audit_rejected",
  "review_required",
  "failed",
  "rejected",
]);

function taStatusTone(status) {
  if (status === "catalog_eligible" || status === "approved") return "verified";
  if (status === "processing" || status === "in_progress" || status === "pending_review") return "warning";
  if (TA_UNAVAILABLE_STATUSES.has(status)) return "danger";
  return "neutral";
}

/**
 * A submission badge has to say something an admin can act on. `build_failed`
 * used to render as a neutral pill, which is how a release that never completed
 * looked indistinguishable from one merely awaiting review.
 */
function taStatusLabel(submission) {
  const status = submission.submissionStatus || "unknown";
  if (submission.catalogEligible) return "student-visible";
  if (submission.reviewStatus === "rejected" || status === "rejected") return "rejected";
  if (submission.reviewStatus === "pending_review") return "awaiting review";
  if (status === "build_failed") return "unavailable · build failed";
  if (status === "provisioning_unavailable") return "unavailable · provisioning failed";
  if (status === "catalog_eligible") return "eligible · not yet published";
  return status.replace(/_/g, " ");
}

function StageList({ stages }) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return <p className="muted" style={{ fontSize: 13, margin: 0 }}>No processing stages recorded yet.</p>;
  }
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {stages.map((stage, index) => (
        <li key={(stage.stage || "stage") + index} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Badge tone={TA_STATUS_TONE[stage.status] || "neutral"} dot>{stage.status || "pending"}</Badge>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{TA_STAGE_LABELS[stage.stage] || stage.stage}</div>
            {stage.detail ? (
              <div className="mono muted" style={{ fontSize: 11.5, wordBreak: "break-word" }}>{String(stage.detail).slice(0, 300)}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function AuditReportView({ report }) {
  if (!report) return null;
  const tone = report.outcome === "PASS" ? "verified" : report.outcome === "REVIEW_REQUIRED" ? "warning" : "danger";
  const allFindings = [
    ...(report.license?.findings || []),
    ...(report.dependencies?.findings || []),
    ...(report.generalFindings || []),
  ];

  return (
    <div style={{ marginTop: 10, padding: 14, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid var(--line)", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Automated License & Security Audit</div>
        <Badge tone={tone} dot>{report.outcome}</Badge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 12 }}>
        <div>
          <span className="muted">SPDX License: </span>
          <span className="mono">{report.license?.detectedSpdx || report.license?.declaredLicense || "None detected"}</span>
        </div>
        <div>
          <span className="muted">Policy: </span>
          <span>{report.license?.isCopyleftRestricted ? "Restricted Copyleft" : report.license?.isPermissive ? "Permissive (Approved)" : "Unverified"}</span>
        </div>
        <div>
          <span className="muted">Dependencies: </span>
          <span>{report.dependencies?.totalDependencies ?? "—"} (Lockfile: {report.dependencies?.lockfilePresent ? "Yes" : "No"})</span>
        </div>
        <div>
          <span className="muted">Hooks: </span>
          <span>{(report.dependencies?.lifecycleScriptsDetected || []).length} lifecycle scripts</span>
        </div>
      </div>

      {allFindings.length > 0 ? (
        <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }} className="muted">Findings ({allFindings.length})</div>
          {allFindings.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, padding: "6px 10px", background: "rgba(0,0,0,0.15)", borderRadius: 8 }}>
              <Badge tone={f.severity === "critical" || f.severity === "high" ? "danger" : "warning"}>{f.severity || "info"}</Badge>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{f.message}</span>
                {f.evidence ? <div className="mono muted" style={{ fontSize: 11 }}>{f.evidence}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>No security or license violations detected.</div>
      )}
    </div>
  );
}

function ReviewDecisionControls({ submission, onReview, submitting }) {
  const [reviewReason, setReviewReason] = taUseState("");
  const [override, setOverride] = taUseState(false);

  if (submission.reviewDecision?.decision === "approve" || submission.reviewStatus === "approved") {
    return (
      <div style={{ marginTop: 10, padding: 12, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Badge tone="verified">Approved</Badge>
        <span>Reviewed and approved{submission.reviewDecision?.reason ? `: "${submission.reviewDecision.reason}"` : "."}</span>
      </div>
    );
  }

  if (submission.reviewDecision?.decision === "reject" || submission.reviewStatus === "rejected") {
    return (
      <div style={{ marginTop: 10, padding: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Badge tone="danger">Rejected</Badge>
        <span>Submission rejected{submission.reviewDecision?.reason ? `: "${submission.reviewDecision.reason}"` : "."}</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, padding: 14, background: "color-mix(in oklab, var(--bg-0) 60%, transparent)", border: "1px solid var(--line)", borderRadius: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Administrative Review Decision</div>
        <Badge tone="warning">Pending Review</Badge>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        Record an administrative review decision to approve or reject this template.
      </p>
      <Input
        label="Reviewer Justification / Notes"
        placeholder="e.g. Verified license provenance and code safety"
        value={reviewReason}
        onChange={(e) => setReviewReason(e.target.value)}
      />
      {submission.auditOutcome === "REVIEW_REQUIRED" && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Explicit Policy Override for REVIEW_REQUIRED audit outcome
        </label>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <Button
          size="sm"
          variant="primary"
          disabled={submitting}
          loading={submitting}
          onClick={() => onReview({ decision: "approve", reason: reviewReason, policyOverride: override })}
        >
          Approve Template
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={submitting}
          loading={submitting}
          onClick={() => onReview({ decision: "reject", reason: reviewReason, policyOverride: override })}
        >
          Reject Template
        </Button>
      </div>
    </div>
  );
}

function taFormatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The retained source of a submission, inspected without executing anything.
 *
 * This is deliberately separate from the artifact preview: the preview renders
 * the built release a student would receive, while this shows what was
 * actually ingested — the surface an administrator needs before a template
 * has been built.
 */
function SourceInspectionPanel({ loading, error, snapshot, selectedPath, fileContent, fileLoading, onSelectFile, onReload }) {
  const files = (snapshot && Array.isArray(snapshot.files)) ? snapshot.files : [];
  const metadata = (snapshot && snapshot.metadata) || null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {snapshot
            ? `${snapshot.totalFiles} file(s) · ${taFormatBytes(snapshot.totalBytes)} · commit ${taShortSha(snapshot.commitSha)}`
            : "No snapshot loaded."}
        </span>
        <Button size="sm" variant="glass" onClick={onReload} loading={loading}>
          Reload Source
        </Button>
      </div>

      <div style={{ fontSize: 12.5, lineHeight: 1.5 }} className="muted">
        A read-only view of the source that was ingested. Files are read as text and never
        executed, so nothing here can run the template's own code.
      </div>

      {error ? (
        <div style={{ border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: 12, fontSize: 12.5 }}>
          {error}
        </div>
      ) : null}

      {metadata ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, fontSize: 12 }}>
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Package manager</div><div className="mono">{metadata.packageManager || "unknown"}</div></div>
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Framework</div><div className="mono">{metadata.detectedFramework || "unknown"}</div></div>
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Manifest</div><div className="mono">{metadata.manifestValid ? "valid" : metadata.manifestExists ? "invalid" : "absent"}</div></div>
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Audit outcome</div><div className="mono">{metadata.auditOutcome || "—"}</div></div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(0, 2fr)", gap: 12, alignItems: "start" }}>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            maxHeight: 420,
            overflow: "auto",
            padding: 8,
            display: "grid",
            gap: 2,
          }}
        >
          {loading && files.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>Loading files…</span> : null}
          {!loading && files.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>No files listed.</span> : null}
          {files.map((file) => (
            <button
              key={file.relativePath}
              type="button"
              onClick={() => onSelectFile(file.relativePath)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
                textAlign: "left",
                border: "1px solid " + (selectedPath === file.relativePath ? "var(--accent)" : "transparent"),
                background: selectedPath === file.relativePath ? "rgba(56,189,248,.12)" : "transparent",
                borderRadius: 8,
                padding: "5px 8px",
                fontSize: 11.5,
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <span className="mono" style={{ wordBreak: "break-all" }}>{file.relativePath}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{taFormatBytes(file.sizeBytes)}</span>
            </button>
          ))}
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 12,
            minHeight: 200,
            maxHeight: 420,
            overflow: "auto",
            background: "rgba(0,0,0,.2)",
          }}
        >
          {!selectedPath ? <span className="muted" style={{ fontSize: 12 }}>Select a file to read it.</span> : null}
          {selectedPath && fileLoading ? <span className="muted" style={{ fontSize: 12 }}>Reading {selectedPath}…</span> : null}
          {selectedPath && !fileLoading && fileContent ? (
            fileContent.binary ? (
              <div style={{ fontSize: 12.5 }}>
                <strong>{selectedPath}</strong>
                <div className="muted" style={{ marginTop: 6 }}>
                  Binary file ({taFormatBytes(fileContent.sizeBytes)}). Its content is not rendered.
                </div>
              </div>
            ) : (
              <pre className="mono" style={{ margin: 0, fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {fileContent.content}
              </pre>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The student-facing catalog, read from the same public endpoint students read.
 * This is the ground truth for "is it exposed", not a status field.
 */
function StudentCatalogPanel({ templates, loading, onRefresh }) {
  const releases = (Array.isArray(templates) ? templates : []).reduce(
    (total, template) => total + ((template.releases || []).length),
    0
  );

  return (
    <GlassCard style={{ padding: 20, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 className="h-card" style={{ fontSize: 18, margin: 0 }}>Student-Facing Catalog</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {loading
              ? "Loading catalog…"
              : `${(Array.isArray(templates) ? templates : []).length} template(s), ${releases} approved release(s) currently selectable by students.`}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} loading={loading}>Refresh</Button>
      </div>

      {loading || !Array.isArray(templates) || templates.length === 0 ? null : (
        <div style={{ display: "grid", gap: 8 }}>
          {templates.map((template) => (
            <div
              key={template.id}
              style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: 12, display: "grid", gap: 6 }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Badge tone="verified" dot>available</Badge>
                <strong style={{ fontSize: 13.5 }}>{template.name || template.id}</strong>
                <span className="mono muted" style={{ fontSize: 12 }}>latest {template.latestVersion}</span>
              </div>
              {(template.releases || []).map((release) => (
                <div key={release.version} className="mono" style={{ fontSize: 12, opacity: 0.85, wordBreak: "break-all" }}>
                  {template.id}@{release.version} · dto [{(release.supportedDtoVersions || []).join(", ")}] ·
                  checksum {release.artifact?.checksum ? `${String(release.artifact.checksum).slice(0, 16)}…` : "not recorded"} ·
                  path {release.artifact?.assetBaseUrl || "—"}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function EvidenceField({ label, children, tone }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div
        className="mono"
        style={{
          fontSize: 12.5,
          wordBreak: "break-all",
          color: tone === "danger" ? "var(--danger, #ef4444)" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The evidence the catalog gate actually requires. Showing it here is what lets
 * an admin tell "built and stored" apart from "bytes happen to exist".
 */
function ProductionEvidencePanel({ submission }) {
  const artifact = submission.artifact || null;
  const adaptation = submission.adaptation || null;
  const lifecycle = submission.lifecycle || null;
  const reviewer = submission.reviewer || null;
  const isMockProvisioning = submission.provisioningIsMock === true ||
    submission.provisioningMode === "mock_local";

  return (
    <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Production evidence</strong>
        <Badge tone={submission.catalogEligible ? "verified" : isMockProvisioning ? "danger" : "muted"}>
          {submission.catalogEligible ? "Student-visible" : "Not student-visible"}
        </Badge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <EvidenceField label="Framework">{submission.framework || adaptation?.framework || "not recorded"}</EvidenceField>
        <EvidenceField label="Package manager">{adaptation?.packageManager || "not recorded"}</EvidenceField>
        <EvidenceField label="Adaptation">{adaptation ? `${adaptation.status} · +${adaptation.createdFileCount ?? "?"} / ~${adaptation.modifiedFileCount ?? "?"} files` : "not recorded"}</EvidenceField>
        <EvidenceField label="Lifecycle">{lifecycle ? `${lifecycle.status}${lifecycle.failedStage ? ` · failed at ${lifecycle.failedStage}` : ""}` : "not recorded"}</EvidenceField>
        <EvidenceField label="Provisioning" tone={isMockProvisioning ? "danger" : undefined}>
          {submission.provisioningMode || "unknown"}{isMockProvisioning ? " (development mock)" : ""}
        </EvidenceField>
        <EvidenceField label="Manifest checksum">{artifact?.manifestSha256 || "not recorded"}</EvidenceField>
        <EvidenceField label="Artifact files">{artifact ? `${artifact.totalFiles ?? "—"}` : "not recorded"}</EvidenceField>
        <EvidenceField label="Artifact size">{artifact ? taFormatBytes(artifact.totalBytes) : "not recorded"}</EvidenceField>
        <EvidenceField label="Entrypoint">{artifact?.entrypoint || "not recorded"}</EvidenceField>
        <EvidenceField label="DTO versions">{artifact?.supportedDtoVersions?.length ? artifact.supportedDtoVersions.join(", ") : "not recorded"}</EvidenceField>
        <EvidenceField label="Release path">{artifact?.artifactPath || "not recorded"}</EvidenceField>
        <EvidenceField label="Artifact commit">{artifact?.sourceCommitSha ? taShortSha(artifact.sourceCommitSha) : "not recorded"}</EvidenceField>
        <EvidenceField label="Approved by">{reviewer ? `${reviewer.name || "—"} · ${reviewer.email || "—"}` : submission.reviewDecision?.reviewerUserId || "not recorded"}</EvidenceField>
        <EvidenceField label="Decision timestamp">{submission.decidedAt ? new Date(submission.decidedAt).toLocaleString() : "—"}</EvidenceField>
      </div>
    </div>
  );
}

/**
 * Why the gate is closed, in the gate's own terms. Without this an admin can
 * only guess, which is exactly how a build-failed release stayed visible.
 */
function CatalogBlockersPanel({ blockers, eligible }) {
  if (eligible) {
    return (
      <div style={{ fontSize: 12.5, color: "rgba(16,185,129,.9)" }}>
        All catalog eligibility conditions are satisfied for this release.
      </div>
    );
  }
  if (!Array.isArray(blockers) || blockers.length === 0) return null;
  return (
    <div style={{ border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.08)", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Withheld from students — {blockers.length} unmet condition(s)</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 4 }}>
        {blockers.map((blocker, index) => (
          <li key={`${blocker.code}-${index}`}>
            <span className="mono" style={{ fontSize: 11.5, opacity: 0.8 }}>{blocker.code}</span>
            {blocker.message ? ` — ${blocker.message}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubmissionSummary({ submission, onReview, onPreview, onInspectSource, submitting }) {
  if (!submission) return null;
  return (
    <GlassCard style={{ padding: 20, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Badge tone={taStatusTone(submission.submissionStatus)} dot>
            {taStatusLabel(submission)}
          </Badge>
          <strong style={{ fontSize: 14 }}>{submission.repositoryKey || submission.sourceUrl}</strong>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {submission.sourceSnapshotId && onInspectSource && (
            <Button size="sm" variant="glass" onClick={() => onInspectSource(submission)}>
              Inspect Source Snapshot
            </Button>
          )}
          {submission.templateId && submission.templateVersion && (
            <Button size="sm" variant="glass" onClick={() => onPreview(submission)}>
              Preview Template Artifact
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Repository</div><div className="mono" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{submission.sourceUrl}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Pinned commit</div><div className="mono" style={{ fontSize: 12.5 }}>{taShortSha(submission.commitSha)}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Template version</div><div className="mono" style={{ fontSize: 12.5 }}>{submission.templateId ? `${submission.templateId}@${submission.templateVersion}` : "—"}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Audit outcome</div><div style={{ fontSize: 12.5 }}>{submission.auditOutcome || "—"}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Current stage</div><div style={{ fontSize: 12.5 }}>{submission.currentStage || "—"}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Source access</div><div style={{ fontSize: 12.5 }}>{submission.sourceAuthMode === "credentialed" ? "server credential" : submission.sourceAuthMode === "public" ? "public" : "—"}</div></div>
        {submission.previousVersion ? (
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Previous version</div><div className="mono" style={{ fontSize: 12.5 }}>{submission.previousVersion}</div></div>
        ) : null}
        {submission.destinationUrl ? (
          <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Private mirror</div><div className="mono" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{submission.destinationUrl}</div></div>
        ) : null}
      </div>

      {submission.error ? (
        <div style={{ border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: 12, fontSize: 12.5 }}>
          {submission.error}
        </div>
      ) : null}

      <ProductionEvidencePanel submission={submission} />
      <CatalogBlockersPanel blockers={submission.catalogBlockers} eligible={submission.catalogEligible} />

      <AuditReportView report={submission.auditReport} />

      <ReviewDecisionControls submission={submission} onReview={onReview} submitting={submitting} />

      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Processing Pipeline Stages</div>
        <StageList stages={submission.stages} />
      </div>
    </GlassCard>
  );
}

function validateTemplateSubmission({ url, policyOverride, reason }) {
  if (!url || !url.trim()) {
    return { ok: false, error: "A GitHub repository URL is required." };
  }
  if (policyOverride && (!reason || !reason.trim())) {
    return { ok: false, error: "An approval justification reason is required when overriding REVIEW_REQUIRED." };
  }
  return { ok: true, error: null };
}

/**
 * Every review decision needs a justification reason — including an approval,
 * which cannot be audited later without one. The check lives here, apart from
 * the component, so the rule is verifiable on its own.
 */
function validateReviewDecision(decisionData) {
  const reason = decisionData && typeof decisionData.reason === "string" ? decisionData.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      reason: "",
      error: "Every review decision needs a justification reason, including an approval.",
    };
  }
  return { ok: true, reason, error: null };
}

/**
 * The request an approval continues with.
 *
 * An approval is only half of the decision: the approved source still has to
 * travel through build, provisioning and catalog registration. The same pinned
 * commit is resubmitted as a retry, so the existing immutable version is
 * reused and no duplicate version is created.
 */
function buildApprovalContinuation(submission, reason) {
  return {
    url: submission.sourceUrl,
    commitSha: submission.commitSha,
    reason,
    policyOverride: true,
    retry: true,
    explicitConfirmation: true,
  };
}

function TemplateSubmissionPage() {
  const toast = useToast();
  const [url, setUrl] = taUseState("");
  const [ref, setRef] = taUseState("");
  const [reason, setReason] = taUseState("");
  const [policyOverride, setPolicyOverride] = taUseState(false);
  const [retry, setRetry] = taUseState(false);
  const [submitting, setSubmitting] = taUseState(false);
  const [error, setError] = taUseState("");
  const [result, setResult] = taUseState(null);
  const [recent, setRecent] = taUseState([]);
  const [loadingRecent, setLoadingRecent] = taUseState(false);
  const [filter, setFilter] = taUseState("all"); // "all" | "eligible" | "review" | "failed"
  const [previewModalSubmission, setPreviewModalSubmission] = taUseState(null);
  const [previewHtml, setPreviewHtml] = taUseState(null);
  const [previewError, setPreviewError] = taUseState(null);
  const [previewLoading, setPreviewLoading] = taUseState(false);
  const [sourceModalSubmission, setSourceModalSubmission] = taUseState(null);
  const [sourceSnapshot, setSourceSnapshot] = taUseState(null);
  const [sourceError, setSourceError] = taUseState(null);
  const [sourceLoading, setSourceLoading] = taUseState(false);
  const [sourceSelectedPath, setSourceSelectedPath] = taUseState(null);
  const [sourceFileContent, setSourceFileContent] = taUseState(null);
  const [sourceFileLoading, setSourceFileLoading] = taUseState(false);
  const [catalog, setCatalog] = taUseState([]);
  const [loadingCatalog, setLoadingCatalog] = taUseState(false);

  const service = window.OV.services.templateAdmin;
  const apiBase = (window.OV_ADMIN_API_BASE || (window.OV_ENV && (window.OV_ENV.API_BASE || window.OV_ENV.API_URL)) || "http://localhost:3000/api").replace(/\/+$/, "");

  const refreshRecent = taUseCallback(async () => {
    if (!service) return;
    setLoadingRecent(true);
    try {
      const data = await service.list(50);
      setRecent(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (err) {
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, [service]);

  taUseEffect(() => { refreshRecent(); }, [refreshRecent]);

  /**
   * The catalog is what students actually see. Listing it beside the ingestion
   * history is the only way an admin can confirm a withheld release really is
   * withheld, instead of trusting a status string.
   */
  const refreshCatalog = taUseCallback(async () => {
    if (!service) return;
    setLoadingCatalog(true);
    try {
      const data = await service.catalog();
      setCatalog(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setCatalog([]);
    } finally {
      setLoadingCatalog(false);
    }
  }, [service]);

  taUseEffect(() => { refreshCatalog(); }, [refreshCatalog]);

  const loadPreview = taUseCallback(async (submission) => {
    if (!service || !submission) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewHtml(null);
    try {
      setPreviewHtml(await service.previewHtml(submission.templateId, submission.templateVersion));
    } catch (err) {
      setPreviewError(err.message || "The preview could not be rendered.");
    } finally {
      setPreviewLoading(false);
    }
  }, [service]);

  taUseEffect(() => {
    if (previewModalSubmission) loadPreview(previewModalSubmission);
  }, [previewModalSubmission, loadPreview]);

  /**
   * The retained source of a submission, read without executing any of it.
   * This is the surface an administrator uses while a template is still
   * awaiting review, when no built artifact exists to preview.
   */
  const loadSourceSnapshot = taUseCallback(async (submission) => {
    if (!service || !submission) return;
    setSourceLoading(true);
    setSourceError(null);
    setSourceSelectedPath(null);
    setSourceFileContent(null);
    try {
      const data = await service.sourceSnapshot(submission.ingestionId);
      const source = data && data.source ? data.source : {};
      setSourceSnapshot({
        ...source,
        metadata: { ...(data && data.metadata ? data.metadata : {}), auditOutcome: source.auditOutcome },
      });
    } catch (err) {
      setSourceSnapshot(null);
      setSourceError(err.message || "The retained source could not be inspected.");
    } finally {
      setSourceLoading(false);
    }
  }, [service]);

  const loadSourceFile = taUseCallback(async (relativePath) => {
    if (!service || !sourceModalSubmission) return;
    setSourceSelectedPath(relativePath);
    setSourceFileLoading(true);
    setSourceFileContent(null);
    try {
      const data = await service.sourceFile(sourceModalSubmission.ingestionId, relativePath);
      setSourceFileContent(data && data.file ? data.file : null);
    } catch (err) {
      setSourceError(err.message || "That file could not be read.");
    } finally {
      setSourceFileLoading(false);
    }
  }, [service, sourceModalSubmission]);

  taUseEffect(() => {
    if (sourceModalSubmission) loadSourceSnapshot(sourceModalSubmission);
  }, [sourceModalSubmission, loadSourceSnapshot]);

  const submit = async (event) => {
    event.preventDefault();
    if (!service) {
      setError("The template administration service is unavailable.");
      return;
    }
    const validation = validateTemplateSubmission({ url, policyOverride, reason });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const payload = await service.submit({
        url: url.trim(),
        ref: ref.trim() || undefined,
        reason: reason.trim() || undefined,
        policyOverride,
        retry,
        explicitConfirmation: true,
      });
      setResult(payload);
      if (payload && payload.success) {
        toast.push({ title: "Template published", body: payload.message, tone: "success" });
      } else {
        toast.push({ title: "Submission processed", body: (payload && payload.message) || "Workflow completed with review or issues.", tone: payload?.outcome === "AUDIT_REJECTED" ? "error" : "info" });
      }
      await refreshRecent();
    } catch (err) {
      setError(err.message || "Template submission failed.");
      if (err.submission) {
        setResult({ success: false, message: err.message, submission: err.submission, outcome: "FAILED" });
      }
      toast.push({ title: "Submission failed", body: err.message || "Template submission failed.", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const submitRetry = async (sourceUrl, repositoryKey) => {
    if (!service) return;
    const validation = validateTemplateSubmission({ url: sourceUrl, policyOverride, reason });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = await service.submit({
        url: sourceUrl,
        reason: reason.trim() || undefined,
        policyOverride,
        retry: true,
        explicitConfirmation: true,
      });
      setResult(payload);
      toast.push({
        title: payload.success ? "Template published" : "Retry finished",
        body: payload.message || (repositoryKey ? repositoryKey : "Retry finished."),
        tone: payload.success ? "success" : "info",
      });
      await refreshRecent();
    } catch (err) {
      setError(err.message || "Retry failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewDecision = async (decisionData) => {
    const currentSubmission = result?.submission;
    if (!service || !currentSubmission?.ingestionId) return;
    const validation = validateReviewDecision(decisionData);
    if (!validation.ok) {
      toast.push({
        title: "Reason required",
        body: validation.error,
        tone: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await service.review({
        ingestionId: currentSubmission.ingestionId,
        decision: decisionData.decision,
        reason: validation.reason,
        policyOverride: decisionData.policyOverride,
      });
      toast.push({
        title: `Review: ${decisionData.decision.toUpperCase()}`,
        body: res.message || "Decision recorded.",
        tone: decisionData.decision === "approve" ? "success" : "info",
      });

      if (decisionData.decision === "approve") {
        let continued = null;
        try {
          continued = await service.submit(
            buildApprovalContinuation(currentSubmission, validation.reason)
          );
          toast.push({
            title: continued && continued.success ? "Template published" : "Approval recorded",
            body: (continued && continued.message) || "The approved source continues through the remaining stages.",
            tone: continued && continued.success ? "success" : "info",
          });
        } catch (err) {
          // The decision itself is already durable. Only the continuation
          // failed, and it can be started again from the submission.
          toast.push({
            title: "Approval recorded",
            body: `The approval was saved, but the remaining stages could not be started: ${err.message || "unknown error"}`,
            tone: "info",
          });
        }
        await openRecent(
          continued && continued.submission && continued.submission.ingestionId
            ? continued.submission.ingestionId
            : currentSubmission.ingestionId
        );
      } else {
        await openRecent(currentSubmission.ingestionId);
      }
      await refreshRecent();
    } catch (err) {
      toast.push({ title: "Review failed", body: err.message || "Could not record decision.", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const openRecent = async (ingestionId) => {
    if (!service) return;
    try {
      const data = await service.get(ingestionId);
      if (data && data.submission) {
        setResult({
          success: data.submission.catalogEligible,
          outcome: data.submission.submissionStatus || "QUERY",
          code: "OK",
          message: `Loaded submission for ${data.submission.repositoryKey || data.submission.sourceUrl}.`,
          submission: data.submission,
        });
      }
    } catch (err) {
      setError(err.message || "Unable to load that submission.");
    }
  };

  const filteredSubmissions = taUseMemo(() => {
    if (filter === "eligible") return recent.filter((s) => s.catalogEligible || s.submissionStatus === "catalog_eligible");
    if (filter === "review") return recent.filter((s) => s.reviewStatus === "pending_review" || s.submissionStatus === "review_required");
    if (filter === "failed") return recent.filter((s) => s.submissionStatus === "failed" || s.submissionStatus === "audit_rejected");
    return recent;
  }, [recent, filter]);

  return (
    <main id="main" className="wrap" style={{ paddingTop: 110, paddingBottom: 80 }}>
      <div style={{ display: "grid", gap: 18, maxWidth: 980, margin: "0 auto" }}>
        <div>
          <Badge tone="neutral" dot>Administrator</Badge>
          <h1 className="h-page" style={{ margin: "10px 0 6px" }}>Template Administration</h1>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Submit and govern the OneVue portfolio template catalog. Ingest GitHub repositories, audit licenses and dependencies, execute container-isolated builds, and record human approval decisions.
          </p>
        </div>

        <GlassCard style={{ padding: 22 }}>
          <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
            <Input
              label="GitHub repository URL"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              hint="Public repositories only, unless the deployment is configured with a GitHub provisioning token."
              required
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <Input label="Branch or tag (optional)" placeholder="main" value={ref} onChange={(e) => setRef(e.target.value)} />
              <Input
                label={policyOverride ? "Approval reason (required for policy override)" : "Approval reason (optional)"}
                placeholder="Reviewed license and provenance"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim() && error && error.includes("justification")) {
                    setError("");
                  }
                }}
                required={policyOverride}
                hint={policyOverride ? "A justification reason is mandatory when overriding a REVIEW_REQUIRED outcome." : undefined}
              />
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={policyOverride}
                onChange={(e) => {
                  setPolicyOverride(e.target.checked);
                  if (!e.target.checked && error && error.includes("justification")) {
                    setError("");
                  }
                }}
              />
              Override a REVIEW_REQUIRED audit outcome (requires a justification reason)
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={retry} onChange={(e) => setRetry(e.target.checked)} />
              Retry previously submitted commit (reuses existing version; never creates duplicate version)
            </label>
            {error ? (
              <div style={{ border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: 12, fontSize: 13, display: "grid", gap: 8 }}>
                <div>{error}</div>
                {!retry && (
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => { setRetry(true); setError(""); }}>
                      Enable Retry Option
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
            <div>
              <Button type="submit" loading={submitting} disabled={submitting}>
                {submitting ? "Processing repository pipeline…" : "Ingest and publish template"}
              </Button>
            </div>
          </form>
        </GlassCard>

        {result ? (
          <section style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 className="h-card" style={{ fontSize: 18, margin: 0 }}>Submission Detail</h2>
                {result.outcome ? <Badge tone={taStatusTone(result.outcome)} dot>{result.outcome}</Badge> : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Clear View</Button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{result.message}</p>
            <SubmissionSummary
              submission={result.submission}
              onReview={handleReviewDecision}
              onPreview={(sub) => setPreviewModalSubmission(sub)}
              onInspectSource={(sub) => setSourceModalSubmission(sub)}
              submitting={submitting}
            />
            {result.submission && result.submission.retryEligible ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={submitting}
                  disabled={submitting}
                  onClick={() =>
                    submitRetry(result.submission.sourceUrl, result.submission.repositoryKey)
                  }
                >
                  Retry this commit (same version, no duplicate)
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        <section style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <h2 className="h-card" style={{ fontSize: 18, margin: 0 }}>Template Ingestion History & Catalog</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button variant="ghost" size="sm" onClick={refreshRecent} loading={loadingRecent}>Refresh</Button>
            </div>
          </div>

          {/* Submissions Filter Pills */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All Submissions" },
              { id: "eligible", label: "Catalog Eligible" },
              { id: "review", label: "Pending Review" },
              { id: "failed", label: "Failed / Rejected" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  background: filter === tab.id ? "var(--accent)" : "rgba(255,255,255,0.04)",
                  color: filter === tab.id ? "#fff" : "var(--text-2)",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredSubmissions.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {loadingRecent ? "Loading submissions…" : "No submissions found for selected filter."}
            </p>
          ) : (
            <GlassCard style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "grid" }}>
                {filteredSubmissions.map((entry) => (
                  <button
                    key={entry.ingestionId}
                    type="button"
                    onClick={() => openRecent(entry.ingestionId)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      padding: "12px 16px",
                      background: result?.submission?.ingestionId === entry.ingestionId ? "rgba(255,255,255,0.06)" : "transparent",
                      border: 0,
                      borderBottom: "1px solid var(--line)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.repositoryKey || entry.sourceUrl}</div>
                      <div className="mono muted" style={{ fontSize: 11.5 }}>
                        {taShortSha(entry.commitSha)} · {entry.templateId ? `${entry.templateId}@${entry.templateVersion}` : "no version"} · Stage: {entry.currentStage || "INIT"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Badge tone={taStatusTone(entry.submissionStatus)} dot>{entry.submissionStatus || "unknown"}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </GlassCard>
          )}
        </section>
      </div>

      {/* Admin Template Artifact Preview Modal */}
      {previewModalSubmission && (
        <Modal
          open={Boolean(previewModalSubmission)}
          onClose={() => setPreviewModalSubmission(null)}
          title={`Artifact Preview: ${previewModalSubmission.templateId}@${previewModalSubmission.templateVersion}`}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="mono muted" style={{ fontSize: 12 }}>
                Release: {previewModalSubmission.templateId}@{previewModalSubmission.templateVersion}
                {" · "}
                {previewModalSubmission.catalogEligible ? "student-visible" : "withheld from students"}
              </span>
              <Button size="sm" variant="glass" onClick={() => loadPreview(previewModalSubmission)} loading={previewLoading}>
                Reload Preview
              </Button>
            </div>

            <div style={{ fontSize: 12.5, lineHeight: 1.5 }} className="muted">
              Rendered through the OneVue delivery and DTO injection contract using representative
              sample data. This is a read-only preview: it does not publish, approve or otherwise
              change the release, and it is not any student's profile.
            </div>

            {previewError ? (
              <div style={{ border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: 12, fontSize: 12.5 }}>
                {previewError}
              </div>
            ) : null}

            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid var(--line)",
                height: 520,
                background: "#090d16",
                display: "grid",
                placeItems: previewHtml ? "stretch" : "center",
                color: "rgba(255,255,255,.6)",
                fontSize: 13,
              }}
            >
              {previewLoading && !previewHtml ? <span>Loading preview…</span> : null}
              {!previewLoading && !previewHtml && !previewError ? <span>No preview available.</span> : null}
              {previewHtml ? (
                <iframe
                  title="Template Preview"
                  srcDoc={previewHtml}
                  style={{ width: "100%", height: "100%", border: 0 }}
                  // Untrusted template code must not reach the admin session.
                  // Without allow-same-origin the document gets an opaque
                  // origin, so parent localStorage and cookies are unavailable
                  // while scripts, styles and fonts still load.
                  sandbox="allow-scripts"
                />
              ) : null}
            </div>
          </div>
        </Modal>
      )}

      {/* Admin Retained Source Inspection Modal */}
      {sourceModalSubmission && (
        <Modal
          open={Boolean(sourceModalSubmission)}
          onClose={() => setSourceModalSubmission(null)}
          title={`Source Snapshot: ${sourceModalSubmission.repositoryKey || sourceModalSubmission.sourceUrl}`}
        >
          <SourceInspectionPanel
            loading={sourceLoading}
            error={sourceError}
            snapshot={sourceSnapshot}
            selectedPath={sourceSelectedPath}
            fileContent={sourceFileContent}
            fileLoading={sourceFileLoading}
            onSelectFile={loadSourceFile}
            onReload={() => loadSourceSnapshot(sourceModalSubmission)}
          />
        </Modal>
      )}

      <StudentCatalogPanel templates={catalog} loading={loadingCatalog} onRefresh={refreshCatalog} />
    </main>
  );
}

TemplateSubmissionPage.validateSubmission = validateTemplateSubmission;
if (typeof window !== "undefined") {
  window.TemplateSubmissionPage = TemplateSubmissionPage;
  window.validateTemplateSubmission = validateTemplateSubmission;
  window.validateReviewDecision = validateReviewDecision;
  window.buildApprovalContinuation = buildApprovalContinuation;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TemplateSubmissionPage,
    validateTemplateSubmission,
    validateReviewDecision,
    buildApprovalContinuation,
  };
}
