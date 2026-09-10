#!/bin/bash
# Phase 16 benchmark app servers (ports 9901–9905) — run under procmgr so
# they survive container pauses. Wrapper around scripts/serve-benchmarks.py.
exec python3 /workspace/scripts/serve-benchmarks.py
