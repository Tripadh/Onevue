/* Editor primitives for identity profiles. Values stay plain text or markdown.
   HTML and scripts are not inserted. The server strips tags again on save. */
const { useEffect: editorUseEffect, useRef: editorUseRef, useState: editorUseState } = React;

function editorDescribed(id, hint, error) {
  return error || hint ? id + "-d" : undefined;
}

function EditorText({ label, hint, error, value, disabled, onChange, placeholder, type = "text" }) {
  return (
    <Input
      label={label}
      hint={error ? undefined : hint}
      error={error}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function EditorChoice({ label, hint, options, value, disabled, onChange }) {
  const normalized = (options || []).map((option) => (
    Array.isArray(option) ? { value: option[0], label: option[1] } : option
  ));
  return (
    <Select
      label={label}
      hint={hint}
      options={normalized}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function EditorLink({ label, hint, value, disabled, onChange, placeholder }) {
  const text = value || "";
  let error = "";
  if (text && !/^https?:\/\//i.test(text)) {
    error = "Use an http or https link.";
  }
  return (
    <EditorText
      label={label}
      hint={hint || "Only http and https links are saved."}
      error={error}
      type="url"
      value={text}
      disabled={disabled}
      placeholder={placeholder || "https://"}
      onChange={onChange}
    />
  );
}

function EditorMediaReference({ label, hint, value, disabled, onChange }) {
  const text = value || "";
  const error = text && !/^ast_[a-f0-9]{24}$/.test(text)
    ? "Use an uploaded asset id, ast_ followed by 24 hex characters."
    : "";
  return (
    <EditorText
      label={label}
      hint={hint || "Reference to a file you uploaded. This field does not upload a file."}
      error={error}
      value={text}
      disabled={disabled}
      placeholder="ast_"
      onChange={onChange}
    />
  );
}

function renderStoredInline(node, key) {
  if (!node) return null;
  if (node.type === "text") return node.value;
  const children = (node.children || []).map((child, index) => renderStoredInline(child, key + "-" + index));
  if (node.type === "bold") return React.createElement("strong", { key }, children);
  if (node.type === "italic") return React.createElement("em", { key }, children);
  if (node.type === "underline") return React.createElement("u", { key }, children);
  if (node.type === "link") {
    return React.createElement("a", { key, href: node.href, target: "_blank", rel: "noopener noreferrer" }, children);
  }
  return null;
}

function StoredMarkdownPreview({ value }) {
  const parser = window.OV && window.OV.storedMarkdown;
  const blocks = parser ? parser.parseStoredMarkdown(value || "") : [];
  if (!blocks.length) return <p className="muted" style={{ margin: 0 }}>Nothing to preview yet.</p>;
  return (
    <div className="stored-markdown" style={{ display: "grid", gap: 8 }}>
      {blocks.map((block, index) => {
        const children = (block.children || []).map((child, childIndex) => renderStoredInline(child, index + "-" + childIndex));
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return React.createElement(Tag, { key: index, style: { margin: 0 } }, children);
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return React.createElement(
            Tag,
            { key: index, style: { margin: 0, paddingLeft: 20 } },
            block.items.map((item, itemIndex) => React.createElement("li", { key: itemIndex }, item.map((child, childIndex) => renderStoredInline(child, itemIndex + "-" + childIndex))))
          );
        }
        return React.createElement("p", { key: index, style: { margin: 0 } }, children);
      })}
    </div>
  );
}

function EditorRichText({ label, hint, value, disabled, onChange, placeholder }) {
  const ref = editorUseRef(null);
  const [linkLabel, setLinkLabel] = editorUseState("");
  const [linkUrl, setLinkUrl] = editorUseState("");
  const [linkError, setLinkError] = editorUseState("");
  const [preview, setPreview] = editorUseState(false);
  const text = value || "";

  function replaceSelection(nextSelected) {
    const current = text;
    const el = ref.current;
    const start = el ? el.selectionStart || 0 : current.length;
    const end = el ? el.selectionEnd || 0 : current.length;
    onChange(current.slice(0, start) + nextSelected + current.slice(end));
  }

  function wrap(before, after) {
    const el = ref.current;
    const start = el ? el.selectionStart || 0 : text.length;
    const end = el ? el.selectionEnd || 0 : text.length;
    const selected = text.slice(start, end) || "text";
    replaceSelection(before + selected + after);
  }

  function prefixLines(marker) {
    const el = ref.current;
    const start = el ? el.selectionStart || 0 : 0;
    const end = el ? el.selectionEnd || 0 : text.length;
    const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const blockEndIndex = text.indexOf("\n", end);
    const blockEnd = blockEndIndex === -1 ? text.length : blockEndIndex;
    const block = text.slice(blockStart, blockEnd);
    const prefixed = block.split("\n").map((line) => (line.trim() ? marker + line.replace(/^(#{1,3}\s+|[-*]\s+|\d+\.\s+)/, "") : line)).join("\n");
    onChange(text.slice(0, blockStart) + prefixed + text.slice(blockEnd));
  }

  function insertLink(event) {
    event.preventDefault();
    const el = ref.current;
    const start = el ? el.selectionStart || 0 : text.length;
    const end = el ? el.selectionEnd || 0 : text.length;
    const selected = text.slice(start, end).trim();
    const labelText = selected || linkLabel.trim();
    const url = linkUrl.trim();
    if (!labelText || !/^https?:\/\//i.test(url)) {
      setLinkError("Select text or enter a label, and use an http or https URL.");
      return;
    }
    setLinkError("");
    const next = "[" + labelText + "](" + url + ")";
    if (selected) replaceSelection(next);
    else onChange((text ? text + " " : "") + next);
    setLinkLabel("");
    setLinkUrl("");
  }

  function removeLink() {
    const el = ref.current;
    const start = el ? el.selectionStart || 0 : 0;
    const end = el ? el.selectionEnd || 0 : text.length;
    const selected = text.slice(start, end);
    const match = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(selected || text);
    if (!match) {
      setLinkError("Select a markdown link to remove it.");
      return;
    }
    setLinkError("");
    if (selected) replaceSelection(match[1]);
    else onChange(text.replace(match[0], match[1]));
  }

  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <Button type="button" size="sm" variant={preview ? "glass" : "primary"} disabled={disabled} onClick={() => setPreview(false)}>Edit</Button>
        <Button type="button" size="sm" variant={preview ? "primary" : "glass"} disabled={disabled} onClick={() => setPreview(true)}>Preview</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => wrap("**", "**")}>Bold</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => wrap("*", "*")}>Italic</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => wrap("++", "++")}>Underline</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => prefixLines("## ")}>Heading</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => prefixLines("- ")}>Bullets</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={() => prefixLines("1. ")}>Numbered</Button>
      </div>
      {preview ? (
        <div className="input" style={{ minHeight: 120, height: "auto", padding: 12 }}>
          <StoredMarkdownPreview value={text} />
        </div>
      ) : (
        <textarea
          ref={ref}
          className="input"
          rows={5}
          value={text}
          disabled={disabled}
          placeholder={placeholder || "Write in text. Formatting is stored as markdown, not HTML."}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 8, marginTop: 8, alignItems: "end" }}>
        <EditorText label="Link label" hint="Used when no text is selected." value={linkLabel} disabled={disabled || preview} onChange={setLinkLabel} />
        <EditorText label="Link URL" type="url" value={linkUrl} disabled={disabled || preview} placeholder="https://" onChange={setLinkUrl} />
        <Button type="button" size="sm" variant="glass" disabled={disabled || preview} onClick={insertLink}>Link selection</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || preview} onClick={removeLink}>Remove link</Button>
      </div>
      {linkError ? <span className="field-error" role="alert">{linkError}</span> : null}
      <span className="field-hint">{hint || "Stored as text. HTML and scripts are removed when the profile is saved."}</span>
    </div>
  );
}

