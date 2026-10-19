/* ============================================================================
   midday-tz.js - loaded before every test file (package.json: node --import).

   The relay ends a night at 06:00 in its time zone, the machine's own unless a
   test names one. Tests that start a clock at the real time and step it an
   hour or two ahead (BAND_ALONE_MS, a clip's hour on the floor) cross that
   06:00 when the suite happens to run between about 04:00 and 06:00 there,
   and the night ending under them fails them: CI on UTC failed five of them
   at 05:08 UTC on 19 Oct 2026 for a README-only commit.

   So every test file runs in a fixed-offset zone where it is now about
   midday: 06:00 is then some eighteen hours away, whenever and wherever the
   suite runs. A test about time zones names its own (nightTz), as before.
   ========================================================================== */
const offset = 12 - new Date().getUTCHours();  // -11 .. +12: every one is an Etc/GMT zone
// Etc/GMT's sign is the POSIX one, the other way round: Etc/GMT-10 is ten hours ahead of UTC.
process.env.TZ = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
