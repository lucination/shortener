import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, symlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
const implementation = await import("../scripts/web-ext-release.mjs").catch(() => ({}));
const root = fileURLToPath(new URL("../", import.meta.url));
const guid = "shortener-companion@shortener.invalid";

test("release delegates writes to the pinned official CLI with explicit listed/source/metadata arguments", () => {
  assert.equal(typeof implementation.webExtSignArgs, "function");
  const args = implementation.webExtSignArgs();
  assert.deepEqual(args, ["sign", "--source-dir", "dist/firefox", "--channel", "listed", "--amo-metadata", "amo-metadata.json", "--upload-source-code", "dist/firefox-source.zip", "--approval-timeout", "0", "--timeout", "300000", "--artifacts-dir", "dist/amo-cli", "--no-config-discovery", "--no-input"]);
  assert.equal(args.includes("--api-key"), false);
  assert.equal(args.includes("--api-secret"), false);
});

test("release preflight refuses existing GUID/version or wrong publisher before CLI delegation", async () => {
  assert.equal(typeof implementation.assertFreshListing,"function");
  for (const block of ["publisher","version","guid"]) {
    const calls=[];
    const get=async path=>{calls.push(path); if(path==="accounts/profile/")return{id:7,display_name:block==="publisher"?"Other":"Aditya"};return path.includes("versions/")?(block==="version"?{}:null):(block==="guid"?{}:null);};
    await assert.rejects(()=>implementation.assertFreshListing(get,{guid,version:"0.1.2"}));
    assert.ok(calls.length<=3);
  }
});

test("CLI environment excludes injected configuration, node hooks, proxies and verbosity",()=>{
  assert.equal(typeof implementation.cliEnvironment,"function");
  const env=implementation.cliEnvironment({PATH:"/usr/bin",HOME:"fixture-home",WEB_EXT_API_KEY:"fixture-key",WEB_EXT_API_SECRET:"fixture-secret",WEB_EXT_AMO_BASE_URL:"https://attacker.invalid",WEB_EXT_VERBOSE:"1",NODE_OPTIONS:"--import evil",HTTPS_PROXY:"https://attacker.invalid"});
  assert.deepEqual(Object.keys(env).sort(),["HOME","PATH","WEB_EXT_API_KEY","WEB_EXT_API_SECRET"].sort());
});

test("official failure diagnostics retain stage, field paths and known error codes but no raw values",()=>{
  assert.equal(typeof implementation.summarizeWebExtOutput,"function");
  const report=implementation.summarizeWebExtOutput('Submission failed (2): Bad Request\n{"version":{"license":[{"code":"invalid_choice","message":"Select a valid choice. private@example.invalid secret-value JWT private-jwt"}]},"private@example.invalid":["private"]}',1);
  assert.equal(report.stage,"submission");assert.equal(report.httpStatus,400);
  assert.ok(report.fields.includes("version.license"));assert.ok(report.codes.includes("invalid_choice"));
  assert.doesNotMatch(JSON.stringify(report),/private@|secret-value|private-jwt|JWT/);
});

test("held readback requires owner, exact listed version and attached source; no enabling write exists",async()=>{
  const addon={guid,is_disabled:true,authors:[{id:7,name:"Aditya"}]};
  const version={version:"0.1.2",channel:"listed",source:"https://addons.mozilla.org/source.zip"};
  await implementation.assertHeldSubmission(async path=>path.includes("versions/")?version:addon,{guid,version:"0.1.2",publisherId:7});
  for(const [a,v] of [[{...addon,is_disabled:false},version],[addon,{...version,source:""}],[{...addon,authors:[]},version],[addon,{...version,version:"0.1.1"}]])
    await assert.rejects(()=>implementation.assertHeldSubmission(async path=>path.includes("versions/")?v:a,{guid,version:"0.1.2",publisherId:7}));
});

