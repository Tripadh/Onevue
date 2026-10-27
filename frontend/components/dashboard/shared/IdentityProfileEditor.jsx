/* Tabbed identity editor. Same interaction pattern as the Student Identity page:
   section tabs, card lists, add/edit modals, and a save that persists one section. */

const { useEffect: idUseEffect, useReducer: idUseReducer, useRef: idUseRef, useState: idUseState } = React;

const IDENTITY_PLACEHOLDERS = {
  headline: "e.g. Staff engineer focused on hiring platforms",
  bio: "Summarize the background and focus you want this identity to show.",
  specialization: "e.g. Brand identity and product design",
  niche: "e.g. Independent technology journalism",
  businessName: "e.g. Northwind Studio",
  industry: "e.g. Industrial design",
  description: "What this business, product, or service does.",
  mission: "The outcome the business exists to create.",
  website: "https://",
  jobTitle: "e.g. Product designer",
  company: "e.g. Northwind",
  location: "City, Country",
  responsibilities: "One responsibility per line",
  achievements: "One measurable result per line",
  institution: "e.g. Rhode Island School of Design",
  degree: "e.g. BFA Graphic Design",
  fieldOfStudy: "e.g. Communication design",
  title: "e.g. Rebrand for a regional museum",
  issuer: "e.g. Nielsen Norman Group",
  credentialUrl: "https://",
  credentialId: "Credential identifier",
  url: "https://",
  role: "e.g. Design lead",
  fileName: "resume.pdf",
  targetRole: "e.g. Senior product designer",
  storageKey: "private/resume/account/resume.pdf",
  email: "name@company.com",
  phone: "+1 555 0100",
  city: "e.g. Austin",
  country: "e.g. United States",
  linkedin: "https://www.linkedin.com/in/",
  name: "Name",
  summary: "What this piece of work covers.",
  outcome: "e.g. Launched in six weeks",
  quote: "What the client said.",
  authorName: "Client name",
  relationship: "e.g. Client, 2024",
  platform: "e.g. YouTube",
  handle: "@name",
  category: "e.g. Interviews",
  technologies: "Figma\nPostgreSQL",
  contentCategories: "Product design\nFounder interviews",
  contentFormats: "video\narticle",
  kitUrl: "https://",
  preferences: "The kinds of collaborations you want.",
  brandSafetyNotes: "Topics or categories you do not take.",
  notes: "What a partner should know about this rate.",
  partnershipEmail: "partners@studio.com",
  logoUrl: "https://",
  primaryColor: "#1B4DFF",
  guidelinesUrl: "https://",
  legalName: "Registered legal name",
  registrationNumber: "Private registration number",
  jurisdiction: "e.g. Delaware",
  documentStorageKey: "private/registration/document.pdf",
  addressLine: "Street address, kept private",
  state: "e.g. Texas",
  timezone: "e.g. America/Chicago",
  operatingHours: "e.g. Weekdays 9:00–17:00",
  currency: "USD",
  displayName: "Name visitors should see",
  tagline: "A short line under the business name",
  foundedYear: "2014",
  targetCustomers: "Independent studios\nProduct teams",
  engagementTypes: "fixed_price\nhourly",
  features: "Two design concepts\nSource files",
  price: "1200",
  thumbnailUrl: "https://",
  imageUrl: "https://",
  evidenceUrl: "https://",
  organization: "e.g. Northwind",
  label: "e.g. Portfolio",
  revisionCount: "2",
};

