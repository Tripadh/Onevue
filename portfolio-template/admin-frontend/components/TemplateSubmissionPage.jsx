/* Admin → Template ingestion (Phase 5.15).
   Submit a GitHub repository URL and watch the OneVue ingestion workflow:
   validate → pin commit → audit → isolated build → immutable storage → catalog. */
const { useState: taUseState, useEffect: taUseEffect, useCallback: taUseCallback } = React;

const TA_STAGE_LABELS = {
  VALIDATE_REPOSITORY: 'Repository validation',
  PIN_COMMIT: 'Immutable commit pin',
  DUPLICATE_CHECK: 'Duplicate / update check',
  SOURCE_SNAPSHOT: 'Source snapshot',
  AUDIT: 'License & security audit',
  BUILD_BOUNDARY: 'Build isolation boundary',
  PROVISION: 'Private repository provisioning',
  ADAPT_BUILD_STORE: 'Adapt · build · package · store',
  CATALOG: 'Public catalog registration',
};

const TA_STATUS_TONE = {
  succeeded: 'verified',
  in_progress: 'warning',
  failed: 'danger',
  skipped: 'neutral',
};

function taShortSha(sha) {
  return sha ? String(sha).slice(0, 12) : '—';
}

function taStatusTone(status) {
  if (status === 'catalog_eligible') return 'verified';
  if (status === 'processing' || status === 'in_progress') return 'warning';
  if (status === 'audit_rejected' || status === 'review_required' || status === 'failed') return 'danger';
  return 'neutral';
}

