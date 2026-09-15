# Backend review blueprint

Task specification: `specs/backend-architecture-review.md` (#10967).

Preserve the existing local/PostgreSQL adapter design and first-party account gate. Establish evidence for logical account isolation separately from physical runtime isolation. Prefer targeted fixes backed by regression tests; leave production qualification explicitly outstanding wherever live configuration or real-service tests are unavailable.
