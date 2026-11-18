import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as commonmark from "commonmark";
import { JSDOM } from "jsdom";
import { markdownLink } from "../compiled/extension/src/clipboard.js";

// Independent, exact-locked CommonMark implementation: test semantic results,
// not a second formatter or snapshots of generated Markdown source.
function parsedLink(title, destination) {
  const markdown = markdownLink(title, destination);
  const ast = new commonmark.Parser({ smart: false }).parse(markdown);
  const links = [];
  for (const walker = ast.walker(); ;) {
    const event = walker.next();
    if (!event) break;
    if (event.entering && event.node.type === "link") links.push(event.node);
    if (event.entering) assert.notEqual(event.node.type, "html_inline");
  }
  assert.equal(links.length, 1, "exactly one actual parsed Markdown link");
  const fragment = JSDOM.fragment(new commonmark.HtmlRenderer().render(ast));
  assert.equal(fragment.querySelectorAll("a").length, 1);
  assert.equal(fragment.querySelector("img,script"), null);
  return { astLink: links[0], element: fragment.querySelector("a") };
}

test("roundtrip oracle is exact-locked CommonMark 0.31.2 and development-only", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  );
  const installed = JSON.parse(
    await readFile(
      new URL("../node_modules/commonmark/package.json", import.meta.url),
    ),
  );
  assert.equal(pkg.devDependencies.commonmark, "0.31.2");
  assert.equal(pkg.dependencies?.commonmark, undefined);
  assert.equal(installed.version, "0.31.2");
});

const cases = [
  {
    name: "reported literal entities",
    title: "Literal &copy; &#x41; &amp;",
    url: "https://short.example/a?literal=&copy;",
  },
  {
    name: "named entities",
    title: "&copy; &amp; &lt; &gt; &quot; &apos;",
    url: "https://short.example/a?x=&amp;&y=&quot;",
  },
  {
    name: "numeric decimal entities",
    title: "&#65; &#169; &#00038;",
    url: "https://short.example/a?literal=&#65;",
  },
  {
    name: "numeric hex entities",
    title: "&#x41; &#X1F680; &#x0026;",
    url: "https://short.example/a?literal=&#x41;",
  },
  {
    name: "nested and unknown entities",
    title: "&amp;copy; &amp;#65; &notAnEntity;",
    url: "https://short.example/a?x=&amp;copy;&y=&notAnEntity;",
  },
  {
    name: "mixed Markdown escaping",
    title: String.raw`[label]\ &copy; *bold* <img>`,
    url: "https://short.example/a%28b%29?x=&copy;&y=&amp;",
  },
];
for (const fixture of cases) {
  test(`CommonMark preserves literal title: ${fixture.name}`, () => {
    const { astLink, element } = parsedLink(
      fixture.title,
      "https://short.example/a",
    );
    let text = "";
    for (let node = astLink.firstChild; node; node = node.next) {
      assert.equal(node.type, "text");
      text += node.literal;
    }
    assert.equal(
      text,
      fixture.title,
      "parser AST label preserves literal source text",
    );
    assert.equal(
      element.textContent,
      fixture.title,
      "rendered link text preserves literal source text",
    );
  });
  test(`CommonMark preserves exact destination: ${fixture.name}`, () => {
    const { astLink, element } = parsedLink("Literal title", fixture.url);
    assert.equal(
      astLink.destination,
      fixture.url,
      "parser destination never decodes a literal entity",
    );
    assert.equal(
      element.getAttribute("href"),
      fixture.url,
      "rendered href remains the exact original destination",
    );
  });
}

test("CommonMark mixed entity/newline/bracket/parenthesis handling retains established normalization", () => {
  const { element, astLink } = parsedLink(
    "A [B] \\ &copy;\r\n<note>",
    "https://short.example/a(b)?x=&copy;",
  );
  assert.equal(element.textContent, "A [B] \\ &copy; <note>");
  assert.equal(astLink.destination, "https://short.example/a%28b%29?x=&copy;");
  assert.equal(
    element.getAttribute("href"),
    "https://short.example/a%28b%29?x=&copy;",
  );
});
