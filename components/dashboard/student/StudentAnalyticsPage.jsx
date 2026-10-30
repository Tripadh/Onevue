/* Owner analytics for published portfolios and visiting cards. */
const { useState: anUseState, useEffect: anUseEffect, useMemo: anUseMemo } = React;
const { useSearchParams: anUseSearchParams } = ReactRouterDOM;

function StudentAnalyticsPage() {
  const [searchParams, setSearchParams] = anUseSearchParams();
  const [overview, setOverview] = anUseState(null);
  const [resources, setResources] = anUseState([]);
  const [events, setEvents] = anUseState(null);
  const [status, setStatus] = anUseState('loading');
  const [error, setError] = anUseState('');

  const browserZone = anUseMemo(function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (err) { return 'UTC'; }
  }, []);

  const filters = {
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
    timezone: searchParams.get('timezone') || browserZone,
    compare: searchParams.get('compare') !== 'false',
    type: searchParams.get('type') || 'all',
    resource: searchParams.get('resource') || '',
    page: Number(searchParams.get('page') || 1),
  };

  function updateFilters(patch) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(function (entry) {
      const key = entry[0];
      const value = entry[1];
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next);
  }

  anUseEffect(function () {
    let alive = true;
    setStatus('loading');
    const query = {
      timezone: filters.timezone,
      compare: filters.compare ? 'true' : 'false',
      type: filters.type,
      resourceId: filters.resource || undefined,
    };
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
    Promise.all([
      window.OV.services.analytics.getOverview(query),
      window.OV.services.analytics.getResources(query),
    ]).then(function (results) {
      if (!alive) return;
      setOverview(results[0]);
      setResources((results[1] && results[1].resources) || []);
      setStatus('ready');
    }).catch(function (err) {
      if (!alive) return;
      setError(err.message || 'Analytics could not be loaded.');
      setStatus(err.status === 401 || err.status === 403 ? 'denied' : 'error');
    });
    return function () { alive = false; };
  }, [filters.from, filters.to, filters.timezone, filters.compare, filters.type, filters.resource]);

  anUseEffect(function () {
    if (!filters.resource) { setEvents(null); return undefined; }
    let alive = true;
    window.OV.services.analytics.getEvents(filters.resource, {
      timezone: filters.timezone,
      from: filters.from || undefined,
      to: filters.to || undefined,
      compare: filters.compare ? 'true' : 'false',
      page: filters.page,
      pageSize: 8,
    }).then(function (data) { if (alive) setEvents(data); }).catch(function () { if (alive) setEvents(null); });
    return function () { alive = false; };
  }, [filters.resource, filters.from, filters.to, filters.timezone, filters.compare, filters.page]);

  const totals = overview && overview.totals;
  const empty = totals && totals.pageViews === 0 && totals.linkClicks === 0 && totals.downloads === 0 && totals.engagementEvents === 0;

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div>
        <span className="eyebrow">Owner analytics</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Analytics</h1>
        <p className="muted" style={{ margin: 0 }}>Visits, estimated visitors, and engagement for resources you own.</p>
      </div>

      <div className="glass" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 14, alignItems: 'end' }}>
        {[7, 30, 90].map(function (days) {
          return <button key={days} className="btn" type="button" onClick={function () { updateFilters({ from: shiftDays(-(days - 1)), to: calendarDay(0), page: 1 }); }}>{days} days</button>;
        })}
        <label className="muted">From <input type="date" value={filters.from} onChange={function (event) { updateFilters({ from: event.target.value, page: 1 }); }} /></label>
        <label className="muted">To <input type="date" value={filters.to} onChange={function (event) { updateFilters({ to: event.target.value, page: 1 }); }} /></label>
        <label className="muted"><input type="checkbox" checked={filters.compare} onChange={function (event) { updateFilters({ compare: event.target.checked ? 'true' : 'false' }); }} /> Compare previous period</label>
        <label className="muted">Type
          <select value={filters.type} onChange={function (event) { updateFilters({ type: event.target.value, resource: '', page: 1 }); }}>
            <option value="all">All</option>
            <option value="portfolio">Portfolio</option>
            <option value="visiting_card">Visiting card</option>
          </select>
        </label>
        <label className="muted">Resource
          <select value={filters.resource} onChange={function (event) { updateFilters({ resource: event.target.value, page: 1 }); }}>
            <option value="">All owned resources</option>
            {resources.map(function (resource) { return <option key={resource.resourceId} value={resource.resourceId}>{resource.displayName}</option>; })}
          </select>
        </label>
        <button className="btn" type="button" disabled={!filters.resource} onClick={function () { window.OV.services.analytics.exportReport(filters.resource, { from: filters.from, to: filters.to, timezone: filters.timezone, compare: filters.compare ? 'true' : 'false' }); }}>Export CSV</button>
      </div>

      {status === 'loading' && <div className="glass" style={{ padding: 24 }}><p className="muted">Loading analytics</p></div>}
      {status === 'denied' && <div className="glass" style={{ padding: 24 }}><p>You do not have access to these analytics.</p></div>}
      {status === 'error' && <div className="glass" style={{ padding: 24 }}><p>{error}</p><button className="btn" type="button" onClick={function () { updateFilters({ page: filters.page }); }}>Retry</button></div>}
      {status === 'ready' && empty && <EmptyState title="No analytics events" body="Published visits will appear here after someone opens your portfolio or visiting card." />}
      {status === 'ready' && totals && !empty && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Metric label="Page views" value={totals.pageViews} change={totals.changes && totals.changes.pageViews} hint={overview.definitions && overview.definitions.pageViews} />
            <Metric label="Estimated visitors" value={totals.visitors} change={totals.changes && totals.changes.visitors} hint={overview.definitions && overview.definitions.visitors} />
            <Metric label="Sessions" value={totals.sessions} change={totals.changes && totals.changes.sessions} hint={overview.definitions && overview.definitions.sessions} />
            <Metric label="Link clicks" value={totals.linkClicks} change={totals.changes && totals.changes.linkClicks} />
            <Metric label="Downloads" value={totals.downloads} change={totals.changes && totals.changes.downloads} />
            <Metric label="Engagement rate" value={formatPercent(totals.engagementRate)} change={totals.changes && totals.changes.engagementRate} />
            <Metric label="Avg engagement" value={formatDuration(totals.averageEngagementSeconds)} change={totals.changes && totals.changes.averageEngagementSeconds} />
          </div>
          <TrafficChart points={(overview.timeseries && overview.timeseries.points) || []} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <BreakdownList title="Devices" rows={overview.audience && overview.audience.devices} />
            <BreakdownList title="Browsers" rows={overview.audience && overview.audience.browsers} />
            <BreakdownList title="Referrers" rows={overview.sources && overview.sources.referrers} />
          </div>
          <ResourceTable resources={resources} onSelect={function (id) { updateFilters({ resource: id, page: 1 }); }} />
          <CampaignTable campaigns={(overview.sources && overview.sources.campaigns) || []} />
          {events && <ActivityTable events={events.events || []} page={events.page} total={events.total} pageSize={events.pageSize} onPage={function (page) { updateFilters({ page: page }); }} />}
        </div>
      )}
    </div>
  );
}

