# DeepTutor source attribution

Source: user's local `/Users/guyue/Documents/code/DeepTutor` checkout,
revision `31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f`.
The inspected `deeptutor/learning` files had no working-tree modifications.
Imported on 2026-09-18. The upstream Apache-2.0 license is retained in LICENSE
in this directory; no upstream NOTICE file was found in the checkout.

`app/services/choice_grading.py` adapts the choice branch of
`deeptutor/learning/grading.py::grade_answer`. Changes: list input and unordered
multiple-choice comparison, duplicate-selection rejection, empty-key rejection;
short-answer similarity, open-answer keyword heuristics and error classification
were not imported. BetterLearn additionally validates complete submissions and
loads owned questions from SQLite before this grader runs.

No DeepTutor server, agents, session runtime or model configuration is required
at runtime. Adapted query code is listed below.

2026-09-18 question-bank addition: `app/repositories/question_bank_repository.py`
adapts `_escape_like`, `_question_bank_filters`, `_load_categories_for`, paginated
list/count, stats, and category association SQL from
`deeptutor/services/session/sqlite_store.py` at the same revision (file checked
without local modifications). Changes: user-scoped ownership, question content
versions, separate immutable attempt history, wrong/ever-wrong scopes, strict
pagination, bookmark-only entry updates, and Unicode casefold category keys.
Client-controlled answers/verdicts and the session runtime are not imported.
The projection and migration modules are BetterLearn-specific transaction adapters.

2026-09-18 knowledge-assessment addition: `app/services/evidence_scoring.py`
adapts `deeptutor/learning/mastery.py::compute_mastery` at the same revision
(file checked without local modifications). Recency weights, last-five window
and one/two-sample caps are unchanged. Changes: function renamed to evidence
score, cap/window/policy metadata exposed. BetterLearn's repository supplies
only first trusted answers per exact content and historical knowledge version;
empty API evidence is null, not zero. The score is not a mastery gate or
calibrated confidence estimate. Upstream policy.py thresholds, qualitative
assessment, progress writes and runtime were not imported.

## Self-exam integration (2026-09-18)

`app/repositories/exam_repository.py` also calls the attributed `grade_choice`
adaptation. Paper allocation, coverage review, timed sessions, schema7 and
post-submit projection are BetterLearn implementations. Rechecked upstream
`deeptutor/tools/question/exam_mimic.py`: a generation coordinator wrapper, not
an upstream timed-exam state machine. No additional upstream code was copied.

## Shared frontend organization (2026-09-18)

`src/client/quiz/components/BankCategoryManager.tsx` adapts the create/rename,
IME-aware Enter and busy-state patterns from upstream
`web/components/space/question-bank/CategoryManager.tsx` at the same revision
(file checked without local modifications). Changes: BetterLearn API types,
Chinese copy, existing CSS, inline delete confirmation, no i18n/Tailwind imports.
The rest of the bank/review frontend uses BetterLearn-specific HTTP and persisted
request handling. This directory's Apache-2.0 LICENSE accompanies the bundled
shared frontend through the existing standalone packaging process.
