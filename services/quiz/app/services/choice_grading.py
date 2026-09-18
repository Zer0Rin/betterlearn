"""Choice branch adapted from DeepTutor learning/grading.py (Apache-2.0).

Source revision: 31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f.
Modified for BetterLearn: only deterministic choice grading; compare lists as
sets for multiple choice, reject duplicate selections and empty answer keys.
See third_party/DeepTutor for the upstream license and provenance.
"""


def grade_choice(user_answer: list[str], expected_answer: list[str]) -> bool:
    user = [answer.strip().lower() for answer in user_answer]
    expected = [answer.strip().lower() for answer in expected_answer]
    if not expected or any(not answer for answer in expected):
        return False
    return len(user) == len(set(user)) and set(user) == set(expected)
