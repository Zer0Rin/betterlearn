# Quiz / Core source association v1

Public Host:
GET /nobei/quiz/v1/question-bank/entries/{entryId}/source returns ApiResponse
data {source, source_revision}. New entry: null/0.

PUT same path takes exactly:
{"expected_revision":0,"source":{"courseId":"course_<20 hex>","unitId":"unit_<20 hex>"}}
or source:null to unlink. expected_revision is an integer 0..9007199254740990.
Unknown fields, browser snapshots, labels and hashes are rejected.
Source selection is explicit user attribution, not a claim of assessed mastery.

Host resolves the active Core course using existing learning_courses.get and
selects its frozen unit. It forwards to the private Quiz endpoint the same
expected_revision with the source snapshot shape in quiz-source-v1.json.
To replay a successful write after Core archive/deletion, Host first checks
the owned persisted mapping at expected_revision+1 and matching course/unit.
It reuses that snapshot but still sends PUT through Quiz's revision guard.

Snapshot schema_version=1 has course_id, unit_id, knowledge_point_id, type,
title, statement, evidence and content_version. content_version is SHA-256 of
UTF-8 canonical JSON of knowledge_point_id/type/title/statement/evidence only:
recursively sort object keys, no spaces, preserve Unicode. This is the exported
frozen unit's content version, NOT the current Core knowledge_points content_hash.
The shared JSON fixture includes quote evidence, Chinese, emoji and newline.

Private Quiz PUT requires loopback peer, managed Host secret and authenticated
owner; disabled without managed mode. It rechecks shape/hash and ownership.
Same expected revision writes atomically and increments source_revision.
Identical snapshot at expected+1 replays without increment. Other stale writes
409. Missing/foreign entry 404. Invalid Host input 400 / private model 422.
Missing Core course/unit 404; inactive course409; unavailable Core503.
Unlink does not require Core. Current mapping and submitted snapshots survive
Core edits/deletion. This is a point-in-time snapshot, not a cross-database FK.

Current source/source_revision are included in bank list/detail.
At trusted submission, question_bank_attempts captures current source and
revision in the score/XP transaction. History reads those frozen fields.
Old pre-v4 history has null/null (no captured mapping); v4 submissions that
have never been linked have null/0; unlinked submissions have null/positive.
Binding after submission never reattributes old scores. Resubmitting does not
refresh source. Changed question content has a separate entry/mapping.

Quiz schema4 adds question_bank_sources and two history columns. Upgrade
v1/v2/v3 backs up before the transaction; old data is not matched by labels.
No Core schema/RPC change, no model calls, no mastery writeback. Frontend source binding is available in question-bank detail; the browser sends only course/unit IDs and expected revision.
