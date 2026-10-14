# LET'S GUESS, the fourth card: design

13 Oct 2026. From `main` 92d6a22, on branch `lets-guess`.

## Why

The team's v3 flow adds a music quiz. The first night it will run on is a
Zara Larsson show. He chose to make the quiz a card like the other three,
not an activity after a match: you arm LET'S GUESS, answer tonight's questions
on your own, and then find a teammate among the people who also finished. A
team-up each way is a match, and from there everything is what the other
cards already do (names, the meeting number, the meeting spot, found, keep).

The design proposal outside this repository (`new-cards/design.md` §5.3,
KNOW THEM?) asked the team whether a quiz should pair people at all. This card
is the answer: it does, through a team-up. It replaces KNOW THEM? in that
proposal. He told me to start on 13 Oct 2026 (「现在就开工」), after the team's
v3 flow, so the new-card gate is passed for this card only.

## Decisions (his picks, 13 Oct 2026)

| Question | Pick |
|---|---|
| Where it sits | A fourth card before a match, like the other three. Not an activity after a match. |
| What a yes means | "Team up": I want you as my teammate. A team-up each way is a match. |
| Where the questions come from | The show: a `quiz` list on each entry of the shows file, beside `setlist`. |
| What the list shows of each person | Their band and their score (right out of total), never their answers. |
| Where answers are checked | On the relay. Phones never receive the right answers before they lock one in. |

## 1. Data and rules

**The shows file.** An entry may carry `quiz`, a list of 1 to 20 questions (1 to 5 until 14 Oct 2026):

```json
"quiz": [
  { "q": "Which country is Zara Larsson from?",
    "options": ["Sweden", "Norway", "Denmark", "Finland"],
    "answer": 0,
    "fact": "She grew up in Stockholm." }
]
```

- `q`: 1 to 140 characters. `options`: exactly 4 distinct strings, each 1 to
  60 characters. `answer`: the index (0 to 3) of the right option. `fact`: 0 to
  140 characters, shown after the person locks an answer.
- **A deal for each person** (14 Oct 2026, his ask): each person is asked 5 of
  the quiz (`QUIZ_DEAL`; all of it when it has 5 or fewer), each with its four
  options in that person's own order (`relay/quiz.js` `dealOf`). The draw is a
  hash of the quiz's print and the person, so a reload or a restart deals them
  the same; nothing new is stored. An answer is sent as the place tapped on the
  person's own screen and kept as the option's place in the quiz; a night file
  saved before deals (no `quizDeal`) drops its answers, as a corrected quiz does.
- **The band answers back** (14 Oct 2026, his ask): for 20 s after an answer
  (`GUESSED_SHOW_MS`) every show about its person but NOT NOW carries
  `guessed: { n, right }`, and the band plays it once per `n`: `right` (two
  flashes in LET'S GUESS's colour) or `wrong` (one white flash). For 8 s after
  the last answer (`SCORE_SHOW_MS`) the lit LET'S GUESS face reads the score,
  `4 / 5` over `RIGHT`. The answer time is not saved: a restart plays nothing old.
- A quiz that breaks any rule is dropped with a log line naming the show and
  the rule. The show itself stays. This is the same loud check the shows file
  already gets (`relay/server.js` `showFault`).
- The shows list a phone receives (`/api/shows`) carries no `quiz` at all. A
  person's own view carries the questions as `{ q, options }`, and `answer`
  and `fact` stay on the relay until that person locks that question.

**Answering.**
- A phone sends `{ t: 'answer', q, choice }`. The relay accepts it only when
  the person is in a room whose show has a quiz, `q` is the first question they
  have not answered, and `choice` is 0 to 3. Anything else changes nothing.
- An answer is final. The person's own view gets back, for each answered
  question, `{ choice, right, answer, fact }` (`answer` so the phone can mark
  the right option). Nobody else's view gets any of it.
- `done` is true once every question has an answer. The score is the count of
  right answers out of the quiz's length.
- Answering does not need the card armed. It needs the quiz to exist and the
  card not to be closed.

