/* Universal Record-Level Custom Fields Editor
 * Enables users to add, edit, reorder, and remove custom fields directly inside
 * any repeatable record modal or single-object section form across all 5 identity domains.
 */

const { useState: rcUseState } = React;

function RecordCustomFieldsEditor({ fields = [], onChange, disabled, title = "Additional Custom Fields" }) {
  const [showAddMenu, setShowAddMenu] = rcUseState(false);

  const list = Array.isArray(fields) ? fields : [];

  const FIELD_OPTIONS = [
    { value: "heading", label: "Heading" },
    { value: "text", label: "Text" },
    { value: "textarea", label: "Multiline Text" },
    { value: "url", label: "Web Link" },
    { value: "image", label: "Image" },
    { value: "file", label: "Document / File" },
    { value: "tags", label: "Tags / Keywords" },
    { value: "number", label: "Number" },
    { value: "date", label: "Date" },
    { value: "boolean", label: "Yes / No" },
  ];

  function handleAddField(type) {
    const api = window.OV && window.OV.customFields;
    const newField = api && api.createRecordField
      ? api.createRecordField(type)
      : {
          id: "fld_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
          label: type === "heading" ? "Heading" : type === "image" ? "Image" : type === "url" ? "Link" : "Custom Field",
          type: type || "text",
          visibility: "public",
          order: list.length,
          value: null,
        };
    newField.order = list.length;
    onChange([...list, newField]);
    setShowAddMenu(false);
  }

  function handleUpdateField(id, patch) {
    const next = list.map((f) => (f.id === id ? { ...f, ...patch } : f));
    onChange(next);
  }

  function handleRemoveField(id) {
    const next = list.filter((f) => f.id !== id).map((f, idx) => ({ ...f, order: idx }));
    onChange(next);
  }

  function handleMoveField(id, direction) {
    const idx = list.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= list.length) return;
    const copy = list.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    onChange(copy.map((f, i) => ({ ...f, order: i })));
  }

  return (
    <div className="record-custom-fields-editor" style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground, #fff)" }}>{title}</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>({list.length} added)</span>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn btn-sm btn-glass"
            disabled={disabled || list.length >= 25}
            onClick={() => setShowAddMenu(!showAddMenu)}
            style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <span>+ Add Custom Field</span>
          </button>
          {showAddMenu && (
            <div
              className="glass shadow-lg"
              style={{
                position: "absolute",
                right: 0,
                bottom: "calc(100% + 4px)",
                background: "var(--surface-dropdown, #1e1e24)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "6px 0",
                zIndex: 100,
                minWidth: 170,
              }}
            >
              {FIELD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 12px",
                    background: "none",
                    border: "none",
                    color: "var(--foreground, #fff)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.08)")}
                  onMouseLeave={(e) => (e.target.style.background = "none")}
                  onClick={() => handleAddField(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 10px", fontStyle: "italic" }}>
          No custom fields on this record. Click "Add Custom Field" to attach extra headings, notes, links, images, or files.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map((field, idx) => (
            <div
              key={field.id || idx}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                  <input
                    type="text"
                    value={field.label || ""}
                    placeholder="Field Label (e.g. Project Demo, Award Certificate)"
                    disabled={disabled}
                    onChange={(e) => handleUpdateField(field.id, { label: e.target.value })}
                    style={{
                      background: "rgba(0,0,0,0.2)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      fontSize: 12,
                      color: "inherit",
                      fontWeight: 600,
                      flex: 1,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.08)",
                      color: "var(--muted-foreground, #aaa)",
                    }}
                  >
                    {field.type}
                  </span>
                  <button
                    type="button"
                    title={field.visibility === "private" ? "Private (only you see this)" : "Public (visible on website)"}
                    onClick={() => handleUpdateField(field.id, { visibility: field.visibility === "private" ? "public" : "private" })}
                    style={{
                      background: "none",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 11,
                      color: field.visibility === "private" ? "var(--warning, #f59e0b)" : "var(--success, #10b981)",
                      cursor: "pointer",
                    }}
                  >
                    {field.visibility === "private" ? "Private" : "Public"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    disabled={disabled || idx === 0}
                    onClick={() => handleMoveField(field.id, -1)}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "2px 4px", fontSize: 11 }}
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={disabled || idx === list.length - 1}
                    onClick={() => handleMoveField(field.id, 1)}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "2px 4px", fontSize: 11 }}
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleRemoveField(field.id)}
                    style={{ background: "none", border: "none", color: "var(--danger, #ef4444)", cursor: "pointer", padding: "2px 6px", fontSize: 13, fontWeight: "bold" }}
                    title="Remove field"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Field Value Input */}
              <div>
                <RecordFieldValueInput
                  field={field}
                  value={field.value}
                  disabled={disabled}
                  onChange={(val) => handleUpdateField(field.id, { value: val })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordFieldValueInput({ field, value, disabled, onChange }) {
  const type = field.type;
  if (type === "heading") {
    return (
      <input
        type="text"
        value={value || ""}
        placeholder="Enter heading text..."
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "inherit",
          fontSize: 13,
          fontWeight: 600,
        }}
      />
    );
  }
  if (type === "textarea") {
    return (
      <textarea
        value={value || ""}
        placeholder="Enter details..."
        rows={3}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "inherit",
          fontSize: 13,
          resize: "vertical",
        }}
      />
    );
  }
  if (type === "url") {
    return (
      <input
        type="url"
        value={value || ""}
        placeholder="https://example.com/link"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "inherit",
          fontSize: 13,
        }}
      />
    );
  }
  if (type === "number") {
    return (
      <input
        type="number"
        value={value === 0 || value ? value : ""}
        placeholder="0"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "inherit",
          fontSize: 13,
        }}
      />
    );
  }
  if (type === "date") {
    return (
      <input
        type="date"
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "inherit",
          fontSize: 13,
        }}
      />
    );
  }
  if (type === "boolean") {
    return (
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>Enabled / Active</span>
      </label>
    );
  }
  if (type === "tags") {
    const tags = Array.isArray(value) ? value : [];
    return (
      <div>
        <input
          type="text"
          value={tags.join(", ")}
          placeholder="Comma-separated tags (e.g. AI, React, Hackathon)"
          disabled={disabled}
          onChange={(e) => {
            const arr = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange(arr);
          }}
          style={{
            width: "100%",
            padding: "6px 10px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "inherit",
            fontSize: 13,
          }}
        />
      </div>
    );
  }
  if (type === "image" || type === "file") {
    if (window.EditorAssetField) {
      const AssetComp = window.EditorAssetField;
      return (
        <AssetComp
          label=""
          hint={type === "file" ? "PDF or document file" : "JPEG, PNG, or WebP image"}
          purpose={type === "file" ? "portfolio-media" : "portfolio-image"}
          value={value && value.assetId ? value.assetId : ""}
          disabled={disabled}
          onChange={(assetId) => onChange(assetId ? { assetId, fileName: (value && value.fileName) || "" } : null)}
        />
      );
    }
  }
  // Default to text
  return (
    <input
      type="text"
      value={value || ""}
      placeholder="Enter value..."
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "6px 10px",
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        color: "inherit",
        fontSize: 13,
      }}
    />
  );
}

window.RecordCustomFieldsEditor = RecordCustomFieldsEditor;
