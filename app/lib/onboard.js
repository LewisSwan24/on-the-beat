// Where the phone opens: the splash for anyone not yet in tonight, or straight to tonight for someone back.

/** 'splash', or, for someone already in tonight's room (promises seen, a name, a show not left), 'home' or 'quiet'. */
export const firstScreen = (s, night) => (s?.promisesSeen && s?.name && night?.show && !night.left && !night.leaving
  ? (night.state?.invisible ? 'quiet' : 'home') : 'splash');
