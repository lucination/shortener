import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function webExtSignArgs() {
  return ["sign", "--source-dir", "dist/firefox", "--channel", "listed", "--amo-metadata", "amo-metadata.json", "--upload-source-code", "dist/firefox-source.zip", "--approval-timeout", "0", "--timeout", "300000", "--artifacts-dir", "dist/amo-cli", "--no-config-discovery", "--no-input"];
}

export function cliEnvironment(env) {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"].filter(key => env[key] !== undefined).map(key => [key,env[key]]));
}

export async function assertFreshListing(get, { guid, version }) {
  if (guid !== "shortener-companion-v2@shortener.invalid")
    throw new Error("New-listing transaction requires the current stable GUID; no authenticated IO");
  const profile = await get("accounts/profile/");
  if (profile?.display_name !== "Aditya" || !Number.isSafeInteger(profile.id) || profile.id <= 0)
    throw new Error("Publisher mismatch; no CLI invocation");
  const base = `addons/addon/${encodeURIComponent(guid)}/`;
  if (await get(`${base}versions/${encodeURIComponent(version)}/`,true)) throw new Error("Version exists; stop without CLI invocation");
  if (await get(base,true)) throw new Error("GUID exists; new-listing transaction cannot update or take over a listing");
  return profile.id;
}

export async function assertHeldSubmission(get, { guid, version, publisherId }) {
  const base = `addons/addon/${encodeURIComponent(guid)}/`;
  const addon = await get(base);
  const observed = await get(`${base}versions/${encodeURIComponent(version)}/`);
  if (addon?.guid !== guid || addon.is_disabled !== true || !addon.authors?.some(a => a.id === publisherId && a.name === "Aditya") ||
      observed?.version !== version || observed.channel !== "listed" || typeof observed.source !== "string" || !observed.source)
    throw new Error("Official CLI returned but held listing/source readback is incomplete; inspect Developer Hub, do not retry");
}

