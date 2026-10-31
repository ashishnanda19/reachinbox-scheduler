export const MAX_VISIBLE_CHIPS = 3;

export interface ChipWindow {
  visible: string[];
  /** How many are folded into the "+N" chip (0 when expanded or when everything fits). */
  hiddenCount: number;
}

/** Only the first 3 chips plus "+N" are ever rendered (never thousands), unless the user expands them. */
export function chipWindow(emails: readonly string[], expanded: boolean, max = MAX_VISIBLE_CHIPS): ChipWindow {
  if (expanded || emails.length <= max) return { visible: [...emails], hiddenCount: 0 };
  return { visible: emails.slice(0, max), hiddenCount: emails.length - max };
}
