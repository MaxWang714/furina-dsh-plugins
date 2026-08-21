use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: i64 = 1;

pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("unix:{secs}")
}

pub fn sha256(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

fn secret_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "authorization"
            | "cookie"
            | "x-api-key"
            | "api_key"
            | "apikey"
            | "access_token"
            | "refresh_token"
            | "token"
            | "credential"
            | "password"
            | "secret"
    )
}

pub fn redact(value: Value) -> Value {
    match value {
        Value::String(s) => {
            let mut out = s.replace("Bearer ", "Bearer [REDACTED]");
            for marker in ["sk-", "rk-", "ak-"] {
                if let Some(i) = out.find(marker) {
                    let end = out[i..]
                        .find(|c: char| c.is_whitespace() || c == ',' || c == '"')
                        .map(|x| i + x)
                        .unwrap_or(out.len());
                    out.replace_range(i..end, "[REDACTED]");
                }
            }
            Value::String(out)
        }
        Value::Array(a) => Value::Array(a.into_iter().map(redact).collect()),
        Value::Object(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        if secret_key(&k) {
                            Value::String("[REDACTED]".into())
                        } else {
                            redact(v)
                        },
                    )
                })
                .collect(),
        ),
        other => other,
    }
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observations(observation_id TEXT PRIMARY KEY, logical_request_id TEXT NOT NULL, source TEXT NOT NULL, confidence TEXT NOT NULL, captured_at TEXT NOT NULL, raw_schema_version TEXT NOT NULL, metrics_json TEXT NOT NULL, metadata_json TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, tokens_json TEXT NOT NULL, metrics_json TEXT NOT NULL, cost_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_observations_captured ON observations(captured_at DESC); CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC); INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, 'bootstrap'); COMMIT;")?;
        Ok(())
    }

    pub fn add_observation(&self, input: Value) -> rusqlite::Result<Value> {
        let clean = redact(input);
        let obj = clean
            .as_object()
            .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
        let get = |key: &str, default: &str| {
            obj.get(key)
                .and_then(Value::as_str)
                .unwrap_or(default)
                .to_string()
        };
        let clean_hash = sha256(&clean.to_string());
        let fallback_id = format!("obs_{}", &clean_hash[..16]);
        let obs_id = get("observation_id", &fallback_id);
        let logical = get("logical_request_id", "unknown");
        let source = get("source", "unknown");
        let confidence = get("confidence", "unknown");
        let captured = get("captured_at", &now_iso());
        let schema = get("raw_schema_version", "vision-observation-v1");
        let metrics = obj.get("metrics").cloned().unwrap_or_else(|| json!({}));
        let metadata = obj.get("metadata").cloned().unwrap_or_else(|| json!({}));
        let payload_hash = get("payload_hash", &sha256(&clean.to_string()));
        self.conn.execute("INSERT OR REPLACE INTO observations(observation_id,logical_request_id,source,confidence,captured_at,raw_schema_version,metrics_json,metadata_json,payload_hash,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?)", params![obs_id, logical, source, confidence, captured, schema, metrics.to_string(), metadata.to_string(), payload_hash, clean.to_string()])?;
        Ok(
            json!({"ok":true,"observation_id":obj.get("observation_id").and_then(Value::as_str).unwrap_or("stored"),"stored_id":obs_id,"redacted":true}),
        )
    }

    pub fn add_request(&self, input: Value) -> rusqlite::Result<Value> {
        let clean = redact(input);
        let obj = clean
            .as_object()
            .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
        let text = |k: &str| {
            obj.get(k)
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string()
        };
        let request_id = text("id");
        let trace_id = text("traceId");
        self.conn.execute("INSERT OR REPLACE INTO requests(request_id,trace_id,status,provider_id,model_id,tokens_json,metrics_json,cost_json,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", params![request_id, trace_id, text("status"), text("providerId"), text("modelId"), obj.get("tokens").unwrap_or(&Value::Null).to_string(), obj.get("metrics").unwrap_or(&Value::Null).to_string(), obj.get("cost").unwrap_or(&Value::Null).to_string(), clean.to_string(), now_iso()])?;
        Ok(json!({"ok":true,"request_id":request_id,"redacted":true}))
    }

    pub fn summary(&self) -> rusqlite::Result<Value> {
        let observations: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM observations", [], |r| r.get(0))?;
        let requests: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM requests", [], |r| r.get(0))?;
        let success: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM requests WHERE status='success'",
            [],
            |r| r.get(0),
        )?;
        Ok(
            json!({"schema_version":SCHEMA_VERSION,"observations":observations,"requests":requests,"success":success,"success_rate":if requests == 0 {0.0} else {success as f64 / requests as f64}}),
        )
    }

    pub fn requests(&self, limit: i64) -> rusqlite::Result<Value> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload_json FROM requests ORDER BY created_at DESC LIMIT ?")?;
        let rows = stmt.query_map([limit.clamp(1, 500)], |row| {
            let s: String = row.get(0)?;
            Ok(serde_json::from_str::<Value>(&s).unwrap_or(Value::Null))
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(Value::Array(out))
    }
}

