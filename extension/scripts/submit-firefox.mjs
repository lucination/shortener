import { readFileSync } from "node:fs";
import { JwtApiAuth } from "../node_modules/web-ext/lib/util/submit-addon.js";
import { releaseContext } from "./release-context.mjs";
import { createAmoReadOnlyGet } from "./amo-read.mjs";
import { assertFreshListing, assertHeldSubmission, verifySubmissionTree, runWebExtSign } from "./web-ext-release.mjs";
import { validateAmoMetadata, MetadataAdmissionError } from "./amo-metadata-policy.mjs";

let stage="admission";
try {
  const context=releaseContext();
  if(!context.ok){
    // Admission reasons are static local policy messages, never provider data.
    console.error(JSON.stringify({stage:"admission",reason:context.reason}));
    throw new Error("Release admission failed");
  }
  const tree=verifySubmissionTree(process.cwd());
  const metadata=JSON.parse(readFileSync("amo-metadata.json"));
  stage="metadata-admission";
  validateAmoMetadata(metadata);
  if(tree.guid!=="shortener-companion@shortener.invalid" || tree.version!==context.version || metadata.is_disabled!==true || "privacy_policy" in metadata)
    throw new Error("Official CLI listing inputs require the stable GUID, admitted version and developer hold");
  stage="preflight";
  const auth=new JwtApiAuth({apiKey:process.env.WEB_EXT_API_KEY,apiSecret:process.env.WEB_EXT_API_SECRET});
  const get=createAmoReadOnlyGet({token:()=>auth.signJWT()});
  const publisherId=await assertFreshListing(get,tree);
  stage="official-web-ext";
  // The pinned CLI owns ALL upload/create/source writes. No custom write adapter.
  const result=await runWebExtSign();
  console.log(JSON.stringify({tool:"web-ext",...result}));
  if(result.exitCode!==0 || result.truncated)throw new Error("Official CLI failed; outcome requires reconciliation");
  stage="held-readback";
  await assertHeldSubmission(get,{...tree,publisherId});
  console.log(JSON.stringify({version:context.version,channel:"listed",outcome:"submitted-developer-disabled",sourceAttached:true,privacyPolicyApplied:false,screenshotsApplied:false,manualDeveloperHubCompletionRequired:true,approvalOrPublicAvailabilityClaimed:false}));
} catch(error) {
  if(error instanceof MetadataAdmissionError)console.error(JSON.stringify(error.diagnostic));
  const status=error instanceof Error?/^AMO GET HTTP ([1-5]\d{2});/u.exec(error.message)?.[1]:undefined;
  console.error(JSON.stringify({stage,httpStatus:status?Number(status):null,outcome:"stopped",instruction:"Inspect sanitized CLI diagnostics and AMO uploads/add-on/version before any further write. No automatic resume or retry."}));
  process.exitCode=1;
}
