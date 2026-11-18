import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
const sizes = [16, 32, 48, 96, 128];

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function checkPNG(bytes, size) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  let offset = 8,
    header;
  const data = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset),
      name = bytes.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + 12 + length <= bytes.length);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      crc32(bytes.subarray(offset + 4, offset + 8 + length)),
      bytes.readUInt32BE(offset + 8 + length),
    );
    if (name === "IHDR") header = payload;
    if (name === "IDAT") data.push(payload);
    offset += 12 + length;
    if (name === "IEND") break;
  }
  assert.equal(offset, bytes.length);
  assert.equal(header.readUInt32BE(0), size);
  assert.equal(header.readUInt32BE(4), size);
  assert.equal(header[8], 8);
  assert.equal(header[9], 6, "RGBA PNG with an actual alpha channel");
  assert.equal(header[12], 0, "non-interlaced");
  const raw = inflateSync(Buffer.concat(data)),
    stride = size * 4;
  assert.equal(raw.length, size * (stride + 1));
  let cursor = 0,
    previous = Buffer.alloc(stride),
    painted = 0;
  for (let y = 0; y < size; y++) {
    const filter = raw[cursor++],
      row = Buffer.alloc(stride);
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0,
        b = previous[x],
        c = x >= 4 ? previous[x - 4] : 0;
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter];
      row[x] = (raw[cursor++] + predictor) & 255;
    }
    if (y === 0 || y === size - 1)
      assert.equal(row[3], 0, "transparent outer corners");
    for (let x = 3; x < stride; x += 4) if (row[x]) painted++;
    previous = row;
  }
  assert.ok(
    painted > size,
    "nonblank link glyph, not an empty transparent PNG",
  );
}

test("all packaged manifest and action icons are real transparent RGBA PNGs at declared sizes", async () => {
  for (const platform of ["chrome", "firefox", "safari"]) {
    const root = new URL(`../dist/${platform}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
    assert.deepEqual(Object.keys(manifest.icons ?? {}).map(Number), sizes);
    assert.deepEqual(manifest.action.default_icon, manifest.icons);
    for (const size of sizes)
      checkPNG(await readFile(new URL(manifest.icons[size], root)), size);
  }
});

test("AMO source archive contains reusable existing-app link SVG, generator and every PNG", async () => {
  const source = await readFile(
    new URL("../static/icons/shortener.svg", import.meta.url),
    "utf8",
  );
  assert.match(source, /M10 13a5 5/);
  assert.doesNotMatch(source, /<image|<text|href=/);
  execFileSync("python3", ["scripts/source-bundle.py"], {
    cwd: new URL("../", import.meta.url),
  });
  const files = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import zipfile,json; print(json.dumps(zipfile.ZipFile('dist/firefox-source.zip').namelist()))",
      ],
      { cwd: new URL("../", import.meta.url), encoding: "utf8" },
    ),
  );
  for (const name of [
    "extension/static/icons/shortener.svg",
    "extension/scripts/generate-icons.mjs",
    ...sizes.map((size) => `extension/static/icons/icon-${size}.png`),
  ])
    assert.ok(files.includes(name), name);
});
