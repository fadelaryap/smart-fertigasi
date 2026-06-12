// Edge-safe constants (no Node imports) so middleware.ts can use them without
// pulling node:crypto into the edge runtime bundle.
export const SESSION_COOKIE = "fert_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours
