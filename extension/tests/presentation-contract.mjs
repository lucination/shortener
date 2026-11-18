import assert from "node:assert/strict";

// Executes in the actual extension view (or rendered reference app), never a clone.
export function measurePresentation(win = window) {
  const doc = win.document;
  const style = (e) => win.getComputedStyle(e);
  const body = style(doc.body);
  const probe = doc.createElement("span");
  probe.style.cssText =
    "position:fixed;visibility:hidden;background:var(--dl-bg);color:var(--dl-text);border:1px solid var(--dl-line)";
  doc.body.append(probe);
  const reference = style(probe);
  const palette = {
    background: reference.backgroundColor,
    text: reference.color,
    border: reference.borderTopColor,
  };
  probe.style.borderTopColor = "var(--dl-primary)";
  palette.primary = style(probe).borderTopColor;
  probe.remove();
  const header = doc.querySelector("header");
  return {
    font: body.fontFamily,
    size: body.fontSize,
    background: body.backgroundColor,
    text: body.color,
    palette,
    viewport: win.innerWidth,
    scrollWidth: doc.documentElement.scrollWidth,
    header: header
      ? {
          border: style(header).borderBottomStyle,
          width: style(header).borderBottomWidth,
          color: style(header).borderBottomColor,
        }
      : null,
    controls: [...doc.querySelectorAll("button,input")].map((e) => {
      const s = style(e),
        r = e.getBoundingClientRect();
      return {
        font: s.fontFamily,
        size: s.fontSize,
        radius: s.borderRadius,
        border: s.borderTopStyle,
        borderWidth: s.borderTopWidth,
        borderColor: s.borderTopColor,
        primary: e.classList.contains("primary"),
        hovered: e.matches(":hover") && !e.disabled,
        height: r.height,
        left: r.left,
        right: r.right,
        width: r.width,
      };
    }),
    icons: [...doc.querySelectorAll("svg")].map((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    })),
  };
}

export function assertPresentation(m) {
  assert.match(m.font, /system-ui/);
  assert.doesNotMatch(m.font, /mono/i);
  assert.equal(m.size, "13px");
  assert.equal(
    m.background,
    m.palette.background,
    "body uses the current app theme surface",
  );
  assert.equal(m.text, m.palette.text);
  assert.ok(m.scrollWidth <= m.viewport, "no horizontal document overflow");
  assert.equal(m.header.border, "solid");
  assert.equal(m.header.width, "1px", "not the obsolete double rule");
  assert.equal(m.header.color, m.palette.border);
  assert.ok(m.controls.length > 0);
  for (const c of m.controls) {
    assert.match(c.font, /system-ui/);
    assert.equal(c.size, "12px");
    assert.equal(c.radius, "4px");
    assert.equal(c.border, "solid");
    assert.equal(c.borderWidth, "1px");
    assert.equal(
      c.borderColor,
      c.primary || c.hovered ? m.palette.primary : m.palette.border,
    );
    assert.ok(Math.abs(c.height - 28) < 0.6, "current app control height");
    assert.ok(
      c.width > 0 && c.left >= -0.5 && c.right <= m.viewport + 0.5,
      "controls remain in viewport",
    );
  }
  assert.ok(m.icons.length > 0);
  for (const i of m.icons)
    assert.ok([14, 16].includes(i.width) && i.height === i.width);
}
