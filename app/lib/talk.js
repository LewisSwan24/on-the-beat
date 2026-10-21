// Between MEET and FOUND: the notes of the meeting a match is part of, as the relay sends them.

/** As long as the relay keeps a note (relay/room.js NOTE_MAX). */
export const NOTE_MAX = 60;

/** The talk of the meeting this match is part of, or null once it has closed (everyone found, or you left). */
export const talkFor = (view, match) => (match ? view?.talk?.[match.group ?? match.id] ?? null : null);