export function verifySubmissionTree(cwd) {
  // sign rebuilds a ZIP. Bind its directory to every byte of the native-tested
  // archive, not to zip-dir's nondeterministic ZIP headers/order/compression.
  return JSON.parse(execFileSync("python3",["-c",`
import pathlib,zipfile,json,hashlib
root=pathlib.Path('dist/firefox'); z=zipfile.ZipFile('dist/firefox.zip')
assert root.is_dir()
names=[p for p in z.namelist() if not p.endswith('/')]
assert len(names)==len(set(names))
assert all(not pathlib.PurePosixPath(p).is_absolute() and '..' not in pathlib.PurePosixPath(p).parts for p in names)
assert not any(p.is_symlink() for p in root.rglob('*'))
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
assert actual==set(names), 'source tree/cache inventory differs from native-tested ZIP'
assert all((root/p).read_bytes()==z.read(p) for p in names), 'source tree bytes differ from native-tested ZIP'
m=json.loads(z.read('manifest.json'))
print(json.dumps({'files':len(names),'artifactSha256':hashlib.sha256(pathlib.Path('dist/firefox.zip').read_bytes()).hexdigest(),'guid':m['browser_specific_settings']['gecko']['id'],'version':m['version']}))
`],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
}

const safeFields = new Set(["name","summary","description","categories","firefox","android","version","upload","license","custom_license","source","approval_notes","is_disabled","default_locale","compatibility","min","max","platforms","supported_platforms","file","guid","id","status","channel","addon","slug","type","detail","non_field_errors","messages","errors","warnings"]);
const safeCodes = new Set(["required","invalid","invalid_choice","max_length","unique","MANIFEST_FIELD_INVALID","MANIFEST_FIELD_REQUIRED","MANIFEST_INVALID","DUPLICATE_ADDON_ID"]);
export function summarizeWebExtOutput(output, exitCode, { truncated = false } = {}) {
  const text = output.replace(/\u001b\[[0-9;]*m/gu, "");
  const stage = /Uploading source failed|Upload of source failed/u.test(text) ? "source" : /Submission failed/u.test(text) ? "submission" : /Validation failed/u.test(text) ? "validation" : /Upload failed/u.test(text) ? "upload" : exitCode === 0 ? "submitted" : "cli";
  const statusNames = {"Bad Request":400,"Unauthorized":401,"Forbidden":403,"Not Found":404,"Conflict":409,"Too Many Requests":429};
  const status = /(?:Upload failed|Submission failed \([12]\)|Patch request failed): (Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|[1-5]\d{2})(?:[.:\n]|$)/u.exec(text)?.[1];
  const fields = new Set(); const codes = new Set(); const messageClasses = new Set(); let unrecognizedCodes=false;
  function visit(value,path=[],depth=0) {
    if(depth>12)return;
    if(Array.isArray(value)){for(const item of value.slice(0,50))visit(item,path,depth+1);return;}
    if(value&&typeof value==="object"){
      if(typeof value.code==="string"&&safeCodes.has(value.code))codes.add(value.code);
      else if("code" in value)unrecognizedCodes=true;
      for(const [key,item] of Object.entries(value).slice(0,50)){
        if(key==="code"||key==="message"){if(key==="message")visit(item,path,depth+1);continue;}
        if(!safeFields.has(key))continue;
        const next=[...path,key];if(fields.size<128)fields.add(next.join("."));visit(item,next,depth+1);
      }
    }else if(typeof value==="string"){
      if(/valid choice/iu.test(value))messageClasses.add("invalid_choice");
      if(/no more than \d+ characters/iu.test(value))messageClasses.add("max_length");
      if(/required/iu.test(value))messageClasses.add("required");
      if(/already exists|already been used/iu.test(value))messageClasses.add("already_exists");
      if(/permission|authenticat|signature/iu.test(value))messageClasses.add("authorization");
      if(/invalid pk|does not exist|invalid.*reference/iu.test(value))messageClasses.add("invalid_reference");
      if(/unsupported.*file|invalid.*zip|corrupt/iu.test(value))messageClasses.add("invalid_archive");
    }
  }
  // Parse JSON objects only; never emit the raw stream or arbitrary field values.
  for(let start=text.indexOf("{");start!==-1;start=text.indexOf("{",start+1)){
    let level=0, quoted=false, escaped=false, end=-1;
    for(let i=start;i<text.length;i++){
      const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"')quoted=true;else if(c==="{")level++;else if(c==="}"&&--level===0){end=i;break;}
    }
    if(end===-1)break;
    try{visit(JSON.parse(text.slice(start,end+1)));}catch{}
    start=end;
  }
  return {exitCode,stage,httpStatus:status?(statusNames[status]??Number(status)):null,fields:[...fields].sort(),codes:[...codes].sort(),unrecognizedCodes,messageClasses:[...messageClasses].sort(),truncated};
}

// args is a test seam for the CLI's built-in loopback API override. The sole
// production caller supplies no args and uses webExtSignArgs() unchanged.
export function runWebExtSign({ cwd = process.cwd(), env = process.env, args = webExtSignArgs(), timeoutMs = 9*60*1000 } = {}) {
  const pkg=JSON.parse(readFileSync(join(cwd,"node_modules/web-ext/package.json")));
  if(pkg.version!=="10.8.0")throw new Error("Pinned web-ext 10.8.0 required");
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[join(cwd,"node_modules/web-ext/bin/web-ext.js"),...args],{cwd,env:cliEnvironment(env),stdio:["ignore","pipe","pipe"]});
    const chunks=[];let bytes=0,truncated=false,settled=false,stopping=false;
    let forceTimer;
    const stop=()=>{if(stopping||settled)return;stopping=true;child.kill("SIGTERM");forceTimer=setTimeout(()=>child.kill("SIGKILL"),2000);forceTimer.unref();};
    const timer=setTimeout(stop,timeoutMs);
    const collect=chunk=>{if(truncated)return;if(bytes+chunk.length>65536){truncated=true;stop();return;}bytes+=chunk.length;chunks.push(chunk);};
    child.stdout.on("data",collect);child.stderr.on("data",collect);
    const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(forceTimer);resolve(summarizeWebExtOutput(Buffer.concat(chunks).toString("utf8"),code,{truncated}));};
    child.once("error",()=>finish(null));child.once("close",finish);
  });
}
