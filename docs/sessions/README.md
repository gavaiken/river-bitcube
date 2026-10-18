---
title: Session progress files
---

# Session progress files

Each Claude session on bitcube keeps `docs/sessions/<letter>.md`. It writes one line per finished step, with time and commit, and pushes after every step. It ends with a SESSION SUMMARY. Session A (the coordinator on Gavin's Mac mini) reads these when Gavin says "sync". The format is in the Coordination contract in [the execution plan](../execution-plan.md).
