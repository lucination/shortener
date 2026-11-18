// Version.approval_notes TextField, inherited by DeveloperVersionSerializer.
// https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/versions/models.py#L309-L313
export const approvalNotesMaxLength=3000;

export class MetadataAdmissionError extends Error {
  constructor(code,actualLength) {
    super(code==="max_length"?`AMO version.approval_notes exceeds ${approvalNotesMaxLength} characters (${actualLength})`:"AMO version.approval_notes must be a primitive string");
    this.diagnostic={stage:"metadata-admission",fields:["version.approval_notes"],codes:[code],maxLength:approvalNotesMaxLength,...(actualLength===undefined?{}:{actualLength})};
  }
}

export function validateAmoMetadata(metadata) {
  const notes=metadata?.version?.approval_notes;
  if(typeof notes!=="string")throw new MetadataAdmissionError("invalid_type");
  // Django/Python counts Unicode code points, not UTF-16 units or UTF-8 bytes.
  // Do not trim, truncate or otherwise normalize the approved text.
  const count=Array.from(notes).length;
  if(count>approvalNotesMaxLength)throw new MetadataAdmissionError("max_length",count);
  return {approvalNotesCharacters:count,approvalNotesMaxLength};
}
