# drytisTransport nonce flake (pre-existing, 2026-09-16)

`server/drytisTransport.js` outbound `deliver()` builds its nonce as
`randomBytes(24).toString('base64url')` and immediately validates it with
`boundedToken(..., TOKEN)` where `TOKEN = /^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/`.
base64url output can start with `-` or `_` (≈3.13% per call), so ~1 in 32
deliveries throws `invalid_signed_request` ("invalid nonce").

Test impact: `server/drytisTransport.test.js` "outbound client bounds payloads
and responses..." makes 4 deliver() calls → full-suite failure ≈1 in 8 runs
(465/466 flapping). Observed during #11273 verification; NOT caused by that
fix (that change touched qaTools/store/postgresServices/runResume/index only).

Runtime impact today: none while `QASE_DRYTIS_INTEGRATION_ENABLED=false`.

Known fix (was part of reverted commit 01591df "hex nonce", rolled back in the
Sep-15 bulk revert per user instruction): make createNonce hex, e.g.
`randomBytes(24).toString('hex')`. Do NOT re-apply silently — ask the user
first; it was inside a rollback scope once already.
