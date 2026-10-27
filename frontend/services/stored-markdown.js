/**
 * Preview parser for stored profile markdown.
 * The same markers are rendered by the portfolio app.
 * This does not accept HTML.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.storedMarkdown = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
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

  function parseInlines(source) {
    const text = String(source || "");
    const nodes = [];
    let index = 0;
    while (index < text.length) {
      if (text.startsWith("**", index)) {
        const end = text.indexOf("**", index + 2);
        if (end !== -1) {
          nodes.push({ type: "bold", children: parseInlines(text.slice(index + 2, end)) });
          index = end + 2;
          continue;
        }
      }
      if (text.startsWith("++", index)) {
        const end = text.indexOf("++", index + 2);
        if (end !== -1 && text.slice(index + 2, end).indexOf("\n") === -1) {
          nodes.push({ type: "underline", children: parseInlines(text.slice(index + 2, end)) });
          index = end + 2;
          continue;
        }
      }
      if (text[index] === "*" && text[index + 1] !== "*") {
        const end = text.indexOf("*", index + 1);
        if (end !== -1 && text[end + 1] !== "*") {
          nodes.push({ type: "italic", children: parseInlines(text.slice(index + 1, end)) });
          index = end + 1;
          continue;
        }
      }
      if (text[index] === "[") {
        const labelEnd = text.indexOf("]", index + 1);
        if (labelEnd !== -1 && text[labelEnd + 1] === "(") {
          const urlEnd = text.indexOf(")", labelEnd + 2);
          if (urlEnd !== -1) {
            const href = safeHttpUrl(text.slice(labelEnd + 2, urlEnd));
            const label = text.slice(index + 1, labelEnd);
            if (href) {
              nodes.push({ type: "link", href, children: parseInlines(label) });
              index = urlEnd + 1;
              continue;
            }
          }
        }
      }
      let next = index + 1;
      while (next < text.length && text[next] !== "*" && text[next] !== "+" && text[next] !== "[") next += 1;
      nodes.push({ type: "text", value: text.slice(index, next) });
      index = next;
    }
    return nodes;
  }

  function parseStoredMarkdown(value) {
    const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, children: parseInlines(heading[2]) });
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          items.push(parseInlines(lines[index].replace(/^\s*[-*]\s+/, "")));
          index += 1;
        }
        blocks.push({ type: "list", ordered: false, items });
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          items.push(parseInlines(lines[index].replace(/^\s*\d+\.\s+/, "")));
          index += 1;
        }
        blocks.push({ type: "list", ordered: true, items });
        continue;
      }
      const paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "paragraph", children: parseInlines(paragraph.join(" ")) });
    }
    return blocks;
  }

  return { parseStoredMarkdown, safeHttpUrl };
});
