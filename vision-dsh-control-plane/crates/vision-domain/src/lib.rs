use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TokenQuality {
    Exact,
    Complete,
    Partial,
    Inconsistent,
    Estimated,
    Unknown,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Timing {
    pub ttfb_ms: Option<u64>,
    pub ttft_ms: Option<u64>,
    pub generation_ms: Option<u64>,
    pub duration_ms: Option<u64>,
}