const IDENTITY_HINTS = {
  storageKey: "Private reference only. This value is not a public file URL.",
  documentStorageKey: "Private reference only. Registration documents are not published.",
  registrationNumber: "Stored on the private profile. Public pages do not receive this value.",
  addressLine: "Street address stays on the private profile.",
  primaryColor: "Hex color, for example #1B4DFF.",
  contentFormats: "One per line: video, article, podcast, newsletter, short_form, livestream, or other.",
  technologies: "One tool or technology per line.",
  contentCategories: "One category per line.",
  responsibilities: "One responsibility per line.",
  achievements: "One result per line. These belong to this role.",
  value: "A figure you are supplying. OneVue does not look this number up.",
  rateMin: "Leave blank to keep the previously saved minimum.",
  rateMax: "Leave blank to keep the previously saved maximum.",
  yearsExperience: "Whole years. Leave blank to keep the previously saved number.",
  deliveryDays: "Whole days. Leave blank to keep the previously saved timeline.",
  engagementTypes: "One per line: fixed_price, hourly, contract, retainer, or long_term. This is separate from availability.",
  foundedYear: "A four-digit year, not later than this year. Leave blank to leave it unpublished.",
  price: "Leave blank when the price is quoted on request. A number requires a currency.",
  thumbnailUrl: "Public http or https address. Upload a file in the asset field when this record has one.",
  imageUrl: "Public http or https address. Upload a file in the asset field when this record has one.",
  assetId: "Upload a file you own, or choose one already uploaded. Removing the reference does not delete the stored file.",
  evidenceUrl: "Public http or https address.",
  displayName: "Used on this creator identity. It does not change the account name.",
  tagline: "Separate from the mission. Leave blank if you do not want one.",
  targetCustomers: "One customer type per line.",
  features: "One deliverable per line.",
  revisionCount: "Whole number. Leave blank to keep the previously saved count.",
};

function identityTabKey(identity) {
  return "ov_" + identity + "_identity_tab";
}

function readStoredTab(identity, sections) {
  let saved = "";
  try {
    saved = localStorage.getItem(identityTabKey(identity)) || "";
  } catch (error) {
    saved = "";
  }
  if (sections.some((section) => section.id === saved)) return saved;
  return sections[0] ? sections[0].id : "";
}

function displayValue(value) {
  if (value === true) return "Yes";
  if (value === false || value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value).replace(/_/g, " ");
}

function fieldOptionLabel(field, value) {
  if (!field || !field.options) return displayValue(value);
  const match = field.options.find((option) => option.value === value);
  return match ? match.label : displayValue(value);
}

function resumeUpdatedLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch (error) {
    return "";
  }
}

function safeHttpUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function editorDraftApi() {
  return window.OV && window.OV.editorDraft;
}

function profilesMatch(left, right) {
  if (!left || !right) return false;
  const keys = Object.keys(left);
  for (let index = 0; index < keys.length; index += 1) {
    if (JSON.stringify(left[keys[index]]) !== JSON.stringify(right[keys[index]])) return false;
  }
  return true;
}

function assetPurposeForSection(section) {
  const key = section && (section.collection || section.object || section.id);
  const purposes = {
    certifications: "certificate",
    credentials: "certificate",
    portfolio: "portfolio-image",
    achievements: "evidence",
    resume: "resume",
    workSamples: "portfolio-media",
    featuredContent: "portfolio-image",
    mediaKit: "portfolio-media",
    branding: "portfolio-image",
    products: "portfolio-image",
    caseStudies: "portfolio-image",
    registration: "evidence",
    projects: "portfolio-image",
    media: "portfolio-media",
  };
  return purposes[key] || "";
}

