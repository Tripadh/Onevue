/* Shared editor for professional, freelancer, creator, and business profiles. */

const { useEffect: idUseEffect, useReducer: idUseReducer, useRef: idUseRef } = React;

function IdentityProfileEditor({ identity }) {
  const logic = window.OV.identityProfileState;
  const toast = useToast();
  const spec = logic.FORM_SPECS[identity];
  const [state, dispatch] = idUseReducer(logic.profileEditorReducer, null, logic.createProfileEditorState);
  const savingRef = idUseRef(false);
  const loadSeq = idUseRef(0);

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
      dispatch({ type: "load_success", profile: data.profile });
    }).catch((error) => {
      if (seq !== loadSeq.current) return;
      dispatch({ type: "load_error", message: error.message || "Could not load profile." });
    });
  }

  idUseEffect(() => {
    load();
    return () => {
      loadSeq.current += 1;
    };
  }, [identity]);

  async function save(event) {
    if (event) event.preventDefault();
    if (savingRef.current || !state.draft) return;
    savingRef.current = true;
    dispatch({ type: "save_start" });
    try {
      const payload = logic.buildUpdatePayload(identity, state.draft);
      const data = await window.OV.services.domainProfile.updateIdentityProfile(identity, payload);
      if (!data || !data.profile) {
        throw new Error("The server did not confirm the saved profile.");
      }
      dispatch({ type: "save_success", profile: data.profile });
      toast.push({ title: "Profile saved", body: "Changes are stored in your account.", tone: "success" });
    } catch (error) {
      const message = error.message || "Save failed.";
      dispatch({ type: "save_error", message });
      toast.push({ title: "Profile was not saved", body: message, tone: "error" });
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
    const value = writeValue(field, raw);
    editDraft(logic.setField(state.draft, field.key, value));
  }

  function onObjectChange(objectKey, field, raw) {
    const value = writeValue(field, raw);
    const nextObject = logic.setField(state.draft[objectKey] || {}, field.key, value);
    editDraft(Object.assign({}, state.draft, { [objectKey]: nextObject }));
  }

  function onRecordChange(collection, id, field, raw) {
    const value = writeValue(field, raw);
    const list = (state.draft[collection] || []).map((item) => {
      if (!item || item.id !== id) return item;
      return logic.setField(item, field.key, value);
    });
    editDraft(Object.assign({}, state.draft, { [collection]: list }));
  }

  function addRecord(section) {
    const record = section.blank();
    record.id = logic.newRecordId();
    const list = logic.upsertById(state.draft[section.collection] || [], record);
    editDraft(Object.assign({}, state.draft, { [section.collection]: list }));
  }

  function removeRecord(collection, id) {
    editDraft(Object.assign({}, state.draft, { [collection]: logic.removeById(state.draft[collection] || [], id) }));
  }

  function renderControl(field, value, onChange, disabled) {
    if ((field.key === "status" || field.key === "verificationStatus") && (value === "verified" || value === "rejected")) {
      return <p className="muted" style={{ margin: 0 }}>Status: {value}. OneVue controls this value.</p>;
    }
    if (field.type === "textarea" || field.type === "lines") {
      return (
        <label className="field">
          <span className="field-label">{field.label}</span>
          <textarea className="input" rows={field.type === "lines" ? 4 : 5} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        </label>
      );
    }
    if (field.type === "select") {
      return <Select label={field.label} options={field.options} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
    }
    if (field.type === "checkbox") {
      return <Toggle label={field.label} checked={!!value} onChange={onChange} />;
    }
    const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text";
    return <Input label={field.label} type={inputType} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
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

  return (
    <form onSubmit={save} style={{ display: "grid", gap: 24 }}>
      {state.saveError ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{state.saveError}</p> : null}
      {state.notice === "saved" ? <p role="status" style={{ margin: 0 }}>Saved.</p> : null}
      {spec.sections.map((section) => (
        <section key={section.id} className="glass" style={{ padding: 24, borderRadius: 20, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>{section.title}</h3>
            {section.collection ? (
              <Button type="button" size="sm" variant="glass" onClick={() => addRecord(section)} disabled={disabled}>Add</Button>
            ) : null}
          </div>
          {section.note ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{section.note}</p> : null}
          {section.collection ? (
            (draft[section.collection] || []).length === 0 ? (
              <EmptyState title={"No " + section.title.toLowerCase() + " yet"} body="Add a record to store it with your profile." />
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {(draft[section.collection] || []).map((record) => (
                  <div key={record.id} style={{ display: "grid", gap: 12, padding: 14, borderRadius: 14, border: "1px solid var(--line)" }}>
                    {section.collection === "testimonials" ? (
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{record.attribution === "verified" ? "Verified testimonial" : "Self-reported testimonial"}</p>
                    ) : null}
                    {section.collection === "audienceStats" ? (
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{record.verificationStatus === "verified" ? "Verified audience record" : "Self-reported figure — not independently verified"}</p>
                    ) : null}
                    {section.fields.map((field) => (
                      <div key={field.key}>
                        {renderControl(field, readValue(field, record), (raw) => onRecordChange(section.collection, record.id, field, raw), disabled)}
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="glass" onClick={() => removeRecord(section.collection, record.id)} disabled={disabled}>Remove</Button>
                  </div>
                ))}
              </div>
            )
          ) : section.object ? (
            <div style={{ display: "grid", gap: 12 }}>
              {section.fields.map((field) => (
                <div key={field.key}>
                  {renderControl(field, readValue(field, draft[section.object] || {}), (raw) => onObjectChange(section.object, field, raw), disabled)}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {section.fields.map((field) => (
                <div key={field.key}>
                  {renderControl(field, readValue(field, draft), (raw) => onScalarChange(field, raw), disabled)}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      <Button type="submit" variant="primary" loading={state.saving} disabled={disabled || !state.draft} style={{ justifySelf: "start" }}>
        Save profile
      </Button>
    </form>
  );
}

window.IdentityProfileEditor = IdentityProfileEditor;
