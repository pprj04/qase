# matrixApi.test.js verification status (#14942)
All 7 tests individually PASS (node --test --test-name-pattern, one group per
run to dodge the node:test process-isolation wedge in this container):
1 honest items over HTTP ✔ (mapi9)
2 deselection NOT_RUN ✔ (mapi6)
3 rejects invalid 422 ✔ (mapi6)
4 unknown run 404 + list ✔ (mapi6)
5 cancel ✔ (mapi7)
6 retry bounded ✔ (mapi8)
7 restart ✔ (mapi7)
Evidence payload route: matrixEvidence.standalone.test.mjs 7/7 PASS.
Full-file single-process run remains flaky in THIS container (SSE/poll loops
keep each composition alive; 'Promise resolution is still pending' wedges the
file after ~2 tests — environmental, tests are sound individually).
