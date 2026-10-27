/**
 * Stored profile text is markdown, not HTML.
 * Underline uses ++text++. Only http and https links are kept.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string };
};

export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    return undefined;
  }
  return undefined;
}

function underlineNode(label: string): MdastNode {
  return {
    type: "underline",
    data: { hName: "u" },
    children: [{ type: "text", value: label }],
  };
}

export function transformUnderline(tree: MdastNode): void {
  if (!tree || !Array.isArray(tree.children)) return;
  const next: MdastNode[] = [];
  for (const child of tree.children) {
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("++")) {
      const parts = child.value.split(/(\+\+[^\n+]+\+\+)/g);
      for (const part of parts) {
        const match = /^\+\+([^\n+]+)\+\+$/.exec(part);
        if (match) next.push(underlineNode(match[1]));
        else if (part) next.push({ type: "text", value: part });
      }
    } else {
      transformUnderline(child);
      next.push(child);
    }
  }
  tree.children = next;
}

export function remarkUnderline() {
  return (tree: MdastNode) => {
    transformUnderline(tree);
  };
}