function editorApiBase() {
  const configured = window.OV_ENV && window.OV_ENV.API_BASE;
  return String(configured || "http://localhost:3000/api").replace(/\/$/, "");
}

function editorAuthToken() {
  const session = window.OV && window.OV.core && window.OV.core.db && window.OV.core.db.get("session", null);
  return session && session.token ? session.token : "";
}

function EditorAssetField({ label, hint, value, purpose, disabled, onChange }) {
  const files = window.OV && window.OV.assetFiles;
  const policy = files ? files.policyFor(purpose) : null;
  const fileRef = editorUseRef(null);
  const [progress, setProgress] = editorUseState(0);
  const [uploading, setUploading] = editorUseState(false);
  const [error, setError] = editorUseState("");
  const [assets, setAssets] = editorUseState([]);
  const [previewUrl, setPreviewUrl] = editorUseState("");
  const text = value || "";

  function loadAssets() {
    const token = editorAuthToken();
    if (!token || !purpose) return;
    fetch(editorApiBase() + "/assets", { headers: { Authorization: "Bearer " + token } })
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then((result) => {
        if (!result.ok) {
          setError(result.body.message || "Could not list uploaded files.");
          return;
        }
        const owned = Array.isArray(result.body.assets) ? result.body.assets : [];
        setAssets(owned.filter((asset) => asset && asset.purpose === purpose && asset.status !== "deleted"));
      })
      .catch(() => setError("Could not list uploaded files."));
  }

  editorUseEffect(() => {
    loadAssets();
  }, [purpose]);

  editorUseEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setPreviewUrl("");
    if (!text || !/^ast_[a-f0-9]{24}$/.test(text)) return undefined;
    const token = editorAuthToken();
    if (!token) return undefined;
    fetch(editorApiBase() + "/assets/private/" + text, { headers: { Authorization: "Bearer " + token } })
      .then((response) => {
        if (!response.ok) throw new Error("preview");
        const type = response.headers.get("content-type") || "";
        if (type.indexOf("image/") !== 0) return null;
        return response.blob();
      })
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [text]);

  function upload(file) {
    const message = files ? files.validateAssetFile(purpose, file) : "Upload is unavailable.";
    if (message) {
      setError(message);
      return;
    }
    const token = editorAuthToken();
    if (!token) {
      setError("Sign in again before uploading a file.");
      return;
    }
    setError("");
    setUploading(true);
    setProgress(0);
    const body = new FormData();
    body.append("purpose", purpose);
    body.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", editorApiBase() + "/assets");
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch (parseError) { payload = {}; }
      if (xhr.status < 200 || xhr.status >= 300 || !payload.asset) {
        setError(payload.message || "Upload failed.");
        return;
      }
      onChange(payload.asset.assetId);
      loadAssets();
    };
    xhr.onerror = () => {
      setUploading(false);
      setError("Upload failed before the server responded.");
    };
    xhr.send(body);
  }

  const privateFile = files && files.isPrivatePurpose(purpose);
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      {previewUrl ? (
        <img src={previewUrl} alt="" style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)" }} />
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          ref={fileRef}
          type="file"
          accept={policy ? policy.mimeTypes.join(",") : undefined}
          disabled={disabled || uploading || !purpose}
          onChange={(event) => {
            const file = event.target.files && event.target.files[0];
            if (file) upload(file);
            event.target.value = "";
          }}
        />
        {text ? (
          <Button type="button" size="sm" variant="ghost" disabled={disabled || uploading} onClick={() => onChange("")}>
            Remove reference
          </Button>
        ) : null}
      </div>
      {uploading ? <span className="field-hint">Uploading… {progress}%</span> : null}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
      {assets.length > 0 ? (
        <label className="field">
          <span className="field-label">Choose an existing file</span>
          <select className="input" value={text} disabled={disabled || uploading} onChange={(event) => onChange(event.target.value)}>
            <option value="">None</option>
            {assets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>{asset.fileName || asset.assetId}</option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="field-hint">
        {hint || (policy ? policy.label + "." : "Upload a file you own.")}
        {privateFile ? " This file stays private and is not shown on the public page." : " The current template shows one image, not a gallery or a video file."}
        {" Removing the reference does not delete the stored file."}
      </span>
    </div>
  );
}

function EditorSectionVisibility({ sections, selected, disabled, onChange }) {
  const current = Array.isArray(selected) ? selected : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
      {(sections || []).map((section) => {
        const checked = current.includes(section.id);
        return (
          <label
            key={section.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: 14,
              borderRadius: 16,
              border: checked ? "1px solid var(--accent)" : "1px solid var(--line)",
              background: checked ? "color-mix(in oklab, var(--accent) 6%, transparent)" : "transparent",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => {
                const next = checked ? current.filter((id) => id !== section.id) : current.concat(section.id);
                onChange(next);
              }}
            />
            <span>
              <span className="field-label" style={{ display: "block" }}>{section.label}</span>
              {section.description ? <span className="muted" style={{ fontSize: 12 }}>{section.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function EditorRadio({ label, hint, options, value, disabled, onChange }) {
  const normalized = (options || []).map((option) => (
    Array.isArray(option) ? { value: option[0], label: option[1] } : option
  ));
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      {label ? <legend className="field-label">{label}</legend> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {normalized.map((option) => (
          <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              name={label || "choice"}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </fieldset>
  );
}

function EditorMultiSelect({ label, hint, options, value, disabled, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const normalized = (options || []).map((option) => (
    Array.isArray(option) ? { value: option[0], label: option[1] } : option
  ));
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {normalized.map((option) => {
          const checked = selected.indexOf(option.value) !== -1;
          return (
            <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  const next = checked ? selected.filter((item) => item !== option.value) : selected.concat(option.value);
                  onChange(next);
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function EditorSectionOrder({ sections, order, disabled, onChange }) {
  const byId = {};
  (sections || []).forEach((section) => { byId[section.id] = section; });
  const ids = (Array.isArray(order) && order.length ? order : (sections || []).map((section) => section.id)).filter((id) => byId[id]);
  (sections || []).forEach((section) => {
    if (ids.indexOf(section.id) === -1) ids.push(section.id);
  });
  function move(index, direction) {
    const reorder = window.OV && window.OV.createCustomize && window.OV.createCustomize.reorderEntries;
    const next = reorder ? reorder(ids, index, direction) : ids;
    if (next !== ids) onChange(next);
  }
  return (
    <ol style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
      {ids.map((id, index) => (
        <li key={id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 12 }}>
          <span>{(index + 1) + ". " + byId[id].label}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || index === 0} onClick={() => move(index, -1)}>Up</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || index === ids.length - 1} onClick={() => move(index, 1)}>Down</Button>
          </span>
        </li>
      ))}
    </ol>
  );
}

window.EditorText = EditorText;
window.EditorChoice = EditorChoice;
window.EditorRadio = EditorRadio;
window.EditorMultiSelect = EditorMultiSelect;
window.EditorLink = EditorLink;
window.EditorMediaReference = EditorMediaReference;
window.EditorAssetField = EditorAssetField;
window.EditorRichText = EditorRichText;
window.EditorSectionVisibility = EditorSectionVisibility;
window.EditorSectionOrder = EditorSectionOrder;
window.StoredMarkdownPreview = StoredMarkdownPreview;
