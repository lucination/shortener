import type { Resource, EditorMode, PublicView, LinkRow } from "./view-models";
// Negative type probes are supplemental to runtime parser and interaction tests.
const loadingWithData: Resource<readonly LinkRow[]> = {
  kind: "pending",
  // @ts-expect-error A pending resource cannot carry previously-ready data.
  value: [],
};
// @ts-expect-error An edit capability requires its durable link ID.
const editWithoutIdentity: EditorMode = { kind: "edit" };
const protectedDestination: PublicView = {
  kind: "password",
  password: "",
  // @ts-expect-error Protected presentation cannot receive a destination to leak.
  destination: "https://example.org",
};
void loadingWithData;
void editWithoutIdentity;
void protectedDestination;