function calendarDay(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = function (type) { return (parts.find(function (part) { return part.type === type; }) || {}).value || ''; };
  return read('year') + '-' + read('month') + '-' + read('day');
}

function shiftDays(offset) { return calendarDay(offset); }

function formatPercent(value) { return value == null ? '—' : Math.round(value * 1000) / 10 + '%'; }
function formatDuration(value) { return value == null ? '—' : value + 's'; }
function formatChange(value) { return value == null ? 'No prior data' : (value > 0 ? '+' : '') + Math.round(value * 1000) / 10 + '%'; }

function Metric(props) {
  return (
    <div className="glass" style={{ padding: 14 }} title={props.hint || ''}>
      <div className="faint" style={{ fontSize: 12 }}>{props.label}</div>
      <div style={{ fontSize: 26, fontWeight: 650 }}>{props.value}</div>
      <div className="muted" style={{ fontSize: 12 }}>{formatChange(props.change)}</div>
    </div>
  );
}

function TrafficChart(props) {
  const points = props.points || [];
  const width = 640;
  const height = 180;
  const max = Math.max(1, ...points.map(function (point) { return Math.max(point.pageViews || 0, point.previousPageViews || 0); }));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const line = function (key) {
    return points.map(function (point, index) {
      const x = index * step;
      const y = height - ((point[key] || 0) / max) * (height - 16) - 8;
      return x + ',' + y;
    }).join(' ');
  };
  return (
    <div className="glass" style={{ padding: 14 }}>
      <svg role="img" viewBox={'0 0 ' + width + ' ' + height} width="100%" height="180" aria-label="Page views over time">
        <title>Page views over time</title>
        <polyline fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" points={line('previousPageViews')} />
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={line('pageViews')} />
      </svg>
    </div>
  );
}

function BreakdownList(props) {
  const rows = props.rows || [];
  return (
    <div className="glass" style={{ padding: 14 }}>
      <strong>{props.title}</strong>
      {rows.length === 0 && <p className="muted">No data in this range.</p>}
      {rows.map(function (row) { return <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}><span>{row.label}</span><span>{row.count}</span></div>; })}
    </div>
  );
}

function ResourceTable(props) {
  return (
    <div className="glass" style={{ padding: 14, overflowX: 'auto' }}>
      <strong>Resources</strong>
      <table style={{ width: '100%', marginTop: 8 }}>
        <tbody>
          {(props.resources || []).map(function (resource) {
            return (
              <tr key={resource.resourceId}>
                <td><button className="btn" type="button" onClick={function () { props.onSelect(resource.resourceId); }}>{resource.displayName}</button></td>
                <td>{resource.resourceType}</td>
                <td>{resource.pageViews} views</td>
                <td>{resource.publicationStatus}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable(props) {
  const rows = props.campaigns || [];
  if (!rows.length) return null;
  return (
    <div className="glass" style={{ padding: 14 }}>
      <strong>Campaigns</strong>
      {rows.map(function (row) {
        return <div key={row.source + row.medium + row.campaign + row.resourceId}>{row.source} / {row.medium} / {row.campaign}: {row.visits} visits, {row.conversions} conversions</div>;
      })}
    </div>
  );
}

function ActivityTable(props) {
  const pages = Math.max(1, Math.ceil((props.total || 0) / (props.pageSize || 8)));
  return (
    <div className="glass" style={{ padding: 14 }}>
      <strong>Recent activity</strong>
      {(props.events || []).map(function (event) {
        return <div key={event.eventId}>{event.occurredAt} · {event.eventType} · {event.path}</div>;
      })}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn" type="button" disabled={props.page <= 1} onClick={function () { props.onPage(props.page - 1); }}>Previous</button>
        <span className="muted">Page {props.page} of {pages}</span>
        <button className="btn" type="button" disabled={props.page >= pages} onClick={function () { props.onPage(props.page + 1); }}>Next</button>
      </div>
    </div>
  );
}
