/** Browser capability boundary. Success means the actual write has settled. */
export type CopyAddress = (address: string) => Promise<void>;
export const copyAddress: CopyAddress = (address) =>
  navigator.clipboard.writeText(address);
