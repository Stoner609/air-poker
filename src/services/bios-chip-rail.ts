import type { BiosDisplayChip } from "./bios-betting-preview";

export interface CollapsedBiosChips {
  visible: BiosDisplayChip[];
  collapsed: BiosDisplayChip[];
  collapsedAmount: number;
}

export function projectCollapsedBiosChips(
  chips: BiosDisplayChip[],
  limit: number,
): CollapsedBiosChips {
  if (chips.length <= limit) {
    return { visible: chips, collapsed: [], collapsedAmount: 0 };
  }

  const priority = chips.filter(
    (chip) => chip.kind === "ante" || chip.status === "latest" || chip.preview !== undefined,
  );
  const older = chips.filter((chip) => !priority.includes(chip));
  const slotsForRecent = Math.max(0, limit - priority.length - 1);
  const recent = older.slice(Math.max(0, older.length - slotsForRecent));
  const collapsed = older.slice(0, older.length - recent.length);
  const retainedIds = new Set([...priority, ...recent].map((chip) => chip.id));

  return {
    visible: chips.filter((chip) => retainedIds.has(chip.id)),
    collapsed,
    collapsedAmount: collapsed.reduce((total, chip) => total + chip.amount, 0),
  };
}
