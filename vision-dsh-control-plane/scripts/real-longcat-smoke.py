from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

ENGINEERING = Path(os.environ.get("TIANLI_ROOT", str(Path(__file__).resolve().parents[6]))) / "tianli-engineering"
sys.path.insert(0, str(ENGINEERING))
from tools.delegation.longcat_worker import endpoint, models, request_json  # noqa: E402

evidence = Path(os.environ.get("EVIDENCE_DIR", "evidence"))
evidence.mkdir(parents=True, exist_ok=True)
base = os.environ.get("LONGCAT_BASE_URL", "https://api.longcat.chat/openai")
result: dict[str, object] = {"schema_version": "1.0.0", "case_id": "longcat-real-smoke", "run_id": os.environ.get("VISION_RUN_ID", "unknown"), "trace_id": f"trace_longcat_real_{int(time.time())}", "real": True}
started = time.perf_counter()
try:
    available = models(base)
    selected = os.environ.get("LONGCAT_MODEL") or (available[0] if available else "")
    if selected not in available:
        raise RuntimeError("configured LongCat model was not returned by /v1/models")
    response = request_json(endpoint(base, "/chat/completions"), "POST", {"model": selected, "messages": [{"role": "user", "content": "Reply with one word: ping."}], "temperature": 0, "max_tokens": 8, "stream": False}, timeout=45)
    message = ((response.get("choices") or [{}])[0].get("message") or {})
    text = "".join(str(message.get(key) or "") for key in ("content", "reasoning_content"))
    result.update({"provider": "LongCat", "model": selected, "available_model_count": len(available), "response": {"characters": len(text), "sha256": hashlib.sha256(text.encode()).hexdigest(), "usage_keys": sorted((response.get("usage") or {}).keys())}, "verdict": "PASS_REAL_LONGCAT"})
except Exception as exc:  # evidence must preserve blocked/error state without secret text
    result.update({"verdict": "BLOCKED_OR_FAIL", "error": str(exc).replace("Bearer ", "Bearer [REDACTED] ")})
result["duration_ms"] = round((time.perf_counter() - started) * 1000)
result.update({"request": {"prompt": "[REDACTED]"}, "observation": {"status": "success" if str(result.get("verdict", "")).startswith("PASS") else "error"}, "storage": {"jsonl": str(evidence / "observations.jsonl"), "sqlite": None}, "replay": {"status": "not_applicable", "reason": "real response body not persisted"}, "review": {"human": "pending", "cross_model": "pending"}})
(evidence / "longcat-real.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({"verdict": result["verdict"], "model": result.get("model"), "duration_ms": result["duration_ms"], "error": result.get("error")}))
