# Source and modifications

The quiz service and `src/client/quiz` are derived from [liyupi/yu-ai-learn](https://github.com/liyupi/yu-ai-learn), copyright 2026 liyupi, MIT licensed. The original license is retained as `services/quiz/LICENSE` and applies to these derived portions.

Imported on 2026-09-17 from the user's locally modified React/Vite migration, including its uncommitted continuous-document-content API and related tests. The source checkout's latest committed revision was `32c7c16`; this import therefore intentionally differs from upstream and that commit.

BetterLearn modifications include embedded React navigation and styling, an owned loopback service with private Host authentication, same-origin Host routes, internal knowledge-library extraction, installation integration and migration regression tests. BetterLearn's existing root license remains in place.

The later `app/services/choice_grading.py` and
`app/repositories/question_bank_repository.py` and `app/services/evidence_scoring.py`
additions adapt DeepTutor source under
Apache-2.0, separately from the MIT-derived portions above. Its license, source
revision and modifications are recorded in `third_party/DeepTutor/` and included
in standalone/desktop resources.

No upstream `.git`, virtual environments, generated bundles, API keys, upload files, or databases are part of this source import. Existing original project directory is preserved.