test("truncated, malformed and credential-shaped CLI text never becomes public diagnostics",()=>{
  const report=implementation.summarizeWebExtOutput('{'.repeat(65536),null,{truncated:true});
  assert.equal(report.truncated,true);assert.deepEqual(report.fields,[]);
  assert.doesNotMatch(JSON.stringify(implementation.summarizeWebExtOutput('Upload failed: Unauthorized\n{"detail":"JWT private-jwt private@example.invalid","unknown-personal-field":"secret"}',1)),/private@|private-jwt|secret|unknown-personal/);
});

async function fixture() {
  await mkdir(join(homedir(),".cache"),{recursive:true});
  const dir=await mkdtemp(join(homedir(),".cache","web-ext-contract-"));
  await symlink(join(root,"node_modules"),join(dir,"node_modules"),"dir");
  await mkdir(join(dir,"dist"));
  await cp(join(root,"dist/firefox"),join(dir,"dist/firefox"),{recursive:true});
  await cp(join(root,"dist/firefox.zip"),join(dir,"dist/firefox.zip"));
  execFileSync("python3",["scripts/source-bundle.py"],{cwd:root});
  await cp(join(root,"dist/firefox-source.zip"),join(dir,"dist/firefox-source.zip"));
  await cp(join(root,"amo-metadata.json"),join(dir,"amo-metadata.json"));
  return dir;
}
function zipFiles(bytes) {
  return JSON.parse(execFileSync("python3",["-c",'import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({p:hashlib.sha256(z.read(p)).hexdigest() for p in z.namelist() if not p.endswith("/")}))'],{input:bytes,encoding:"utf8"}));
}

test("source tree must exactly match the native-receipt ZIP and reject cached upload IDs",async()=>{
  assert.equal(typeof implementation.verifySubmissionTree,"function");
  const dir=await fixture();
  try {
    implementation.verifySubmissionTree(dir);
    await writeFile(join(dir,"dist/firefox/.amo-upload-uuid"),"not-a-real-upload");
    assert.throws(()=>implementation.verifySubmissionTree(dir));
    await rm(join(dir,"dist/firefox/.amo-upload-uuid"));
    await writeFile(join(dir,"dist/firefox/popup.js"),"changed");
    assert.throws(()=>implementation.verifySubmissionTree(dir));
  }finally{await rm(dir,{recursive:true,force:true});}
});

