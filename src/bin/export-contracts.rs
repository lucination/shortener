fn main() {
    let generated = shortener::dto::export_types().unwrap();
    let path = "contracts/bindings/index.ts";
    if std::env::args().any(|a| a == "--check") {
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            generated,
            "DTO drift: run cargo run --bin export-contracts"
        );
    } else {
        std::fs::create_dir_all("contracts/bindings").unwrap();
        std::fs::write(path, generated).unwrap();
    }
}
