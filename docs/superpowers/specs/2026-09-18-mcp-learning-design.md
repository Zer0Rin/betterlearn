# MCP learning bridge
Add 5 tools (12 total): list_learning_books, read_learning_course,
knowledge_stats, knowledge_history, generate_source_quiz (all betterlearn_).
First four readonly; source generation only after explicit user instruction,
uses own configured API and stable UUID. Course discovery reads LibraryStore
summaries then Core unit IDs, without arbitrary paths or frontend changes.
Stats use existing owned Quiz APIs and bounded query fields. No answer submit.

Use same durable MCP journal for both generation tools, with source generation
operation discriminator in digest; preserve legacy generation digests unchanged.
Same UUID across tools conflicts. Serialize both by ID. Journal dispatch intent
before POST, never retry unknown outcomes automatically. Resolve frozen source
using shared Host source adapter with private owned request lookup.
Existing Core deletion replay supported. Ambiguous outcome remains conservative,
even though source backend has its own deduplication. No schema migration.

Ports expose typed library/course reads. MCP source input never includes snapshot,
image setting or arbitrary URL. Host resolves trusted snapshot; image=false.
Skill/plugin docs explain exact-content statistics and historic version semantics.
Validate real stdio discovery/reads/generation/replay with fake provider, conflicts,
durable restart/uncertainty, no keys and no additional read-triggered calls.