for(const fail of ["none","submission","validation","source","approval-max-minus","approval-max","approval-max-plus"]) test(`actual pinned CLI against loopback contract fixture: ${fail}`,{timeout:30000},async()=>{
  const metadata=JSON.parse(await readFile(join(root,"amo-metadata.json"),"utf8"));
  assert.equal(metadata.is_disabled,true,"official metadata must hold listing until Developer Hub privacy/media completion");
  assert.equal(metadata.privacy_policy,undefined,"unsupported policy must live in explicit manual-completion asset");
  const dir=await fixture();const calls=[];const errors=[];let uploaded;
  const boundary={"approval-max-minus":2999,"approval-max":3000,"approval-max-plus":3001}[fail];
  if(boundary!==undefined){
    // Deliberately bypass the local publisher admission only in this loopback
    // contract to exercise the real CLI at the executed provider-field boundary.
    metadata.version.approval_notes="x".repeat(boundary);
    await writeFile(join(dir,"amo-metadata.json"),JSON.stringify(metadata));
  }
  const success=["none","approval-max-minus","approval-max"].includes(fail);
  const uploadId="00000000000040008000000000000000"; // Synthetic contract fixture, not a live AMO response.
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
      const path=decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname);calls.push([req.method,path]);
      assert.match(req.headers.authorization,/^JWT /);
      res.setHeader("Content-Type","application/json");
      if(req.method==="POST"&&path==="/api/v5/addons/upload/"){
        const form=await new Request("http://127.0.0.1",{method:"POST",headers:req.headers,body:bytes}).formData();
        assert.equal(form.get("channel"),"listed");uploaded=Buffer.from(await form.get("upload").arrayBuffer());
        res.writeHead(201);res.end(JSON.stringify({uuid:uploadId}));
      }else if(req.method==="GET"&&path===`/api/v5/addons/upload/${uploadId}/`){res.end(JSON.stringify({uuid:uploadId,processed:true,valid:fail!=="validation",validation:{errors:fail==="validation"?1:0,messages:fail==="validation"?[{code:"MANIFEST_FIELD_INVALID",message:"private@example.invalid fixture-secret"}]:[]}}));}
      else if(req.method==="PUT"&&path===`/api/v5/addons/addon/${guid}/`){
        const data=JSON.parse(bytes);assert.deepEqual(data,{...metadata,version:{upload:uploadId,...metadata.version}});
        // Limit and serialized error text independently observed from the
        // pinned provider model/mixin/get_fields with Django 5.2.19 / DRF 3.18.3.
        // This is a provider-derived fixture, never a claimed live response.
        if(Array.from(data.version.approval_notes).length>3000){res.writeHead(400);res.end(JSON.stringify({version:{approval_notes:["Ensure this field has no more than 3000 characters."]}}));}
        else if(fail==="submission"){res.writeHead(400);res.end(JSON.stringify({categories:{firefox:[{code:"invalid_choice",message:"Select a valid choice. private@example.invalid fixture-secret"}]}}));}
        else{res.end(JSON.stringify({guid,is_disabled:true,version:{id:17,edit_url:"https://addons.mozilla.org/developers/"}}));}
      }else if(req.method==="PATCH"&&path===`/api/v5/addons/addon/${guid}/versions/17/`){
        const form=await new Request("http://127.0.0.1",{method:"PATCH",headers:req.headers,body:bytes}).formData();
        assert.deepEqual(Buffer.from(await form.get("source").arrayBuffer()),await readFile(join(dir,"dist/firefox-source.zip")));
        if(fail==="source"){res.writeHead(400);res.end(JSON.stringify({source:["Unsupported file type private@example.invalid fixture-secret"]}));}else res.end("{}");
      }else{throw new Error("Unexpected contract request");}
    }catch(error){errors.push(error.message);res.writeHead(500);res.end("{}");}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const args=[...implementation.webExtSignArgs(),"--amo-base-url",`http://127.0.0.1:${server.address().port}/api/v5/`];
    const report=await implementation.runWebExtSign({cwd:dir,args,timeoutMs:15000,env:{...process.env,WEB_EXT_API_KEY:"fixture-key",WEB_EXT_API_SECRET:"fixture-secret"}});
    assert.deepEqual(errors,[]);assert.equal(report.exitCode,success?0:1);
    assert.deepEqual(zipFiles(uploaded),zipFiles(await readFile(join(dir,"dist/firefox.zip"))),"official repack must contain the exact native-tested file bytes (ZIP container differs)");
    assert.equal(calls.filter(([m])=>m==="POST").length,1);
    assert.equal(calls.filter(([m])=>m==="PUT").length,fail==="validation"?0:1);
    assert.equal(calls.length,{none:4,submission:3,validation:2,source:4,"approval-max-minus":4,"approval-max":4,"approval-max-plus":3}[fail]);
    if(!success){
      assert.equal(report.stage,fail==="approval-max-plus"?"submission":fail);assert.equal(report.httpStatus,fail==="validation"?null:400);
      if(fail==="approval-max-plus"){
        assert.deepEqual(report.fields,["version","version.approval_notes"]);
        assert.ok(report.messageClasses.includes("max_length"));assert.equal(report.truncated,false);
      }
      if(fail==="submission"){assert.ok(report.fields.includes("categories.firefox"));assert.ok(report.codes.includes("invalid_choice"));}
      if(fail==="validation")assert.ok(report.codes.includes("MANIFEST_FIELD_INVALID"));
      if(fail==="source"){assert.ok(report.fields.includes("source"));assert.ok(report.messageClasses.includes("invalid_archive"));}
      assert.doesNotMatch(JSON.stringify(report),/private@|fixture-secret|fixture-key/);
    }
    assert.equal(JSON.parse(readFileSync(join(root,"node_modules/web-ext/package.json"))).version,"10.8.0");
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
