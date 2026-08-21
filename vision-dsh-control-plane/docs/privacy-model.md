# Privacy model

Normal mode stores metrics, hashes, IDs and sanitized errors; it never stores full prompts/responses or credentials. Privacy mode hashes or omits additional identifiers. Debug mode is opt-in and must carry a 24h/7d/30d retention setting. Redaction happens before persistence, not only in the UI. `/api/privacy` persists this mode in `settings`; the Gateway never writes raw Authorization, Cookie, API key, OAuth token, prompt, or response bodies into the ordinary request tables.
