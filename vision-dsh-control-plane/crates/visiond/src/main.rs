use std::env;

fn main() {
    let bind = env::var("VISIOND_BIND").unwrap_or_else(|_| "127.0.0.1:8788".to_string());
    let db = env::var("VISIOND_DB").unwrap_or_else(|_| "visiond.db".to_string());
    eprintln!("visiond listening on http://{bind}, db={db}");
    if let Err(error) = visiond::serve(&bind, db) {
        eprintln!("visiond stopped: {error}");
        std::process::exit(1);
    }
}
