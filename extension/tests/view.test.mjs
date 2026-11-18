import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { render } from "../compiled/extension/src/view.js";

test("ready title points to the short URL but clicking copies rich text instead of navigating", () => {
  const { window } = new JSDOM("<main></main>");
  const root = window.document.querySelector("main");
  let rich = 0,
    plain = 0;
  render(
    root,
    {
      kind: "ready",
      title: "<script>bad()</script>",
      url: "https://short.example/a",
      copied: false,
    },
    { copyText: () => plain++, copyRich: () => rich++, copyMarkdown: () => {} },
  );
  const title = root.querySelector("a");
  assert.ok(title, "title is a short-URL hyperlink");
  assert.equal(title.href, "https://short.example/a");
  assert.equal(title.textContent, "<script>bad()</script>");
  assert.equal(root.querySelector("script"), null);
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  title.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(rich, 1);
  assert.match(root.textContent, /Copy URL/);
  assert.equal(
    root.querySelector("button svg")?.getAttribute("viewBox"),
    "0 0 24 24",
    "copy action uses the current app Lucide icon",
  );
  root.querySelector("button").click();
  assert.equal(plain, 1);
  assert.match(root.textContent, /Automatic URL copy did not complete/i);
});

test("setup copy directs users to scoped access tokens rather than session cookies", () => {
  const document = new JSDOM('<main id="app"></main>').window.document;
  const root = document.querySelector("#app");
  render(
    root,
    { kind: "setup" },
    { copyText: () => {}, copyRich: () => {}, copyMarkdown: () => {} },
  );
  assert.match(root.textContent, /access token/);
  assert.doesNotMatch(root.textContent, /user session/);
});
