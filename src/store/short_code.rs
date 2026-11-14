//! Five independent uniform Base62 symbols from OS-backed UUID v4 randomness.
const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
pub(super) const LENGTH: usize = 5;

fn symbol(byte: u8) -> Option<char> {
    // 248 = 4 * 62: each symbol has exactly four accepted preimages.
    (byte < 248).then(|| char::from(ALPHABET[usize::from(byte % 62)]))
}

pub(super) fn generate() -> String {
    let mut code = String::with_capacity(LENGTH);
    while code.len() < LENGTH {
        let entropy = uuid::Uuid::new_v4();
        // Only bytes 0..6: all are genuinely random, before the version byte
        // at offset 6 and the variant byte at offset 8. Never map fixed bits.
        for &byte in &entropy.as_bytes()[..6] {
            if let Some(c) = symbol(byte) {
                code.push(c);
                if code.len() == LENGTH {
                    break;
                }
            }
        }
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhaustive_byte_mapping_is_uniform_with_rejection_boundaries() {
        let mut counts = [0; 62];
        let mut rejected = 0;
        for byte in 0..=u8::MAX {
            match symbol(byte) {
                Some(c) => counts[ALPHABET.iter().position(|&b| char::from(b) == c).unwrap()] += 1,
                None => rejected += 1,
            }
        }
        assert_eq!(counts, [4; 62]);
        assert_eq!(rejected, 8);
        assert_eq!(symbol(0), Some('A'));
        assert_eq!(symbol(61), Some('9'));
        assert_eq!(symbol(62), Some('A'));
        assert_eq!(symbol(247), Some('9'));
        assert_eq!(symbol(248), None);
        assert_eq!(symbol(255), None);
    }

    #[test]
    fn thousand_generated_candidates_have_exact_base62_format() {
        for _ in 0..1000 {
            let code = generate();
            assert_eq!(code.len(), 5);
            assert!(code.bytes().all(|b| ALPHABET.contains(&b)));
        }
    }
}
