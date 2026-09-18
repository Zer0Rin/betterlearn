# Core review contract

RPC methods: `learning_reviews.queue` and `learning_reviews.submit`.
TypeScript types: src/product/types.ts LearningReviewQueue/Params/Result.
Python handlers: service.py list_learning_reviews/submit_learning_review.

Queue accepts only optional limit (integer 1–100, default 20), offset (integer
0–1000000, default 0), courseId (Core course ID). It returns items, total, limit,
offset, asOf (server UTC). Items identify unitId, knowledgePointId, courseId,
courseTitle, title, type, phase, dueAt, priority, expectedAttemptId, assessment,
remediation. Assessment contains assessmentId/kind/prompt/options/attempt:null;
it contains no correct option or previous answer. Only active courses are included.
Remediation is non-null only for a remediation task. Queue reads do not write.

Submit requires exactly unitId, assessmentId, optionId, expectedAttemptId,
idempotencyKey. Unit must match assessment; expectedAttemptId must identify the
latest persisted unit attempt. A mastered unit must be due. Responses retain the
ordinary attempt/course snapshot and add review:
phase (review/remediation), roundId, spaced (whether this is a spaced review
round), schedule {intervalIndex, consecutiveCorrect, consecutiveWrong}.
Initial remediation keeps spaced=false and one-day due time even after repeated
failure. Immediate remediation never advances the interval.

Idempotent replay returns the original snapshot before checking current state.
Changed request under the same key is IDEMPOTENCY_CONFLICT. Stale token, inactive
course or unavailable phase is LEARNING_STATE_CONFLICT. Both map to HTTP 409.
Invalid parameters/identifiers map to 400; missing course maps to 404.

HTTP GET /nobei/v1/learning-reviews uses the queue parameters as query strings;
duplicate/unknown query parameters are rejected.
POST /nobei/v1/learning-reviews/{unitId}/attempts passes unitId in the path and
the remaining four required fields in its JSON body. Both use existing Host
authorization/origin checks. No client-provided time or correctness is accepted.
