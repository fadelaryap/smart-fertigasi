// Plain module (NOT "use server") — a "use server" file may only export async
// functions, so the field list lives here and is shared by page + actions.
export const FUZZY_FIELDS = [
  "sdmin", "snmin", "sdmax", "swmin", "snmax", "swmax",
  "elmin", "emmin", "elmax", "ehmin", "emmax", "ehmax",
  "os", "om", "ol", "output_max",
] as const;
