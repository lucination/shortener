import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(`${root}package.json`, "utf8"));
await rm(`${root}compiled`, { recursive: true, force: true });
await rm(`${root}dist`, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [`${root}node_modules/typescript/bin/tsc`, "-p", `${root}tsconfig.json`],
  { stdio: "inherit" },
);
const icons = Object.fromEntries(
  [16, 32, 48, 96, 128].map((size) => [size, `icons/icon-${size}.png`]),
);
const base = {
  manifest_version: 3,
  icons,
  name: "Shortener Companion",
  version,
  description:
    "Shorten the current page and copy its address or formatted title link.",
  permissions: ["activeTab", "storage", "clipboardWrite"],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  action: {
    default_popup: "popup.html",
    default_title: "Shorten this page",
    default_icon: icons,
  },
  commands: {
    _execute_action: {
      suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
    },
  },
  options_ui: { page: "settings.html", open_in_tab: true },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
  },
};
for (const platform of ["chrome", "firefox", "safari"]) {
  const target = `${root}dist/${platform}`;
  await mkdir(target, { recursive: true });
  for (const file of await readdir(`${root}compiled/extension/src`)) {
    if (file.endsWith(".js"))
      await cp(`${root}compiled/extension/src/${file}`, `${target}/${file}`);
  }
  await cp(`${root}static`, target, { recursive: true });
  await cp(
    `${root}../web/src/lib/styles/presentation.css`,
    `${target}/theme.css`,
  );
  const manifest =
    platform === "firefox"
      ? {
          ...base,
          browser_specific_settings: {
            gecko_android: { strict_min_version: "142.0" },
            gecko: {
              id: "shortener-companion-v2@shortener.invalid",
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: [
                  "browsingActivity",
                  "authenticationInfo",
                  "websiteContent",
                ],
              },
            },
          },
        }
      : base;
  await writeFile(
    `${target}/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  execFileSync("python3", [
    "-c",
    `import pathlib,zipfile,sys\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(str(p)+'.zip','w',compression=zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file():\n   i=zipfile.ZipInfo(str(f.relative_to(p)),(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,f.read_bytes())`,
    target,
  ]);
}
console.log(
  "Built dist/{chrome,firefox,safari} and deterministic ZIPs. Safari is converter input, not a signed app.",
);
