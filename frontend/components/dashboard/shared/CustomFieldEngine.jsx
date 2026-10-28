/* Custom field builder. Definitions and values are data. They never become code. */

const { useState: cfUseState } = React;

function cfApi() {
  return window.OV && window.OV.customFields;
}

function recordTitle(records, recordId) {
  const match = (records || []).find((record) => record && String(record.id) === String(recordId || ""));
  if (match && match.title) return match.title;
  return recordId ? "" : "";
}

function CustomFieldBoard({ identity, sectionId, layout, records, disabled, templateId, onChange, onSave }) {
  const api = cfApi();
  const spec = api ? api.builtinFor(identity, sectionId) : null;
  const [dialog, setDialog] = cfUseState(null);
  const [confirmId, setConfirmId] = cfUseState("");
  const [saving, setSaving] = cfUseState(false);
  const [error, setError] = cfUseState("");
  if (!api || !spec) return null;

  const current = api.layoutOf(layout);
  const section = api.sectionByBuiltin(current, spec.key);
  const fields = section ? api.activeFields(section) : [];
  const retired = section ? (section.fields || []).filter((field) => field.retired) : [];
  const rows = spec.repeatable
    ? (records || []).filter((record) => record && record.id)
    : [{ id: "", title: spec.label }];
  const template = templateId || api.MAGICUI;

  function commit(next) {
    setError("");
    if (onChange) onChange(next);
  }

  function openAdd() {
    const base = section ? current : api.ensureBuiltin(current, spec);
    const target = api.sectionByBuiltin(base, spec.key);
    setDialog({
      mode: "add",
      sectionId: target.id,
      sectionKey: spec.key,
      baseLayout: base,
      draft: {
        label: "",
        type: "text",
        required: false,
        visibility: "public",
        helpText: "",
        placeholder: "",
        config: api.defaultConfig("text"),
        optionsText: "",
        scope: "section",
        targetRecordId: "",
        mapsTo: "",
        identity,
        records: rows,
      },
      error: "",
      dirty: false,
    });
  }

  function openEdit(field) {
    const optionsText = field.config && Array.isArray(field.config.options)
      ? field.config.options.map((option) => option.label).join("\n")
      : "";
    setDialog({
      mode: "edit",
      sectionId: section.id,
      sectionKey: spec.key,
      fieldId: field.id,
      draft: {
        label: field.label,
        type: field.type,
        required: field.required,
        visibility: field.visibility,
        helpText: field.helpText || "",
        placeholder: field.placeholder || "",
        config: field.config || api.defaultConfig(field.type),
        optionsText,
        scope: field.scope === "record" ? "record" : "section",
        targetRecordId: field.targetRecordId || "",
        mapsTo: field.mapsTo || "",
        identity,
        records: rows,
      },
      error: "",
      dirty: false,
    });
  }

  function closeDialog() {
    if (dialog && dialog.dirty && !window.confirm("Discard unsaved field settings?")) return;
    setDialog(null);
  }

  function changeDraft(patch) {
    setDialog((currentDialog) => {
      if (!currentDialog) return currentDialog;
      const draft = Object.assign({}, currentDialog.draft, patch);
      if (patch.type) {
        draft.config = api.defaultConfig(patch.type);
        draft.mapsTo = "";
      }
      return Object.assign({}, currentDialog, { draft, dirty: true, error: "" });
    });
  }

  function saveDialog(event) {
    if (event) event.preventDefault();
    if (!dialog) return;
    const draft = Object.assign({}, dialog.draft);
    if (draft.type === "select" || draft.type === "multiselect") {
      const labels = String(draft.optionsText || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
      draft.config = Object.assign({}, draft.config, {
        options: labels.map((label) => ({ value: api.slug(label), label })),
      });
    }
    const source = dialog.mode === "edit" ? current : (dialog.baseLayout || current);
    const result = dialog.mode === "edit"
      ? api.updateField(source, dialog.sectionId, dialog.fieldId, draft)
      : api.addField(source, dialog.sectionId, draft);
    if (result.error) {
      setDialog(Object.assign({}, dialog, { error: result.error }));
      return;
    }
    commit(result.layout);
    setDialog(null);
  }

  async function saveLayout() {
    if (!onSave) return;
    setSaving(true);
    setError("");
    try {
      const ok = await onSave(current);
      if (ok === false) setError("Custom fields were not saved.");
    } catch (saveError) {
      setError(saveError.message || "Custom fields were not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass" style={{ padding: 24, borderRadius: 20, display: "grid", gap: 16 }} aria-labelledby={"custom-" + spec.key}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h3 id={"custom-" + spec.key} style={{ fontSize: 18, margin: 0 }}>Custom fields</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
            Add details to {spec.label}. Saving keeps them on your draft until you publish.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="button" size="sm" variant="primary" disabled={disabled || saving} onClick={openAdd}>Add custom field</Button>
          {onSave ? (
            <Button type="button" size="sm" variant="glass" loading={saving} disabled={disabled} onClick={saveLayout}>Save custom fields</Button>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{error}</p> : null}
      {fields.filter((field) => field.scope === "record" && !rows.some((record) => String(record.id) === String(field.targetRecordId))).map((field) => (
        <p key={field.id} role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>
          {field.label} is linked to a record that is no longer on this profile. Choose another record or unlink it. The record and any uploaded file stay in your account.
        </p>
      ))}
      {fields.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No custom fields yet. Add one when the built-in fields are not enough.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {fields.map((field, index) => {
            const note = api.compatibility(template, field.type);
            return (
              <div key={field.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <strong>{field.label}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {field.type}
                    {field.required ? " · required" : ""}
                    {field.visibility === "private" ? " · private" : ""}
                    {field.scope === "record" ? " · " + (recordTitle(rows, field.targetRecordId) || "missing record") : " · whole section"}
                    {field.mapsTo ? " · maps to " + field.mapsTo : ""}
                  </span>
                  {note.message ? <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{note.message}</p> : null}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Button type="button" size="sm" variant="ghost" disabled={disabled || index === 0} onClick={() => commit(api.reorderField(current, section.id, field.id, -1))}>Up</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={disabled || index === fields.length - 1} onClick={() => commit(api.reorderField(current, section.id, field.id, 1))}>Down</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => openEdit(field)}>Edit</Button>
                  {field.scope === "record" ? (
                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => commit(api.unlinkField(current, section.id, field.id))}>Unlink</Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => commit(api.updateField(current, section.id, field.id, Object.assign({}, field, { visibility: field.visibility === "private" ? "public" : "private" })).layout)}>
                    {field.visibility === "private" ? "Show publicly" : "Hide"}
                  </Button>
                  {confirmId === field.id ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { commit(api.removeField(current, section.id, field.id)); setConfirmId(""); }}>Confirm delete</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId("")}>Cancel</Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setConfirmId(field.id)} style={{ color: "#ef4444" }}>Delete</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Add an {spec.label} record before entering custom values.</p>
      ) : fields.length > 0 ? (
        <div style={{ display: "grid", gap: 16 }}>
          {rows.map((record) => {
            const recordFields = api.fieldsForRecord(section, record.id);
            if (!recordFields.length) return null;
            return (
            <fieldset key={record.id || spec.key} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, display: "grid", gap: 12 }}>
              <legend style={{ padding: "0 6px", fontSize: 13 }}>{record.title || spec.label}</legend>
              {recordFields.map((field) => (
                <CustomFieldControl
                  key={field.id}
                  field={field}
                  value={(api.valuesFor(current, section, record.id) || {})[field.id]}
                  disabled={disabled || saving}
                  onChange={(value) => commit(api.setValue(current, section, record.id, field.id, value))}
                />
              ))}
            </fieldset>
            );
          })}
        </div>
      ) : null}
      {retired.length > 0 ? (
        <div>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>Retired fields keep their saved values and stay off the public page.</p>
          {retired.map((field) => (
            <Button key={field.id} type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => commit(api.setRetired(current, section.id, field.id, false))}>
              Restore {field.label}
            </Button>
          ))}
        </div>
      ) : null}
      <CustomFieldDialog dialog={dialog} records={rows} onChange={changeDraft} onClose={closeDialog} onSubmit={saveDialog} />
    </section>
  );
}

function CustomFieldControl({ field, value, disabled, onChange }) {
  const label = field.label + (field.required ? " *" : "");
  const hint = field.helpText || "";
  if (field.type === "textarea") {
    return <Input label={label} hint={hint} value={value || ""} placeholder={field.placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.type === "number") {
    return (
      <Input
        label={label}
        hint={hint}
        type="number"
        value={value === 0 || value ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    );
  }
  if (field.type === "url" || field.type === "video") {
    return (
      <Input
        label={label}
        hint={field.type === "video" ? (hint || "Use an https link. YouTube and Vimeo can be embedded. Other links stay as links.") : hint}
        type="url"
        value={field.type === "video" ? ((value && value.url) || "") : (value || "")}
        placeholder={field.placeholder || "https://"}
        disabled={disabled}
        onChange={(event) => onChange(field.type === "video" ? { kind: "url", url: event.target.value } : event.target.value)}
      />
    );
  }
  if (field.type === "date") {
    return <Input label={label} hint={hint} type="date" value={value || ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.type === "boolean") {
    return (
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={!!value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (field.type === "select") {
    const options = (field.config && field.config.options) || [];
    return (
      <Select
        label={label}
        hint={hint}
        value={value || ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        options={[{ value: "", label: "Select" }].concat(options)}
      />
    );
  }
  if (field.type === "multiselect" && window.EditorMultiSelect) {
    return (
      <EditorMultiSelect
        label={label}
        hint={hint}
        options={(field.config && field.config.options) || []}
        value={Array.isArray(value) ? value : []}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  if (field.type === "tags") {
    return <CustomTagEditor label={label} hint={hint} value={Array.isArray(value) ? value : []} disabled={disabled} onChange={onChange} />;
  }
  if ((field.type === "image" || field.type === "file") && window.EditorAssetField) {
    return (
      <EditorAssetField
        label={label}
        hint={hint}
        purpose={field.type === "file" ? "portfolio-media" : "portfolio-image"}
        value={value && value.assetId ? value.assetId : ""}
        disabled={disabled}
        onChange={(assetId) => onChange(assetId ? { assetId, fileName: (value && value.fileName) || "" } : null)}
      />
    );
  }
  if (field.type === "gallery" && window.EditorAssetField) {
    const images = Array.isArray(value) ? value : [];
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <span className="field-label">{label}</span>
        {images.map((image, index) => (
          <EditorAssetField
            key={image.assetId || index}
            label={"Image " + (index + 1)}
            purpose="portfolio-image"
            value={image.assetId || ""}
            disabled={disabled}
            onChange={(assetId) => {
              const next = images.slice();
              if (!assetId) next.splice(index, 1);
              else next[index] = { assetId, fileName: image.fileName || "" };
              onChange(next);
            }}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="glass"
          disabled={disabled || images.length >= ((field.config && field.config.maxItems) || 8)}
          onClick={() => onChange(images.concat([{ assetId: "", fileName: "" }]))}
        >
          Add image
        </Button>
      </div>
    );
  }
  return <Input label={label} hint={hint} value={value || ""} placeholder={field.placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

function CustomTagEditor({ label, hint, value, disabled, onChange }) {
  const [text, setText] = cfUseState("");
  function addTag() {
    const next = text.trim();
    if (!next || value.indexOf(next) !== -1) return;
    onChange(value.concat(next));
    setText("");
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {value.map((tag) => (
          <button key={tag} type="button" className="badge" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== tag))}>{tag} ×</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" aria-label={label} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} />
        <Button type="button" size="sm" variant="glass" disabled={disabled} onClick={addTag}>Add tag</Button>
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function CustomFieldDialog({ dialog, records, onChange, onClose, onSubmit }) {
  if (!dialog) return null;
  const api = cfApi();
  const draft = dialog.draft;
  const editing = dialog.mode === "edit";
  const showOptions = draft.type === "select" || draft.type === "multiselect";
  const showLength = draft.type === "text" || draft.type === "textarea";
  const showNumber = draft.type === "number";
  return (
    <Modal open onClose={onClose} title={editing ? "Edit custom field" : "Add custom field"}>
      <form style={{ display: "grid", gap: 12 }} onSubmit={onSubmit}>
        <h3 style={{ margin: 0, fontSize: 20 }}>{editing ? "Edit custom field" : "Add custom field"}</h3>
        {dialog.error ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{dialog.error}</p> : null}
        <Input label="Label" value={draft.label} onChange={(event) => onChange({ label: event.target.value })} />
        <Select
          label="Field type"
          value={draft.type}
          disabled={editing}
          onChange={(event) => onChange({ type: event.target.value })}
          options={(api ? api.FIELD_TYPES : []).map((item) => ({ value: item.type, label: item.label }))}
        />
        {showOptions ? (
          <label className="field">
            <span className="field-label">Options, one per line</span>
            <textarea className="input" rows={4} value={draft.optionsText} onChange={(event) => onChange({ optionsText: event.target.value })} />
          </label>
        ) : null}
        {showLength ? (
          <Input label="Maximum length" type="number" value={draft.config.maxLength || ""} onChange={(event) => onChange({ config: Object.assign({}, draft.config, { maxLength: Number(event.target.value) }) })} />
        ) : null}
        {showNumber ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Input label="Minimum" type="number" value={draft.config.min ?? ""} onChange={(event) => onChange({ config: Object.assign({}, draft.config, { min: event.target.value === "" ? undefined : Number(event.target.value) }) })} />
            <Input label="Maximum" type="number" value={draft.config.max ?? ""} onChange={(event) => onChange({ config: Object.assign({}, draft.config, { max: event.target.value === "" ? undefined : Number(event.target.value) }) })} />
          </div>
        ) : null}
        <Input label="Help text" value={draft.helpText} onChange={(event) => onChange({ helpText: event.target.value })} />
        <Input label="Placeholder" value={draft.placeholder} onChange={(event) => onChange({ placeholder: event.target.value })} />
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={!!draft.required} onChange={(event) => onChange({ required: event.target.checked })} />
          <span>Required</span>
        </label>
        <Select
          label="Visibility"
          value={draft.visibility}
          onChange={(event) => onChange({ visibility: event.target.value })}
          options={[{ value: "public", label: "Public on the published portfolio" }, { value: "private", label: "Private to your account" }]}
        />
        {dialog.standalone ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>This field stays in this custom section. It is not linked to an identity record.</p>
        ) : (
          <>
            <Select
              label="Attachment"
              value={draft.scope || "section"}
              onChange={(event) => onChange({ scope: event.target.value, targetRecordId: event.target.value === "record" ? draft.targetRecordId : "" })}
              options={[
                { value: "section", label: "Whole section" },
                { value: "record", label: "One existing record" },
              ]}
            />
            {draft.scope === "record" ? (
              <Select
                label="Existing record"
                value={draft.targetRecordId || ""}
                onChange={(event) => onChange({ targetRecordId: event.target.value })}
                options={[{ value: "", label: "Select a record" }].concat((records || []).filter((record) => record && record.id).map((record) => ({ value: record.id, label: record.title || record.id })))}
              />
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>This value applies to the section. It is not tied to one record.</p>
            )}
            <Select
              label="Built-in field"
              hint="Leave this empty to keep the value as an extra field on the record. An image stays on the record when the section has no image field."
              value={draft.mapsTo || ""}
              onChange={(event) => onChange({ mapsTo: event.target.value })}
              options={[{ value: "", label: "Keep as an extra field" }].concat((api ? api.mappableFields(draft.identity, dialog.sectionKey, draft.type) : []).map((field) => ({ value: field.key, label: field.label })))}
            />
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Button type="submit" variant="primary">{editing ? "Save field" : "Add field"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function CustomSectionManager({ layout, disabled, templateId, onChange, onSave }) {
  const api = cfApi();
  const [title, setTitle] = cfUseState("");
  const [description, setDescription] = cfUseState("");
  const [error, setError] = cfUseState("");
  const [confirmId, setConfirmId] = cfUseState("");
  const [saving, setSaving] = cfUseState(false);
  if (!api) return null;
  const current = api.layoutOf(layout);
  const sections = api.userSections(current);

  function commit(next) {
    setError("");
    if (onChange) onChange(next);
  }

  function createSection(event) {
    if (event) event.preventDefault();
    const result = api.addUserSection(current, { title, description, repeatable: true, visibility: "public" });
    if (result.error) {
      setError(result.error);
      return;
    }
    commit(result.layout);
    setTitle("");
    setDescription("");
  }

  async function saveLayout(next) {
    const layoutToSave = next || current;
    if (onChange && next) onChange(next);
    if (!onSave) return;
    setSaving(true);
    try {
      const ok = await onSave(layoutToSave);
      if (ok === false) setError("Custom sections were not saved.");
    } catch (saveError) {
      setError(saveError.message || "Custom sections were not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass" style={{ padding: 24, borderRadius: 20, display: "grid", gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 18, margin: 0 }}>Custom sections</h3>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
          Create a section that is not one of the built-in profile groups, then add fields inside it.
        </p>
      </div>
      <form onSubmit={createSection} style={{ display: "grid", gap: 10 }}>
        <Input label="Section title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <Input label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
        {error ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{error}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="submit" size="sm" variant="primary" disabled={disabled || saving}>Add custom section</Button>
          {onSave ? <Button type="button" size="sm" variant="glass" loading={saving} disabled={disabled} onClick={() => saveLayout()}>Save custom sections</Button> : null}
        </div>
      </form>
      {sections.length === 0 ? <p className="muted" style={{ margin: 0 }}>No custom sections yet.</p> : null}
      {sections.map((section) => (
        <CustomUserSection
          key={section.id}
          layout={current}
          section={section}
          disabled={disabled || saving}
          templateId={templateId}
          confirmId={confirmId}
          onConfirm={setConfirmId}
          onChange={commit}
        />
      ))}
    </section>
  );
}

function CustomUserSection({ layout, section, disabled, templateId, confirmId, onConfirm, onChange }) {
  const api = cfApi();
  const [dialog, setDialog] = cfUseState(null);
  const fields = api.activeFields(section);
  const entries = section.repeatable ? api.entriesFor(layout, section.id) : [{ id: "", title: section.title }];
  const template = templateId || api.MAGICUI;

  function openAdd() {
    setDialog({
      mode: "add",
      standalone: true,
      sectionId: section.id,
      draft: { label: "", type: "text", required: false, visibility: "public", helpText: "", placeholder: "", config: api.defaultConfig("text"), optionsText: "", scope: "section", targetRecordId: "", mapsTo: "" },
      error: "",
      dirty: false,
    });
  }

  function changeDraft(patch) {
    setDialog((currentDialog) => {
      if (!currentDialog) return currentDialog;
      const draft = Object.assign({}, currentDialog.draft, patch);
      if (patch.type) {
        draft.config = api.defaultConfig(patch.type);
        draft.mapsTo = "";
      }
      return Object.assign({}, currentDialog, { draft, dirty: true, error: "" });
    });
  }

  function saveDialog(event) {
    if (event) event.preventDefault();
    const draft = Object.assign({}, dialog.draft);
    if (draft.type === "select" || draft.type === "multiselect") {
      const labels = String(draft.optionsText || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
      draft.config = Object.assign({}, draft.config, { options: labels.map((label) => ({ value: api.slug(label), label })) });
    }
    const result = dialog.mode === "edit"
      ? api.updateField(layout, section.id, dialog.fieldId, draft)
      : api.addField(layout, section.id, draft);
    if (result.error) {
      setDialog(Object.assign({}, dialog, { error: result.error }));
      return;
    }
    onChange(result.layout);
    setDialog(null);
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 16, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h4 style={{ margin: 0 }}>{section.title}</h4>
          {section.description ? <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{section.description}</p> : null}
          {section.visibility === "private" ? <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>This section is private and will not be published.</p> : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button type="button" size="sm" variant="glass" disabled={disabled} onClick={openAdd}>Add custom field</Button>
          {section.repeatable ? (
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(api.addEntry(layout, section.id))}>Add record</Button>
          ) : null}
          {confirmId === section.id ? (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(api.removeUserSection(layout, section.id)); onConfirm(""); }}>Confirm delete</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onConfirm("")}>Cancel</Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onConfirm(section.id)} style={{ color: "#ef4444" }}>Delete section</Button>
          )}
        </div>
      </div>
      {fields.length === 0 ? <p className="muted" style={{ margin: 0 }}>This section has no fields yet.</p> : null}
      {fields.map((field) => {
        const note = api.compatibility(template, field.type);
        return (
          <div key={field.id}>
            <span>{field.label}</span>
            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{field.type}{field.visibility === "private" ? " · private" : ""}</span>
            {note.message ? <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{note.message}</p> : null}
          </div>
        );
      })}
      {entries.map((entry, index) => (
        <fieldset key={entry.id || index} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <legend style={{ padding: "0 6px", fontSize: 12 }}>{section.repeatable ? "Record " + (index + 1) : section.title}</legend>
          {fields.map((field) => (
            <CustomFieldControl
              key={field.id}
              field={field}
              value={(api.valuesFor(layout, section, entry.id) || {})[field.id]}
              disabled={disabled}
              onChange={(value) => onChange(api.setValue(layout, section, entry.id, field.id, value))}
            />
          ))}
          {section.repeatable ? (
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(api.removeEntry(layout, entry.id))}>Remove record</Button>
          ) : null}
        </fieldset>
      ))}
      <CustomFieldDialog
        dialog={dialog}
        onChange={changeDraft}
        onClose={() => {
          if (dialog && dialog.dirty && !window.confirm("Discard unsaved field settings?")) return;
          setDialog(null);
        }}
        onSubmit={saveDialog}
      />
    </div>
  );
}

function RecordLinkedFields({ identity, sectionId, recordId, layout, records, disabled, onChange }) {
  const api = cfApi();
  if (!api || !recordId) return null;
  const spec = api.builtinFor(identity, sectionId);
  if (!spec) return null;
  const current = api.layoutOf(layout);
  const section = api.sectionByBuiltin(current, spec.key);
  if (!section) return null;
  const linked = api.activeFields(section).filter((field) => field.scope === "record" && field.targetRecordId === String(recordId));
  if (!linked.length) return null;
  const values = api.valuesFor(current, section, recordId);
  const choices = (records || []).filter((record) => record && record.id);
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Linked to this record</p>
      {linked.map((field) => (
        <div key={field.id} style={{ display: "grid", gap: 8 }}>
          <CustomFieldControl
            field={field}
            value={values[field.id]}
            disabled={disabled}
            onChange={(value) => onChange && onChange(api.setValue(current, section, recordId, field.id, value))}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ minWidth: 180 }}>
              <Select
                label="Record link"
                value={String(recordId)}
                disabled={disabled}
                onChange={(event) => {
                  const result = api.setFieldTarget(current, section.id, field.id, event.target.value, choices);
                  if (!result || result.error || !onChange) return;
                  onChange(result.layout);
                }}
                options={choices.map((record) => ({ value: String(record.id), label: record.title || String(record.id) }))}
              />
            </div>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange && onChange(api.unlinkField(current, section.id, field.id))}>
              Unlink
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

window.CustomFieldBoard = CustomFieldBoard;
window.CustomSectionManager = CustomSectionManager;
window.RecordLinkedFields = RecordLinkedFields;
