# runRepository.js INSERT off-by-one (pre-existing, carried through merge f01e01c)

Found during merge-reconciliation review of f01e01c (2026-09-30).

`insertAggregate` in `server/postgres/runRepository.js` builds an INSERT whose
column list, VALUES list, placeholder numbering and JS params array disagree:

At HEAD (f01e01c): 31 columns, 30 value expressions (max placeholder $28),
29-element params array. `security_authorization` has NO placeholder — the
trailing `securityAuthorization` param is unbound. Against real Postgres this
fails at parse ("INSERT has more target columns than expressions") — **run
creation is broken in QASE_RUN_STORE=postgres mode.**

Not a merge regression: the imbalance was introduced at merge 3f0d437 (paused_at
was the orphan then); both parents (affd691, af7c65c) each carried it forward
(off by one each) and f01e01c inherited it. Undetected because:
- this env runs `QASE_RUN_STORE=local`
- runRepository tests use a fake pool that never parses SQL

Fix (when taken): add `$29` for `security_authorization` in the VALUES clause.
Also worth an assertion in runRepository.test.js that
`placeholderCount === params.length` and `cols === value expressions`.
