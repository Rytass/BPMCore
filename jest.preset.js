const nxPreset = require('@nx/jest/preset').default;

/**
 * Pin the suite's timezone.
 *
 * Some behaviour is deliberately relative to the host zone — the form date
 * pickers format the *local* calendar day, because a browser user picking
 * "the 20th" means the 20th where they are. Tests for that have to fix a zone
 * or they assert whatever the machine happens to be set to: they passed on
 * developer laptops in Taiwan and failed on the UTC CI runner.
 *
 * This has to happen here, in the config the CLI loads before it forks its
 * workers, so the workers inherit it. Assigning `process.env.TZ` from inside a
 * `beforeAll` does not work — by then the worker has already resolved its
 * timezone, and the assignment silently does nothing.
 *
 * `Asia/Taipei` (UTC+8) rather than UTC on purpose: an off-by-one-day bug in
 * date handling only appears when the local calendar day differs from the UTC
 * one, so running east of UTC is what keeps those tests honest.
 */
process.env.TZ = 'Asia/Taipei';

module.exports = { ...nxPreset };
