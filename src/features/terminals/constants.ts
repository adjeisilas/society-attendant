/**
 * Terminal settings shared by pages, server actions and components. They live outside
 * the "use server" module, which may only export async functions.
 */

/** HTTP-only cookie holding the terminal key on a registered computer. */
export const TERMINAL_COOKIE = "hsa_terminal";

/** Browsers cap cookie lifetimes at about 400 days; a terminal that loses it is registered again. */
export const TERMINAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export const TERMINAL_KEY_PATTERN = /^t1\.[A-Za-z0-9_-]{43}$/;

/** How long a clock-in result stays on screen before the terminal is ready for the next person. */
export const RESULT_DISPLAY_SECONDS = 8;

/** A half-typed sign-in is cleared after this long without input. */
export const IDLE_RESET_SECONDS = 45;
