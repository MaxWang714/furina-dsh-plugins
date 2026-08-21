# ADR 0001: Independent Vision product

Status: accepted

Vision is a greenfield product under `Vision/product`. Material repositories remain read-only donors and references. The product identity, database schema, request lifecycle, metrics semantics and UI are new. Selective MIT reuse is allowed only with provenance and notices.

The first implementation is a single local control-plane process with one canonical Gateway and one deterministic Mock Provider. This keeps the vertical slice testable without requiring Go or a cloud service.
