// Match Rust str::trim and char::is_control; count Unicode scalar values,
// not UTF-16 code units. Surrogates cannot be represented by the Rust API.
export function parsePasskeyName(value: string): string | undefined {
  const name = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cs}]/u.test(name))
    return undefined;
  return name;
}
