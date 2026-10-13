// LET'S GUESS on the phone: where a person is in tonight's quiz, read from their own view.

/** From a view's `quiz`: null when there is none here, else how far they are and how they did. */
export function quizNow(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) return null;
  const answered = Array.isArray(quiz.answered) ? quiz.answered : [];
  const index = Math.min(answered.length, quiz.questions.length);
  return {
    total: quiz.questions.length,
    index,
    current: quiz.questions[index] ?? null,
    done: !!quiz.done,
    score: quiz.score ?? { right: 0, of: quiz.questions.length },
  };
}

/** A score as a list and a match show it: "3/5", or '' for none. */
export const scoreText = (s) => (s && Number.isInteger(s.right) && Number.isInteger(s.of) && s.of > 0 ? s.right + '/' + s.of : '');

/** How long a locked answer may go unheard, online, before the person may lock again. */
export const CHECK_MS = 5000;

/**
 * Whether a locked answer ({ index, at }) is still being checked. Until it lands; online, no longer than CHECK_MS:
 * a frame lost on a dying socket, or an answer refused, gets no view back, so the screen must not wait for one. A
 * second send of an answer already taken is refused and counts once. Offline the answer is queued, so it waits.
 */
export const checking = (locked, quiz, now, offline) => !!locked
  && (quiz?.answered?.length ?? 0) === locked.index
  && (offline || now - locked.at < CHECK_MS);
