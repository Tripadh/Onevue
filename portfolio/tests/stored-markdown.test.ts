import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeHttpUrl, transformUnderline } from "../src/lib/stored-markdown.ts";

type Node = {
  type: string;
  value?: string;
  data?: { hName?: string };
  children?: Node[];
};

describe("stored markdown", () => {
  it("turns underline markers into a safe underline node and leaves other text", () => {
    const tree: Node = {
      type: "root",
      children: [{ type: "text", value: "Keep ++this++ and **that**" }],
    };
    transformUnderline(tree);
    const children = tree.children || [];
    assert.equal(children[0].type, "text");
    assert.equal(children[0].value, "Keep ");
    assert.equal(children[1].type, "underline");
    assert.equal(children[1].data?.hName, "u");
    assert.equal(children[1].children?.[0].value, "this");
    assert.equal(children[2].value, " and **that**");
  });

  it("accepts only http and https links", () => {
    assert.equal(safeHttpUrl("https://example.com/docs"), "https://example.com/docs");
    assert.equal(safeHttpUrl("javascript:alert(1)"), undefined);
    assert.equal(safeHttpUrl("data:text/html,hi"), undefined);
  });
});