**Teams (the card's play).** LET'S GUESS joins `plays` in `relay/room.js`:
- `yeses`: `teams`, a map of `'a>b'`, like `waves` and `likes`.
- `may(viewer, t)`: both the viewer and `t` are done, and `t` has LET'S
  GUESS armed (the same people the list shows).
- `list: 'teams'`. Rows are everyone else who is done and has LET'S GUESS
  armed, with their band and `score: { right, of }`, plus `asked` when the
  viewer already asked them. A viewer who is not done gets an empty list.
- A team-up each way is a match through the existing `yes()` path, so
  blocking, NOT NOW, leaving, the meeting number, found and keep all work as
  they do for the other cards.
- A match made through LET'S GUESS carries both scores, in the place where
  FIRST SONG? carries both picks.

**Closed.** LET'S GUESS counts as closed in a room whose show has no quiz
(every typed or made venue, and any listed show without one), as well as when
staff close it. The phone shows it closed, the wristband skips it (the
firmware already skips closed cards), and the relay refuses to arm it.

**Night and restart.** Answers are kept by the room, by person, and outlive
leaving the room, as likes do; they go when the person is forgotten (06:00).
The night file keeps them, together with a hash of the quiz they answered.
After a restart, answers to a quiz whose hash changed are dropped, so a
corrected question never keeps old scores. A relay with no night file forgets
answers on a restart, as it forgets everything else.

## 2. On the phone

- **Home.** The carousel shows a fourth card from the table: LET'S GUESS!,
  sky blue `#8FB4FF` (deep `#4F7FE0`). Idle: "Ready? / Tap to test / what you
  know". Armed: "Answer, then find / a teammate". Its icon is `quiz`, added to
  the icon subset with `npm run fonts`.
- **Quiz screen** (`app/screens/Guess.jsx`, route `quiz`). One question at a
  time, "Question 2 of 3", four options, LOCK IT IN. After the relay answers:
  right or wrong, the right option marked, and the fact. NEXT, then after the
  last one FIND A TEAMMATE. Coming back later shows the score and goes
  straight to the list.
- **Teams screen** (route `teams`). Rows like SAY HI's near list: a handle's
  band and a score chip `3/3`, with TEAM UP? or ASKED. Empty state: "Nobody
  else has finished yet. Stay armed and they'll show up here."
- **Match.** As for the other cards, with "you 3/3 · them 2/3" where FIRST
  SONG? shows the two picks.
- With no signal, an answer is queued like every other action, and the screen
  says "Saved. It'll check when you're back."

## 3. Wristband, relay plumbing, tests

**Wristband.** `firmware/src/band_logic.h` `CARDS` gets the fourth entry, in
the same order: `guess`, the two hues, "LET'S GUESS!". SIDE now steps HI,
SONG, DANCE, GUESS, OFF, skipping any closed card. The band only shows the
card's colour and words; teaming up happens on the phone, as liking does for
FIRST SONG?. A band still running older firmware that is sent `guess` must
not crash or show another card's colour; a host test covers it. All four
StickC Plus need reflashing, which waits for his yes.

**Relay plumbing.** `relay/server.js`: the `answer` message, the quiz check in
`showFault`'s neighbourhood, and stripping answers out of every shows list a
phone gets. The room's `dump()` carries answers, team-ups and the quiz hash
into the night file, as it carries likes. Answers share the existing
per-socket message limit; nothing in `relay/limits.js` changes.

**Tests.** `tests/cards.test.js` and `tests/firmware.test.js` already require
every part of a new card (words, icon, stylesheet colours, screens, play, the
firmware copy). New tests:
- the quiz check: every rule, a bad quiz dropped with the show kept;
- **no `answer` or `fact` reaches a phone**, in `/api/shows` or in any view,
  before that person locks that question;
- answering: in order only, once only, out-of-range refused, score counted;
- teams: not done sees nothing, only done people listed, team-up only to done
  people, a team-up each way is a match, a block removes team-ups both ways;
- no quiz means closed, and arming a closed card is refused;
- restart keeps answers, a changed quiz drops them, 06:00 clears them;
- firmware: SIDE order with four cards, an unknown intent stays harmless.

The guards that keep answers off phones are mutation-checked: remove the
guard and exactly its test goes red. The flow is then walked in a browser on
two phones' worth of tabs.

**Content.** `relay/shows.json` gets a test night with ZARA LARSSON as the
act and five of the eight questions written for the 14 Oct test prototype
(a quiz holds at most five). The venue is named as a test night, not as a
real venue. Each question was checked against the iTunes catalogue or is a
well-known fact about her career.

## Not in this

- Staff writing questions on the staff page. The shows file is the only source
  for now.
- A timer, hints, or audio questions. A gig is the wrong place to hear a clip,
  and playing the act's recordings is the venue's licensing matter.
- Doing the quiz together after a match. That was the team's v3 activity and
  lives in the 14 Oct test prototype, outside this repository.
- Deploying to Fly and reflashing bands: each waits for his yes.
