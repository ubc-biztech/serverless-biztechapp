# AGENTS.md

- Prefer the simplest stored shape that represents the feature. Keep related data together instead of duplicating metadata and reconstructing it later.
- Document non-obvious persisted shapes and response keys beside their types with a short example.
- Validate incoming data at the persistence boundary. Reuse normalized values downstream rather than repeating fallback checks.
- Keep validation readable: use short guards and specific errors instead of a large condition mixing unrelated rules.
- Follow the existing test runner and CI conventions. Do not add standalone test files that no maintained command runs; keep one-off verification outside the PR.
- Keep review fixes scoped to the feature. Do not introduce service-wide infrastructure to justify a small change.
