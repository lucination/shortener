import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
export function assertRequest(request, expected) {
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/api/links");
  assert.equal(request.body.destination, expected.destination);
  assert.equal(request.body.title, expected.title);
  assert.equal(request.authorization, `Bearer ${expected.token}`);
  assert.equal(request.cookie, undefined);
  assert.equal(request.body.alias, null);
}
export function assertClipboard(plain, html, expected) {
  assert.equal(plain, expected.url, "text/plain must contain ONLY short URL");
  const dom = new JSDOM(html);
  const anchors = dom.window.document.querySelectorAll("a");
  try {
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].getAttribute("href"), expected.url);
    assert.equal(anchors[0].textContent, expected.title);
    assert.equal(dom.window.document.body.textContent.trim(), expected.title);
  } finally {
    dom.window.close();
  }
}

export function nativeEnvironment(environment) {
  return { ...environment, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" };
}
export function screenPoint(box) {
  for (const key of ["x", "y", "width", "height", "screenX", "screenY"])
    assert.equal(
      Number.isFinite(box[key]),
      true,
      "Native control geometry must be finite",
    );
  assert.ok(
    box.width > 0 && box.height > 0,
    "Native control must be visible, not display:contents",
  );
  return {
    x: Math.round(box.screenX + box.x + box.width / 2),
    y: Math.round(box.screenY + box.y + box.height / 2),
  };
}
