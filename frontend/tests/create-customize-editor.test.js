const { test } = require("node:test");
const assert = require("node:assert/strict");
const markdown = require("../services/stored-markdown.js");
const assets = require("../services/asset-files.js");

test("rich text preview keeps headings, lists, emphasis, underline, and safe links", () => {
  const blocks = markdown.parseStoredMarkdown("## Hello\n\n- **bold** and ++line++\n\n1. [docs](https://example.com/docs)\n\n[bad](javascript:alert(1))");
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].type, "list");
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[1].items[0][0].type, "bold");
  assert.equal(blocks[1].items[0][2].type, "underline");
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].items[0][0].type, "link");
  assert.equal(blocks[2].items[0][0].href, "https://example.com/docs");
  assert.equal(blocks[3].children.some((node) => node.type === "link"), false);
});

test("upload checks reject another purpose, an oversized file, and a video", () => {
  assert.match(assets.validateAssetFile("portfolio-image", { size: 100, type: "image/png", name: "shot.png" }), /^$/);
  assert.match(assets.validateAssetFile("portfolio-image", { size: 6 * 1024 * 1024, type: "image/png", name: "shot.png" }), /too large/);
  assert.match(assets.validateAssetFile("portfolio-image", { size: 1000, type: "video/mp4", name: "clip.mp4" }), /not supported/);
  assert.match(assets.validateAssetFile("resume", { size: 1000, type: "image/png", name: "shot.png" }), /not supported/);
  assert.equal(assets.isPrivatePurpose("resume"), true);
  assert.equal(assets.isPrivatePurpose("portfolio-image"), false);
});
