import type { ReactNode } from "react";
import Markdown from "react-markdown";
import { remarkUnderline, safeHttpUrl } from "@/lib/stored-markdown";

function SafeLink({ href, children }: { href?: string; children?: ReactNode }) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Renders stored profile text. Raw HTML is not enabled. */
export function StoredText({ text }: { text: string }) {
  return (
    <div className="prose max-w-full text-pretty font-sans text-sm leading-relaxed text-muted-foreground dark:prose-invert">
      <Markdown
        remarkPlugins={[remarkUnderline]}
        components={{
          a: SafeLink,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
