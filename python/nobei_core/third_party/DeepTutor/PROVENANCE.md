# DeepTutor scheduling adaptation

Upstream: HKUDS/DeepTutor, revision 31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f.
Source: deeptutor/learning/scheduler.py (Apache-2.0; full license alongside).
Adapted in ../../learning_schedule.py: interval tables, correct/wrong transitions,
streak resets and bounds. Queue priorities follow the upstream scheduler.
BetterLearn changes: Core knowledge types, explicit immutable state inputs,
UTC time supplied by the caller, at least one day for memory, no debug environment
switch, immediate remediation does not advance the spaced interval.
No DeepTutor agent runtime, model configuration or user data is imported.
