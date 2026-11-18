// Only locally generated exact messages and booleans cross the public log boundary.
const localFailures = new Map([
  ["AMO GET token generation failed; stop and inspect access", "token_generation_failed"],
  ["AMO GET transport outcome unknown; stop and inspect access", "get_transport_failed"],
  ["AMO GET response unreadable or exceeds 1 MiB; reconcile, do not retry", "response_unreadable"],
  ["Invalid AMO API path", "api_path_invalid"],
  ["Invalid reconciliation version; no writes performed", "reconciliation_version_invalid"],
  ["Invalid AMO upload identity; reconcile, do not retry", "upload_identity_invalid"],
  ["GUID identity mismatch; no writes performed", "guid_identity_mismatch"],
  ["Unexpected add-on schema; no writes performed", "addon_schema_invalid"],
  ["GUID ownership mismatch; no writes performed", "guid_owned_by_other"],
  ["Unexpected add-on state; no writes performed", "addon_state_invalid"],
  ["Version identity/channel mismatch; no writes performed", "existing_version_mismatch"],
  ["Unexpected upload list schema; no writes performed", "upload_schema_invalid"],
  ["Unexpected upload channel; no writes performed", "upload_channel_invalid"],
  ["Unexpected upload status; no writes performed", "upload_status_invalid"],
  ["Unexpected upload version; no writes performed", "upload_version_invalid"],
  ["Unexpected upload pagination; no writes performed", "upload_pagination_invalid"],
  ["Upload inventory changed during reads; no writes performed", "upload_inventory_changed"],
  ["Repeated upload identity during pagination; no writes performed", "upload_identity_repeated"],
  ["Inconsistent upload inventory counts; no writes performed", "upload_counts_inconsistent"],
  ["Selected upload identity mismatch; no writes performed", "selected_upload_mismatch"],
  ["Version exists; stop without CLI invocation", "existing_version"],
  ["GUID exists; new-listing transaction cannot update or take over a listing", "existing_guid"],
  ["New-listing transaction requires the current stable GUID; no authenticated IO", "guid_not_admitted"],
  ["Official CLI returned but held listing/source readback is incomplete; inspect Developer Hub, do not retry", "held_readback_incomplete"],
]);

class PublisherAdmissionError extends Error {
  constructor(checks) {
    super("Approved publisher admission failed");
    this.checks = Object.freeze(checks);
  }
}

export function admitPublisher(profile) {
  const checks = {
    expectedNameMatches: profile?.display_name === "Aditya",
    publisherIdValid: Number.isSafeInteger(profile?.id) && profile.id > 0,
  };
  if (!checks.expectedNameMatches || !checks.publisherIdValid) throw new PublisherAdmissionError(checks);
  return checks;
}

export function amoFailureDiagnostic(error) {
  if (error instanceof PublisherAdmissionError) return {
    failureCode: error.checks.expectedNameMatches ? "publisher_id_invalid" : "publisher_display_name_mismatch",
    httpStatus: null,
    publisherChecks: { expectedNameMatches: error.checks.expectedNameMatches, publisherIdValid: error.checks.publisherIdValid },
  };
  const message = error instanceof Error ? error.message : "";
  const status = /^AMO GET HTTP ([1-5]\d{2}); stop and reconcile, do not retry$/u.exec(message)?.[1];
  return { failureCode: status ? "get_http_error" : localFailures.get(message) ?? "unknown", httpStatus: status ? Number(status) : null };
}
