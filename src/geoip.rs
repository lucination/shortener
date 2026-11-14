//! Optional local MMDB observation. Never downloads databases or guesses location.
use std::{path::Path, sync::Arc};
#[derive(Clone, Default)]
pub struct GeoIp(Option<Arc<maxminddb::Reader<Vec<u8>>>>);
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Location {
    pub country: Option<String>,
    pub city: Option<String>,
}
impl GeoIp {
    pub fn open(path: Option<&Path>) -> Result<Self, String> {
        path.map(|path| {
            maxminddb::Reader::open_readfile(path)
                .map(|r| Self(Some(Arc::new(r))))
                .map_err(|e| format!("unable to load GEOIP_MMDB: {e}"))
        })
        .unwrap_or_else(|| Ok(Self::default()))
    }
    pub fn lookup(&self, ip: &str) -> Location {
        let Some(reader) = &self.0 else {
            return Location::default();
        };
        let Ok(ip) = ip.parse() else {
            return Location::default();
        };
        let Ok(result) = reader.lookup(ip) else {
            return Location::default();
        };
        let Ok(Some(record)) = result.decode::<maxminddb::geoip2::City>() else {
            return Location::default();
        };
        Location {
            country: record.country.iso_code.map(str::to_owned),
            city: record.city.names.english.map(str::to_owned),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_database_never_invents_a_location() {
        assert_eq!(GeoIp::default().lookup("81.2.69.160"), Location::default());
        assert!(GeoIp::open(Some(Path::new("/no-such-mmdb"))).is_err());
    }
    #[test]
    fn configured_database_reads_actual_city_and_country_records() {
        let db = GeoIp::open(Some(Path::new("tests/data/GeoIP2-City-Test.mmdb"))).unwrap();
        let location = db.lookup("81.2.69.160");
        assert_eq!(location.country.as_deref(), Some("GB"));
        assert_eq!(location.city.as_deref(), Some("London"));
        assert_eq!(db.lookup("not an IP"), Location::default());
        assert_eq!(db.lookup("127.0.0.1"), Location::default());
    }
}
