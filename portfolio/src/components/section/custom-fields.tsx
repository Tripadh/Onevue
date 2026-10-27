import type { AdaptedCustomField } from "@/lib/onevue-profile-adapter";

const EMBEDDABLE = /^https:\/\/(?:www\.|m\.|player\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//i;

function FieldValue({ field }: { field: AdaptedCustomField }) {
  if (field.presentation === "hidden") return null;
  if (field.images && field.images.length) {
    return (
      <div className="flex flex-wrap gap-2">
        {field.images.map((image) => (
          <img key={image.href} src={image.href} alt={image.fileName || field.label} className="h-20 w-20 rounded-md border object-cover" />
        ))}
      </div>
    );
  }
  if (field.presentation === "image" && field.href) {
    return <img src={field.href} alt={field.label} className="h-24 w-24 rounded-md border object-cover" />;
  }
  if (field.presentation === "video" && field.href) {
    if (field.embed && EMBEDDABLE.test(field.href)) {
      return (
        <a href={field.href} target="_blank" rel="noreferrer" className="text-sm underline">
          {field.text || field.href}
        </a>
      );
    }
    return (
      <a href={field.href} target="_blank" rel="noreferrer" className="text-sm underline">
        {field.text || field.href}
      </a>
    );
  }
  if ((field.presentation === "link" || field.presentation === "file") && field.href) {
    return (
      <a href={field.href} target="_blank" rel="noreferrer" className="text-sm underline">
        {field.text || field.label}
      </a>
    );
  }
  if (field.tags && field.tags.length) {
    return (
      <div className="flex flex-wrap gap-1">
        {field.tags.map((tag) => (
          <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">{tag}</span>
        ))}
      </div>
    );
  }
  return <span className="text-sm">{field.text || (field.checked ? "Yes" : "")}</span>;
}

export function CustomFieldList({ fields }: { fields?: AdaptedCustomField[] }) {
  const visible = (fields || []).filter((field) => field && field.presentation !== "hidden");
  if (!visible.length) return null;
  return (
    <dl className="mt-2 grid gap-2">
      {visible.map((field) => (
        <div key={field.id} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{field.label}</dt>
          <dd><FieldValue field={field} /></dd>
        </div>
      ))}
    </dl>
  );
}