function StageList({ stages }) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return <p className="muted" style={{ fontSize: 13, margin: 0 }}>No processing stages recorded yet.</p>;
  }
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {stages.map((stage, index) => (
        <li key={(stage.stage || 'stage') + index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Badge tone={TA_STATUS_TONE[stage.status] || 'neutral'} dot>{stage.status || 'pending'}</Badge>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{TA_STAGE_LABELS[stage.stage] || stage.stage}</div>
            {stage.detail ? (
              <div className="mono muted" style={{ fontSize: 11.5, wordBreak: 'break-word' }}>{String(stage.detail).slice(0, 240)}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function SubmissionSummary({ submission }) {
  if (!submission) return null;
  return (
    <GlassCard style={{ padding: 20, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={taStatusTone(submission.submissionStatus)} dot>
          {submission.submissionStatus || 'unknown'}
        </Badge>
        <strong style={{ fontSize: 14 }}>{submission.repositoryKey || submission.sourceUrl}</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Repository</div><div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{submission.sourceUrl}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Pinned commit</div><div className="mono" style={{ fontSize: 12.5 }}>{taShortSha(submission.commitSha)}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Template version</div><div className="mono" style={{ fontSize: 12.5 }}>{submission.templateId ? `${submission.templateId}@${submission.templateVersion}` : '—'}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Audit outcome</div><div style={{ fontSize: 12.5 }}>{submission.auditOutcome || '—'}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Current stage</div><div style={{ fontSize: 12.5 }}>{submission.currentStage || '—'}</div></div>
        <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Source access</div><div style={{ fontSize: 12.5 }}>{submission.sourceAuthMode === 'credentialed' ? 'server credential' : submission.sourceAuthMode === 'public' ? 'public' : '—'}</div></div>
        {submission.previousVersion ? (
          <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Previous version</div><div className="mono" style={{ fontSize: 12.5 }}>{submission.previousVersion}</div></div>
        ) : null}
        {submission.destinationUrl ? (
          <div><div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Private mirror</div><div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{submission.destinationUrl}</div></div>
        ) : null}
      </div>
      {submission.error ? (
        <div style={{ border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', borderRadius: 10, padding: 12, fontSize: 12.5 }}>
          {submission.error}
        </div>
      ) : null}
      <StageList stages={submission.stages} />
    </GlassCard>
  );
}

function TemplateSubmissionPage() {
  const toast = useToast();
  const [url, setUrl] = taUseState('');
  const [ref, setRef] = taUseState('');
  const [reason, setReason] = taUseState('');
  const [policyOverride, setPolicyOverride] = taUseState(false);
  const [submitting, setSubmitting] = taUseState(false);
  const [error, setError] = taUseState('');
  const [result, setResult] = taUseState(null);
  const [recent, setRecent] = taUseState([]);
  const [loadingRecent, setLoadingRecent] = taUseState(false);

  const service = window.OV.services.templateAdmin;

  const refreshRecent = taUseCallback(async () => {
    if (!service) return;
    setLoadingRecent(true);
    try {
      const data = await service.list(20);
      setRecent(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (err) {
      // A catalogue read failure must not hide the submission form.
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, [service]);

  taUseEffect(() => { refreshRecent(); }, [refreshRecent]);

  const submit = async (event) => {
    event.preventDefault();
    if (!service) {
      setError('The template administration service is unavailable.');
      return;
    }
    if (!url.trim()) {
      setError('A GitHub repository URL is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const payload = await service.submit({
        url: url.trim(),
        ref: ref.trim() || undefined,
        reason: reason.trim() || undefined,
        policyOverride,
        explicitConfirmation: true,
      });
      setResult(payload);
      if (payload && payload.success) {
        toast.push({ title: 'Template published', body: payload.message, tone: 'success' });
      } else {
        toast.push({ title: 'Submission not published', body: (payload && payload.message) || 'The workflow did not complete.', tone: 'error' });
      }
      await refreshRecent();
    } catch (err) {
      setError(err.message || 'Template submission failed.');
      toast.push({ title: 'Submission failed', body: err.message || 'Template submission failed.', tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitRetry = async (sourceUrl, repositoryKey) => {
    if (!service) return;
    setSubmitting(true);
    setError('');
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
        title: payload.success ? 'Template published' : 'Retry not published',
        body: payload.message || (repositoryKey ? repositoryKey : 'Retry finished.'),
        tone: payload.success ? 'success' : 'error',
      });
      await refreshRecent();
    } catch (err) {
      setError(err.message || 'Retry failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const openRecent = async (ingestionId) => {
    if (!service) return;
    try {
      const data = await service.get(ingestionId);
      if (data && data.submission) setResult({ success: data.submission.catalogEligible, outcome: 'QUERY', code: 'OK', message: 'Loaded submission status.', submission: data.submission });
    } catch (err) {
      setError(err.message || 'Unable to load that submission.');
    }
  };

  return (
    <main id="main" className="wrap" style={{ paddingTop: 110, paddingBottom: 80 }}>
      <div style={{ display: 'grid', gap: 18, maxWidth: 980, margin: '0 auto' }}>
        <div>
          <Badge tone="neutral" dot>Administrator</Badge>
          <h1 className="h-page" style={{ margin: '10px 0 6px' }}>Template ingestion</h1>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Submit a GitHub repository URL. OneVue pins an immutable commit, snapshots the source, runs the
            license/security audit, builds inside the approved isolation boundary, stores an immutable artifact and
            registers the approved version in the public catalog.
          </p>
        </div>

        <GlassCard style={{ padding: 22 }}>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <Input
              label="GitHub repository URL"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              hint="Public repositories only, unless the deployment is configured with GitHub credentials."
              required
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <Input label="Branch or tag (optional)" placeholder="main" value={ref} onChange={(e) => setRef(e.target.value)} />
              <Input label="Approval reason (optional)" placeholder="Reviewed license and provenance" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={policyOverride} onChange={(e) => setPolicyOverride(e.target.checked)} />
              Override a REVIEW_REQUIRED audit outcome (requires a reason)
            </label>
            {error ? (
              <div style={{ border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', borderRadius: 10, padding: 12, fontSize: 13 }}>
                {error}
              </div>
            ) : null}
            <div>
              <Button type="submit" loading={submitting} disabled={submitting}>
                {submitting ? 'Processing repository…' : 'Ingest and publish template'}
              </Button>
            </div>
          </form>
        </GlassCard>

        {result ? (
          <section style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 className="h-card" style={{ fontSize: 18, margin: 0 }}>Submission status</h2>
              {result.outcome ? <Badge tone={result.success ? 'verified' : 'danger'} dot>{result.outcome}</Badge> : null}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{result.message}</p>
            <SubmissionSummary submission={result.submission} />
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

        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="h-card" style={{ fontSize: 18, margin: 0 }}>Recent submissions</h2>
            <Button variant="ghost" size="sm" onClick={refreshRecent} loading={loadingRecent}>Refresh</Button>
          </div>
          {recent.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {loadingRecent ? 'Loading submissions…' : 'No submissions recorded yet.'}
            </p>
          ) : (
            <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'grid' }}>
                {recent.map((entry) => (
                  <button
                    key={entry.ingestionId}
                    type="button"
                    onClick={() => openRecent(entry.ingestionId)}
                    style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '12px 16px', background: 'transparent', border: 0, borderBottom: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.repositoryKey || entry.sourceUrl}</div>
                      <div className="mono muted" style={{ fontSize: 11.5 }}>
                        {taShortSha(entry.commitSha)} · {entry.templateId ? `${entry.templateId}@${entry.templateVersion}` : 'no version'}
                      </div>
                    </div>
                    <Badge tone={taStatusTone(entry.submissionStatus)} dot>{entry.submissionStatus || 'unknown'}</Badge>
                  </button>
                ))}
              </div>
            </GlassCard>
          )}
        </section>
      </div>
    </main>
  );
}

window.TemplateSubmissionPage = TemplateSubmissionPage;
