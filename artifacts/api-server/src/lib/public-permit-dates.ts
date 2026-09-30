const PUBLISHED_WINDOW_DAYS = 30;

export function getPublishedIssueDateWindow(now: Date): { start: Date; endExclusive: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - PUBLISHED_WINDOW_DAYS);

  const endExclusive = new Date(now);
  endExclusive.setUTCHours(0, 0, 0, 0);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return { start, endExclusive };
}

export function parsePublishedIssueDate(value: string, now: Date): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match || Number.isNaN(now.getTime())) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  // Date constructors normalize impossible dates (for example, February 31).
  // Reject those instead of silently moving them into the dataset window.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const { start, endExclusive } = getPublishedIssueDateWindow(now);
  if (date < start || date >= endExclusive) return null;

  return date;
}