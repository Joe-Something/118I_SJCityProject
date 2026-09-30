const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PUBLISHED_WINDOW_DAYS = 30;

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

  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const issueDay = date.getTime() - 12 * 60 * 60 * 1000;
  const earliestPublishedDay = todayStart - PUBLISHED_WINDOW_DAYS * DAY_IN_MS;
  if (issueDay < earliestPublishedDay || issueDay > todayStart) return null;

  return date;
}