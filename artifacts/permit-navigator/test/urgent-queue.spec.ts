import { expect, test, type Page } from '@playwright/test';

const ticketId = '12345678-1234-4234-8234-123456789abc';
const conversationId = '87654321-4321-4321-8321-abcdefabcdef';
const createdAt = '2026-09-01T12:00:00.000Z';
const urgentAnswer = `Flagged in prototype review queue · ${createdAt} · Ticket ${ticketId} · No email delivery or City dispatch confirmed\n\nThis may be an immediate safety hazard. Leave the area and contact emergency services or the appropriate City department now. This prototype has not notified emergency responders or City staff. A human-review item is marked in this workspace only.`;

function queueItem(acknowledged: boolean, acknowledgedBy: string | null = null) {
  return {
    ticketId, createdAt,
    status: acknowledged ? 'Acknowledged in prototype queue' : 'Awaiting prototype staff acknowledgement',
    acknowledgedAt: acknowledged ? '2026-09-01T12:05:00.000Z' : null,
    acknowledgedBy,
    acknowledgedDepartment: acknowledgedBy ? 'Fire' : null,
    departmentInbox: 'Test only',
    deliveryStatus: 'Delivery not verified; no automatic dispatch or retries',
    testRecipient: null,
  };
}

for (const desk of ['Fire Prevention', 'Economic Development'] as const) {
  test(`${desk}: queue loading, error, retry, acknowledgement and refreshed state`, async ({ page }) => {
    let queueReads = 0;
    let acknowledged = false;
    let acknowledgementAttempts = 0;
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>(resolve => { releaseFirst = resolve; });

    await page.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/workspace/escalations' && route.request().method() === 'GET') {
        queueReads++;
        if (queueReads === 1) {
          await firstRead;
          return route.fulfill({ status: 503, json: { error: 'Queue unavailable' } });
        }
        return route.fulfill({ json: [queueItem(acknowledged)] });
      }
      if (pathname === `/api/workspace/escalations/${ticketId}/acknowledge` && route.request().method() === 'POST') {
        acknowledgementAttempts++;
        if (acknowledgementAttempts === 1) {
          return route.fulfill({ status: 503, json: { error: 'Acknowledgement unavailable' } });
        }
        acknowledged = true;
        return route.fulfill({ json: queueItem(true) });
      }
      throw new Error(`Unexpected request: ${route.request().method()} ${pathname}`);
    });

    await page.goto(`/test/harness.html?desk=${encodeURIComponent(desk)}`);
    await expect(page.getByTestId('staff-desk-label')).toContainText(desk);
    await expect(page.getByText('Loading flagged items…')).toBeVisible();
    releaseFirst();
    const queue = page.getByRole('region', { name: 'High-urgency review queue' });
    await expect(queue.getByRole('alert')).toContainText('Review queue unavailable');
    await queue.getByRole('button', { name: 'Retry' }).click();
    await expect(queue.getByText(`Ticket ${ticketId}`, { exact: false })).toBeVisible();
    await queue.getByRole('button', { name: 'Acknowledge in prototype queue' }).click();
    await expect(queue.getByRole('alert')).toContainText('Acknowledgement could not be saved');
    await expect(queue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toBeVisible();
    await queue.getByRole('button', { name: 'Acknowledge in prototype queue' }).click();
    await expect.poll(() => acknowledgementAttempts).toBe(2);
    await expect.poll(() => queueReads).toBeGreaterThanOrEqual(3); // invalidation refetched the GET
    await expect(queue.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(queue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toHaveCount(0);
    await page.reload();
    await expect(queue.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(queue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toHaveCount(0);
  });
}

test('urgent queue refreshes when another reviewer acknowledges a ticket', async ({ browser }) => {
  let queueReads = 0;
  let acknowledgedBy: string | null = null;
  const context = await browser.newContext();
  const firstReviewer = await context.newPage();
  await firstReviewer.clock.install();

  await context.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/workspace/escalations' && method === 'GET') {
      queueReads++;
      return route.fulfill({ json: [queueItem(acknowledgedBy !== null, acknowledgedBy)] });
    }
    if (pathname === `/api/workspace/escalations/${ticketId}/acknowledge` && method === 'POST') {
      acknowledgedBy = 'Jordan Lee';
      return route.fulfill({ json: queueItem(true, acknowledgedBy) });
    }
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  try {
    await firstReviewer.goto('/test/harness.html?desk=Fire%20Prevention');
    const firstQueue = firstReviewer.getByRole('region', { name: 'High-urgency review queue' });
    await expect(firstQueue.getByText('Awaiting prototype staff acknowledgement')).toBeVisible();
    await expect(firstQueue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toBeVisible();

    const secondReviewer = await context.newPage();
    await secondReviewer.goto('/test/harness.html?desk=Fire%20Prevention');
    const secondQueue = secondReviewer.getByRole('region', { name: 'High-urgency review queue' });
    await expect(secondQueue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toBeVisible();
    await secondQueue.getByRole('button', { name: 'Acknowledge in prototype queue' }).click();
    await expect(secondQueue.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(secondQueue.getByText('Acknowledged by Jordan Lee (Fire)')).toBeVisible();

    // The first reviewer's cache stays unchanged until its polling interval runs.
    await expect(firstQueue.getByText('Awaiting prototype staff acknowledgement')).toBeVisible();
    await expect(firstQueue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toBeVisible();
    const readsBeforePolling = queueReads;
    await firstReviewer.clock.fastForward(30_000);
    await expect.poll(() => queueReads).toBeGreaterThan(readsBeforePolling);

    await expect(firstQueue.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(firstQueue.getByText('Acknowledged by Jordan Lee (Fire)')).toBeVisible();
    await expect(firstQueue.getByRole('button', { name: 'Acknowledge in prototype queue' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('resident safety and non-dispatch warning survives leaving and returning to the workspace', async ({ page }) => {
  let messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }> = [];
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/workspace/conversations' && method === 'GET') {
      return route.fulfill({ json: [{ id: conversationId, title: 'Safety question', mode: 'research', createdAt, updatedAt: createdAt }] });
    }
    if (pathname === `/api/workspace/conversations/${conversationId}/messages` && method === 'GET') {
      return route.fulfill({ json: messages });
    }
    if (pathname === `/api/workspace/conversations/${conversationId}/messages` && method === 'POST') {
      messages = [
        { id: 'resident-question', role: 'user', content: 'There is a gas leak near my shop', createdAt },
        { id: ticketId, role: 'assistant', content: urgentAnswer, createdAt },
      ];
      return route.fulfill({ status: 201, json: {
        message: messages[1], sources: [], synthetic: false,
        escalation: `Ticket ${ticketId} · No email delivery or City dispatch confirmed`,
        securityStatus: 'PII-filtered · role-scoped · simulated tool gateway',
      } });
    }
    if (pathname === '/api/workspace/records' || pathname === '/api/workspace/prototype-sources') {
      return route.fulfill({ json: [] });
    }
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await page.goto('/test/harness.html');
  await expect(page.getByText('Guidance, not a decision.')).toBeVisible();
  await page.getByTestId('input-workspace-question').fill('There is a gas leak near my shop');
  await page.getByTestId('button-send-workspace-message').click();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false }).first()).toBeVisible();
  await page.getByTestId('harness-navigate').click();
  await expect(page.getByText('Permit portal', { exact: true })).toBeVisible();
  await page.getByTestId('harness-navigate').click();
  await expect(page.getByText('Guidance, not a decision.')).toBeVisible();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false })).toBeVisible();
  await expect(page.getByText('has not notified emergency responders or City staff', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false })).toBeVisible();
});