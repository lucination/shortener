import { readFileSync } from "node:fs";
import { validateAmoMetadata, MetadataAdmissionError } from "./amo-metadata-policy.mjs";
try { console.log(JSON.stringify(validateAmoMetadata(JSON.parse(readFileSync("amo-metadata.json"))))); }
catch(error) {
  console.error(JSON.stringify(error instanceof MetadataAdmissionError?error.diagnostic:{stage:"metadata-admission",codes:["invalid_json"]}));
  process.exitCode=1;
}