fn response(status: u16, body: &Value) -> Vec<u8> {
    let text = body.to_string();
    format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", text.len(), text).into_bytes()
}

fn handle(mut stream: TcpStream, store: &Store) -> std::io::Result<()> {
    let mut buf = vec![0u8; 2 * 1024 * 1024];
    let n = stream.read(&mut buf)?;
    let raw = String::from_utf8_lossy(&buf[..n]);
    let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((&raw, ""));
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let value = match (method, path) {
        ("GET", "/health") => {
            json!({"ok":true,"service":"visiond","schema_version":SCHEMA_VERSION})
        }
        ("GET", "/api/summary") => store
            .summary()
            .unwrap_or_else(|e| json!({"ok":false,"error":e.to_string()})),
        ("GET", p) if p.starts_with("/api/requests") => store
            .requests(100)
            .unwrap_or_else(|e| json!({"ok":false,"error":e.to_string()})),
        ("POST", "/api/observations") => match serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| store.add_observation(v).ok())
        {
            Some(v) => v,
            None => json!({"ok":false,"error":"invalid observation"}),
        },
        ("POST", "/api/requests") => match serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| store.add_request(v).ok())
        {
            Some(v) => v,
            None => json!({"ok":false,"error":"invalid request"}),
        },
        _ => json!({"ok":false,"error":"not_found"}),
    };
    let status = if value.get("ok").and_then(Value::as_bool) == Some(false) {
        400
    } else if method == "GET"
        && path != "/health"
        && path != "/api/summary"
        && !path.starts_with("/api/requests")
    {
        404
    } else {
        200
    };
    stream.write_all(&response(status, &value))?;
    Ok(())
}

pub fn serve(bind: &str, db: impl AsRef<Path>) -> std::io::Result<()> {
    let store = Store::open(db).map_err(|e| std::io::Error::other(e.to_string()))?;
    let listener = TcpListener::bind(bind)?;
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let _ = handle(s, &store);
            }
            Err(e) => eprintln!("visiond accept error: {e}"),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_nested_secrets() {
        let v = redact(
            json!({"authorization":"Bearer sk-live","nested":{"api_key":"secret","text":"Bearer sk-test"}}),
        );
        assert!(!v.to_string().contains("sk-live"));
        assert_eq!(v["nested"]["api_key"], "[REDACTED]");
    }
    #[test]
    fn persists_and_summarizes() {
        let s = Store::open_memory().unwrap();
        s.add_observation(
            json!({"observation_id":"o1","logical_request_id":"l1","metadata":{"token":"x"}}),
        )
        .unwrap();
        assert_eq!(s.summary().unwrap()["observations"], 1);
    }
}