function IdentityProfileEditor({ identity, session, onSaved }) {
  const logic = window.OV.identityProfileState;
  const toast = useToast();
  const spec = logic.FORM_SPECS[identity];
  const sectionUi = (logic.SECTION_UI && logic.SECTION_UI[identity]) || {};
  const sections = (spec && spec.sections) || [];
  const [state, dispatch] = idUseReducer(logic.profileEditorReducer, null, logic.createProfileEditorState);
  const [activeSection, setActiveSection] = idUseState(() => readStoredTab(identity, sections));
  const [modal, setModal] = idUseState(null);
  const [modalError, setModalError] = idUseState("");
  const [restoredDraft, setRestoredDraft] = idUseState(false);
  const [staleDraft, setStaleDraft] = idUseState(false);
  const [siteStatus, setSiteStatus] = idUseState("");
  const savingRef = idUseRef(false);
  const loadSeq = idUseRef(0);
  const draftReady = idUseRef(false);
  const draftBase = idUseRef("");

  function load() {
    const seq = ++loadSeq.current;
    dispatch({ type: "load_start" });
    const service = window.OV.services.domainProfile;
    if (!service || !service.getIdentityProfile) {
      dispatch({ type: "load_error", message: "Profile service is unavailable." });
      return;
    }
    service.getIdentityProfile(identity).then((data) => {
      if (seq !== loadSeq.current) return;
      if (!data || !data.profile) {
        dispatch({ type: "load_error", message: "The server did not return a profile." });
        return;
      }
      const drafts = editorDraftApi();
      const record = drafts ? drafts.readDraft(sessionStorage, "identity-" + identity, session) : null;
      const decision = drafts
        ? drafts.decideDraftRestore(record, data.profile)
        : { action: "use-server", baseUpdatedAt: "", stale: false };
      draftBase.current = decision.baseUpdatedAt || "";
      draftReady.current = true;
      dispatch({ type: "load_success", profile: data.profile });
      if (decision.action === "restore-local" && !profilesMatch(decision.draft, data.profile)) {
        dispatch({ type: "edit", draft: decision.draft });
        setRestoredDraft(true);
        setStaleDraft(false);
      } else {
        setRestoredDraft(false);
        setStaleDraft(!!decision.stale);
        if (decision.stale && drafts) drafts.clearDraft(sessionStorage, "identity-" + identity, session);
      }
    }).catch((error) => {
      if (seq !== loadSeq.current) return;
      dispatch({ type: "load_error", message: error.message || "Could not load profile." });
    });
  }

  idUseEffect(() => {
    draftReady.current = false;
    setActiveSection(readStoredTab(identity, sections));
    setModal(null);
    setModalError("");
    load();
    return () => {
      loadSeq.current += 1;
    };
  }, [identity]);

  idUseEffect(() => {
    const drafts = editorDraftApi();
    if (!draftReady.current || !state.draft || !drafts) return;
    drafts.writeDraft(sessionStorage, "identity-" + identity, session, state.draft, draftBase.current);
  }, [state.draft, identity]);

  idUseEffect(() => {
    const token = (session && session.token) || (window.OV && window.OV.core && window.OV.core.db && window.OV.core.db.get("session") && window.OV.core.db.get("session").token);
    if (!token) return undefined;
    const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || "http://localhost:3000/api";
    let cancelled = false;
    fetch(String(apiBase).replace(/\/$/, "") + "/student/website/config", {
      headers: { Authorization: "Bearer " + token },
    }).then((response) => response.json()).then((data) => {
      if (cancelled) return;
      setSiteStatus(data && data.config && data.config.status ? data.config.status : "draft");
    }).catch(() => {
      if (!cancelled) setSiteStatus("");
    });
    return () => { cancelled = true; };
  }, [identity]);

  function selectSection(sectionId) {
    setActiveSection(sectionId);
    try {
      localStorage.setItem(identityTabKey(identity), sectionId);
    } catch (error) {
      /* Tab memory is optional. The profile itself is stored by the API. */
    }
  }

  async function persist(section, source, successBody) {
    if (savingRef.current || !source) return;
    savingRef.current = true;
    dispatch({ type: "save_start" });
    try {
      const payload = logic.buildSectionPayload(identity, section.id, source);
      const data = await window.OV.services.domainProfile.updateIdentityProfile(identity, payload);
      if (!data || !data.profile) {
        throw new Error("The server did not confirm the saved profile.");
      }
      const keys = Object.keys(payload);
      const drafts = editorDraftApi();
      draftBase.current = drafts ? drafts.stampOf(data.profile) : draftBase.current;
      setStaleDraft(false);
      dispatch({ type: "section_save_success", profile: data.profile, keys });
      toast.push({
        title: successBody && successBody.indexOf("removed") !== -1 ? "Record removed" : "Profile saved",
        body: successBody || "Changes are stored in your account.",
        tone: successBody && successBody.indexOf("removed") !== -1 ? "info" : "success",
      });
      if (typeof onSaved === "function") onSaved(data.profile);
      return true;
    } catch (error) {
      const message = error.message || "Save failed.";
      dispatch({ type: "save_error", message });
      toast.push({ title: "Profile was not saved", body: message, tone: "error" });
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  function editDraft(draft) {
    dispatch({ type: "edit", draft });
  }

  function readValue(field, source) {
    const value = logic.getField(source, field.key);
    if (field.type === "lines") return Array.isArray(value) ? value.join("\n") : "";
    if (field.type === "checkbox") return !!value;
    if (field.type === "date" && typeof value === "string" && value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    if (value === undefined || value === null) return "";
    return value;
  }

  function writeValue(field, raw) {
    if (field.type === "lines") {
      return String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    if (field.type === "checkbox") return !!raw;
    if (field.type === "number") {
      if (raw === "") return undefined;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    }
    return raw;
  }

  function onScalarChange(field, raw) {
    editDraft(logic.setField(state.draft, field.key, writeValue(field, raw)));
  }

  function onObjectChange(objectKey, field, raw) {
    const nextObject = logic.setField(state.draft[objectKey] || {}, field.key, writeValue(field, raw));
    editDraft(Object.assign({}, state.draft, { [objectKey]: nextObject }));
  }

  function onModalChange(field, raw) {
    if (!modal) return;
    const next = logic.setField(modal.record, field.key, writeValue(field, raw));
    setModal(Object.assign({}, modal, { record: next }));
    setModalError("");
  }

  function onNestedChange(nested, recordId, field, raw) {
    if (!modal) return;
    const list = (modal.record[nested.key] || []).map((item) => {
      if (item.id !== recordId) return item;
      return logic.setField(item, field.key, writeValue(field, raw));
    });
    setModal(Object.assign({}, modal, { record: Object.assign({}, modal.record, { [nested.key]: list }) }));
    setModalError("");
  }

  function addNested(nested) {
    if (!modal) return;
    const list = modal.record[nested.key] || [];
    if (list.length >= (nested.maxItems || 8)) {
      setModalError(nested.title + " cannot exceed " + (nested.maxItems || 8) + " records.");
      return;
    }
    const created = nested.blank();
    created.id = logic.newRecordId();
    setModal(Object.assign({}, modal, { record: Object.assign({}, modal.record, { [nested.key]: list.concat(created) }) }));
    setModalError("");
  }

  function removeNested(nested, recordId) {
    if (!modal) return;
    const list = (modal.record[nested.key] || []).filter((item) => item.id !== recordId);
    setModal(Object.assign({}, modal, { record: Object.assign({}, modal.record, { [nested.key]: list }) }));
    setModalError("");
  }

  function renderControl(field, value, onChange, disabled, section) {
    const sectionId = section && section.id;
    const required = logic.isFieldRequired(identity, sectionId, field.key);
    const label = required ? field.label + " *" : field.label;
    const hint = IDENTITY_HINTS[field.key];
    const placeholder = IDENTITY_PLACEHOLDERS[field.key] || "";
    if ((field.key === "status" || field.key === "verificationStatus") && (value === "verified" || value === "rejected")) {
      return <p className="muted" style={{ margin: 0 }}>Status: {value}. OneVue controls this value.</p>;
    }
    if (field.type === "lines") {
      return (
        <label className="field">
          <span className="field-label">{label}</span>
          <textarea
            className="input"
            rows={4}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {hint ? <span className="field-hint">{hint}</span> : null}
        </label>
      );
    }
    if (field.type === "textarea") {
      return <EditorRichText label={label} hint={hint} value={value} disabled={disabled} placeholder={placeholder} onChange={onChange} />;
    }
    if (field.type === "select") {
      return <EditorChoice label={label} hint={hint} options={field.options} value={value} disabled={disabled} onChange={onChange} />;
    }
    if (field.type === "radio") {
      return <EditorRadio label={label} hint={hint} options={field.options} value={value} disabled={disabled} onChange={onChange} />;
    }
    if (field.type === "multiselect") {
      return <EditorMultiSelect label={label} hint={hint} options={field.options} value={value} disabled={disabled} onChange={onChange} />;
    }
    if (field.type === "checkbox") {
      return <Toggle label={label} checked={!!value} disabled={disabled} onChange={onChange} />;
    }
    if (field.key === "assetId") {
      const purpose = assetPurposeForSection(section);
      if (purpose && window.EditorAssetField) {
        return <EditorAssetField label={label} hint={hint} purpose={purpose} value={value} disabled={disabled} onChange={onChange} />;
      }
      return <EditorMediaReference label={label} hint={hint} value={value} disabled={disabled} onChange={onChange} />;
    }
    if (field.type === "url") {
      return <EditorLink label={label} hint={hint} value={value} disabled={disabled} placeholder={placeholder} onChange={onChange} />;
    }
    const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text";
    return (
      <EditorText
        label={label}
        hint={hint}
        type={inputType}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  function openAdd(section) {
    const ui = sectionUi[section.id] || {};
    const current = (state.draft && state.draft[section.collection]) || [];
    if (ui.maxItems && current.length >= ui.maxItems) {
      toast.push({ title: "Limit reached", body: "This section already has the maximum number of records.", tone: "error" });
      return;
    }
    const record = section.blank();
    record.id = logic.newRecordId();
    setModalError("");
    setModal({ sectionId: section.id, mode: "add", record });
  }

  function openEdit(section, record) {
    setModalError("");
    setModal({ sectionId: section.id, mode: "edit", record: JSON.parse(JSON.stringify(record)) });
  }

  async function saveModal(event) {
    if (event) event.preventDefault();
    if (!modal || !state.draft) return;
    const section = sections.find((item) => item.id === modal.sectionId);
    if (!section) return;
    const message = logic.validateRecord(identity, section.id, modal.record);
    if (message) {
      setModalError(message);
      toast.push({ title: "Validation error", body: message, tone: "error" });
      return;
    }
    const list = logic.upsertById(state.draft[section.collection] || [], modal.record);
    const saved = await persist(
      section,
      Object.assign({}, state.draft, { [section.collection]: list }),
      section.title + " is stored in your account."
    );
    if (saved) setModal(null);
  }

  async function moveRecord(section, index, direction) {
    if (!state.draft) return;
    const list = state.draft[section.collection] || [];
    const reorder = window.OV && window.OV.createCustomize && window.OV.createCustomize.reorderEntries;
    const next = reorder ? reorder(list, index, direction) : list;
    if (!next || next.length !== list.length || next.every((item, itemIndex) => item === list[itemIndex])) return;
    await persist(
      section,
      Object.assign({}, state.draft, { [section.collection]: next }),
      "The saved order was updated."
    );
  }

  async function removeRecord(section, id) {
    if (!state.draft) return;
    const list = logic.removeById(state.draft[section.collection] || [], id);
    await persist(
      section,
      Object.assign({}, state.draft, { [section.collection]: list }),
      "The record was removed from your profile."
    );
  }

  async function saveActiveSection(event) {
    if (event) event.preventDefault();
    const section = sections.find((item) => item.id === activeSection);
    if (!section || section.collection || !state.draft) return;
    const source = section.object ? (state.draft[section.object] || {}) : state.draft;
    const message = logic.validateRecord(identity, section.id, source);
    if (message) {
      dispatch({ type: "save_error", message });
      toast.push({ title: "Validation error", body: message, tone: "error" });
      return;
    }
    await persist(section, state.draft, section.title + " is stored in your account.");
  }

  if (!spec) {
    return <p className="muted">This identity does not have an editable profile form.</p>;
  }

  if (state.loading && !state.draft) {
    return <section className="glass" style={{ padding: 24, borderRadius: 20 }}><p className="muted" style={{ margin: 0 }}>Loading your profile…</p></section>;
  }

  if (state.error && !state.draft) {
    return (
      <section className="glass" style={{ padding: 24, borderRadius: 20, display: "grid", gap: 12 }}>
        <p style={{ margin: 0 }}>{state.error}</p>
        <Button type="button" variant="glass" onClick={load}>Try again</Button>
      </section>
    );
  }

  const disabled = state.saving;
  const draft = state.draft || {};
  const current = sections.find((section) => section.id === activeSection) || sections[0];
  const ui = (current && sectionUi[current.id]) || {};
  const accountName = session && session.user && session.user.name ? session.user.name : "";
  const modalSection = modal ? sections.find((section) => section.id === modal.sectionId) : null;
  const modalUi = modalSection ? (sectionUi[modalSection.id] || {}) : {};

  function cardTitle(section, record) {
    const meta = sectionUi[section.id] || {};
    const raw = meta.cardTitle ? record[meta.cardTitle] : "";
    const text = displayValue(raw);
    return text || "Untitled " + (meta.singular || "record");
  }

  function cardMeta(section, record) {
    const meta = sectionUi[section.id] || {};
    return (meta.cardMeta || []).map((key) => {
      if (key === "isPublic") return record.isPublic ? "Public" : "Private";
      if (key === "isCurrent") return record.isCurrent ? "Current role" : "";
      const field = section.fields.find((item) => item.key === key);
      const text = fieldOptionLabel(field, record[key]);
      if (!text) return "";
      if (key === "yearsExperience") return text + " years";
      if (key === "deliveryDays") return text + " days";
      if (key === "rateMin" || key === "rateMax") return key === "rateMin" ? "From " + text : "Up to " + text;
      return text;
    }).filter(Boolean);
  }

  const unsaved = state.profile && state.draft && !profilesMatch(state.draft, state.profile);
  const catalog = window.OV && window.OV.createCustomize;
  const template = catalog && catalog.getTemplate("magicui-portfolio");
  const retainedIds = (template && template.retainedSections) || [];
  const retainedKey = current && current.id === "registration" ? "registration" : current && current.id === "audience" ? "audienceStats" : "";
  const retainedNote = retainedKey && retainedIds.indexOf(retainedKey) !== -1
    ? "This stays on your profile. Magic UI Portfolio does not show it on the public page."
    : "";
  const websiteHref = "/app/" + identity + "/website";

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section className="glass" style={{ padding: "14px 16px", borderRadius: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <strong style={{ fontSize: 14 }}>{siteStatus === "published" ? "Published website" : "Draft website"}</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Profile edits stay in this browser until you save a section. Saving does not publish. {unsaved ? "Unsaved edits are stored for this account only." : "Saved sections are ready to preview."}
            {staleDraft ? " The saved profile changed on the server, so older browser edits were not applied." : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {unsaved ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              if (!state.profile) return;
              const drafts = editorDraftApi();
              if (drafts) drafts.clearDraft(sessionStorage, "identity-" + identity, session);
              draftBase.current = drafts ? drafts.stampOf(state.profile) : "";
              dispatch({ type: "edit", draft: JSON.parse(JSON.stringify(state.profile)) });
              setRestoredDraft(false);
              setStaleDraft(false);
            }}>Discard unsaved edits</Button>
          ) : null}
          <a href={websiteHref}>Open website</a>
        </div>
      </section>
      {restoredDraft ? <p role="status" style={{ margin: 0 }}>Unsaved edits from this browser were restored.</p> : null}
      {retainedNote ? <p className="muted" style={{ margin: 0 }}>{retainedNote}</p> : null}
      <div
        className="glass"
        role="tablist"
        aria-label="Identity sections"
        style={{ padding: 6, borderRadius: 16, display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}
      >
        {sections.map((section, index) => {
          const selected = current && current.id === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className="tab"
              onClick={() => selectSection(section.id)}
              style={{
                borderRadius: 12,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: selected ? 600 : 500,
                color: selected ? "var(--text-1)" : "var(--text-2)",
                background: selected ? "color-mix(in oklab, var(--primary) 22%, var(--glass))" : "transparent",
                border: selected ? "1px solid color-mix(in oklab, var(--primary) 40%, transparent)" : "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {(index + 1) + ". " + section.title}
            </button>
          );
        })}
      </div>

      {current && current.collection ? (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: "grid", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>{current.title}</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: "4px 0 0" }}>{ui.description || current.note || ""}</p>
            </div>
            <Button type="button" size="sm" variant="primary" icon={<Icon.plus />} onClick={() => openAdd(current)} disabled={disabled}>
              {ui.addLabel || "Add"}
            </Button>
          </div>
          {current.note ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{current.note}</p> : null}
          {state.saveError ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{state.saveError}</p> : null}
          {(draft[current.collection] || []).length === 0 ? (
            <EmptyState
              title={ui.emptyTitle || ("No " + current.title.toLowerCase() + " yet")}
              body={ui.emptyBody || "Add a record to store it with your profile."}
              action={<Button type="button" size="sm" variant="primary" icon={<Icon.plus />} onClick={() => openAdd(current)} disabled={disabled}>{ui.addLabel || "Add"}</Button>}
            />
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {(draft[current.collection] || []).map((record, index, records) => {
                const href = safeHttpUrl(record.url || record.credentialUrl || record.kitUrl);
                const body = ui.cardBody ? displayValue(record[ui.cardBody]) : "";
                return (
                  <div key={record.id} className="glass" style={{ padding: 20, borderRadius: 16, border: "1px solid var(--line)", display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: 18, margin: 0 }}>{cardTitle(current, record)}</h3>
                          {current.collection === "testimonials" ? (
                            <span className="badge" style={{ fontSize: 11 }}>{record.attribution === "verified" ? "Verified testimonial" : "Self-reported"}</span>
                          ) : null}
                          {current.collection === "audienceStats" ? (
                            <span className="badge" style={{ fontSize: 11 }}>{record.verificationStatus === "verified" ? "Verified audience record" : "Self-reported"}</span>
                          ) : null}
                          {current.collection === "certifications" && record.verificationStatus ? (
                            <span className="badge" style={{ fontSize: 11 }}>{record.verificationStatus === "verified" ? "Verified" : "Self-reported"}</span>
                          ) : null}
                          {current.collection === "credentials" ? (
                            <span className="badge" style={{ fontSize: 11 }}>{record.verificationStatus === "verified" ? "Verified" : "Self-reported"}</span>
                          ) : null}
                        </div>
                        {cardMeta(current, record).length > 0 ? (
                          <p className="muted" style={{ fontSize: 14, margin: "4px 0 0" }}>{cardMeta(current, record).join(" · ")}</p>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveRecord(current, index, -1)} disabled={disabled || index === 0}>
                          Up
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveRecord(current, index, 1)} disabled={disabled || index === records.length - 1}>
                          Down
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(current, record)} disabled={disabled}>
                          {window.StudentIcons ? <window.StudentIcons.edit /> : null} Edit
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeRecord(current, record.id)} disabled={disabled} style={{ color: "#ef4444" }}>
                          {window.StudentIcons ? <window.StudentIcons.trash /> : null} Delete
                        </Button>
                      </div>
                    </div>
                    {body ? <p style={{ fontSize: 13.5, margin: 0, whiteSpace: "pre-wrap", color: "var(--text-2)" }}>{body}</p> : null}
                    {current.collection === "services" && Array.isArray(record.packages) && record.packages.length > 0 ? (
                      <p className="muted" style={{ fontSize: 13, margin: 0 }}>{record.packages.length + (record.packages.length === 1 ? " package" : " packages")}</p>
                    ) : null}
                    {current.collection === "audienceStats" ? (
                      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Self-reported figure. OneVue does not verify this number from the platform.</p>
                    ) : null}
                    {href ? <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{href}</a> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : current ? (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: "grid", gap: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>{current.title}</h2>
              <p className="muted" style={{ fontSize: 14, margin: "4px 0 0" }}>{ui.description || current.note || ""}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge tone="verified">Connected to Database</Badge>
              <Button type="button" variant="primary" size="sm" loading={state.saving} disabled={disabled} onClick={saveActiveSection}>
                {ui.saveLabel || "Save"}
              </Button>
            </div>
          </div>
          {current.note ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{current.note}</p> : null}
          {state.saveError ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{state.saveError}</p> : null}
          {state.notice === "saved" ? <p role="status" style={{ margin: 0 }}>Saved.</p> : null}
          <form onSubmit={saveActiveSection} style={{ display: "grid", gap: 16, maxWidth: 720 }}>
            {current.id === "about" && accountName ? (
              <Input label="Account name" value={accountName} disabled hint="Managed by account authentication." />
            ) : null}
            {current.id === "resume" ? (
              <Input
                label="Storage reference updated"
                value={resumeUpdatedLabel(draft.resume && draft.resume.uploadedAt)}
                disabled
                readOnly
                hint="OneVue records this when the private storage reference is saved."
              />
            ) : null}
            {(current.object ? current.fields : current.fields).map((field) => (
              <div key={field.key}>
                {current.object
                  ? renderControl(field, readValue(field, draft[current.object] || {}), (raw) => onObjectChange(current.object, field, raw), disabled, current)
                  : renderControl(field, readValue(field, draft), (raw) => onScalarChange(field, raw), disabled, current)}
              </div>
            ))}
            <Button type="submit" variant="primary" loading={state.saving} disabled={disabled || !state.draft} style={{ justifySelf: "start" }}>
              {ui.saveLabel || "Save profile"}
            </Button>
          </form>
        </section>
      ) : null}

      <CustomFieldBoard
        identity={identity}
        sectionId={current && current.id}
        layout={draft.customLayout}
        records={current && current.collection ? (draft[current.collection] || []).map((record) => ({
          id: record.id,
          title: cardTitle(current, record),
        })) : []}
        disabled={disabled}
        templateId="magicui-portfolio"
        onChange={(next) => editDraft(Object.assign({}, draft, { customLayout: next }))}
        onSave={(next) => persist(
          current,
          Object.assign({}, state.draft, { customLayout: next }),
          "Custom fields are stored in your account."
        )}
      />
      <CustomSectionManager
        layout={draft.customLayout}
        disabled={disabled}
        templateId="magicui-portfolio"
        onChange={(next) => editDraft(Object.assign({}, draft, { customLayout: next }))}
        onSave={(next) => persist(
          current,
          Object.assign({}, state.draft, { customLayout: next }),
          "Custom sections are stored in your account."
        )}
      />

      <Modal
        open={!!modalSection}
        onClose={() => { if (!state.saving) { setModal(null); setModalError(""); } }}
        title={modalSection ? ((modal && modal.mode === "edit" ? "Edit " : "Add ") + (modalUi.singular || modalSection.title)) : "Record"}
      >
        {modalSection ? (
          <form onSubmit={saveModal} style={{ display: "grid", gap: 14 }}>
            <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
              {(modal.mode === "edit" ? "Edit " : "Add ") + (modalUi.singular || modalSection.title)}
            </h3>
            {modalError ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{modalError}</p> : null}
            {modalSection.fields.map((field) => (
              <div key={field.key}>
                {renderControl(field, readValue(field, modal.record), (raw) => onModalChange(field, raw), disabled, modalSection)}
              </div>
            ))}
            {modalSection.nested ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <h4 style={{ margin: "8px 0 4px", fontSize: 16 }}>{modalSection.nested.title}</h4>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>{modalSection.nested.note}</p>
                </div>
                {(modal.record[modalSection.nested.key] || []).map((pkg, packageIndex) => (
                  <div key={pkg.id || packageIndex} className="glass" style={{ padding: 14, borderRadius: 14, display: "grid", gap: 10 }}>
                    {modalSection.nested.fields.map((field) => (
                      <div key={field.key}>
                        {renderControl(
                          field,
                          readValue(field, pkg),
                          (raw) => onNestedChange(modalSection.nested, pkg.id, field, raw),
                          disabled,
                          modalSection
                        )}
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => removeNested(modalSection.nested, pkg.id)} style={{ justifySelf: "start", color: "#ef4444" }}>
                      Remove package
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="glass"
                  disabled={disabled || (modal.record[modalSection.nested.key] || []).length >= (modalSection.nested.maxItems || 8)}
                  onClick={() => addNested(modalSection.nested)}
                >
                  Add package
                </Button>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button type="submit" variant="primary" loading={state.saving} disabled={disabled}>
                {(modal.mode === "edit" ? "Save " : "Add ") + (modalUi.singular || "record")}
              </Button>
              <Button type="button" variant="ghost" disabled={disabled} onClick={() => { setModal(null); setModalError(""); }}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

window.IdentityProfileEditor = IdentityProfileEditor;
