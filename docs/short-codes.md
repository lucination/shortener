# Short codes and aliases

New links without a custom alias receive exactly **five case-sensitive Base62
characters**. The alphabet, in order, is
`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`. Generated codes
never contain `-` or `_`. This length is fixed, not configurable.

## Randomness and allocation

Candidates use the operating-system-backed randomness of UUID v4. Only the first
six bytes of each fresh UUID are sampled; these precede both its fixed version
bits (byte 6) and variant bits (byte 8). Bytes 248 through 255 are rejected.
Each remaining byte maps to the alphabet at `byte % 62`: the 248 accepted values
give each character exactly four preimages. Fresh bytes are sampled until five
characters have been collected. Byte rejection does not consume the candidate
retry budget. Tests enumerate every possible byte, including rejection boundaries;
they do not depend on statistical frequency or random uniqueness assertions.

Every candidate passes the existing `Alias` smart constructor. Reserved names,
including case variants of `admin`, `login`, `index`, and `fonts`, are resampled.
Successful allocations are therefore uniform among currently available,
non-reserved codes, rather than among reserved or already allocated names.

Allocation allows at most **32 candidates total**, counting both reserved names
and collisions. It runs inside the same SQLite `IMMEDIATE` transaction as owner
authorization, quota admission, and the single link insertion. Only a conflict
on `addresses(domain_id, short_code)` is ignored for retry; other SQL errors
propagate immediately. Addresses are permanent: collisions include those owned
by soft-deleted links. No address is overwritten or reused, and failed or
exhausted allocation rolls back the new link and address without consuming quota.
Exhaustion returns `unable to allocate a short code after 32 attempts`.

Allocation continues to use the initially configured domain (domain ID 1); this
does not add domain-management features. Uniqueness remains domain-scoped.

The namespace is finite and codes are public identifiers, **not authentication
secrets**. Secure randomness does not make a short public URL access control.

## Compatibility

- Existing addresses, including old ten-character generated codes, are unchanged.
  There is no migration or data rewrite.
- Custom aliases are unchanged: 1–64 ASCII alphanumeric, hyphen, or underscore
  characters, case-sensitive, with the same case-insensitive reserved-name check.
- A custom alias conflict keeps the existing SQLite uniqueness error and HTTP
  409 conflict response; it never silently generates a replacement. Failed custom
  creation also rolls back.
- Single and bulk creation keep their API shapes. Bulk creation continues to
  report success or failure per input row; only omitted aliases use this allocator.
