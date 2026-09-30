import { expect, test, type Page } from '@playwright/test';
import type { ApplicationRecord } from '@workspace/api-client-react';

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

test('submitted review status refreshes in another open staff queue', async ({ browser }) => {
  const applicationId = 'SUBMITTED-BUILDING-REVIEW-01';
  const submittedAt = '2026-09-15T12:00:00.000Z';
  const createdAt = '2026-09-15T11:00:00.000Z';
  let application: ApplicationRecord = {
    id: applicationId,
    businessName: 'Shared Queue Test Cafe',
    businessCategory: 'restaurant',
    requestType: 'Building Permit',
    status: 'Draft — Requires Review',
    assignedDepartment: 'Building, Planning',
    applicantLanguage: 'English',
    submittedAt,
    description: 'Interior renovation for a neighborhood cafe.',
    synthetic: true,
    plan: {
      id: applicationId,
      userId: 'test-applicant',
      departments: ['Building', 'Planning'],
      departmentAssignees: { Building: 'Marcus Johnson (Building)' },
      intake: {
        businessName: 'Shared Queue Test Cafe',
        businessType: 'restaurant',
        businessOther: '',
        address: '123 Test Street',
        zip: '95112',
        description: 'Interior renovation for a neighborhood cafe.',
        modifications: ['walls'],
        modificationOther: '',
        files: [],
      },
      language: 'en',
      customLanguage: '',
      simplified: false,
      createdAt: Date.parse(createdAt),
      updatedAt: Date.parse(createdAt),
      submittedAt: Date.parse(submittedAt),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched: ['building-permits', 'business-registration', 'zoning-clearance'],
    },
    createdAt,
    updatedAt: createdAt,
  };

  let reviewerUpdates = 0;
  let firstQueueReads = 0;
  let secondQueueReads = 0;
  const installApplicationApi = async (page: Page, countQueueRead: () => void) => {
    await page.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/api/applications/staff' && method === 'GET') {
        countQueueRead();
        return route.fulfill({ json: [application] });
      }
      if (pathname === `/api/applications/${applicationId}/review` && method === 'PATCH') {
        const body = route.request().postDataJSON() as { plan: Record<string, unknown> };
        const status = String(body.plan.status);
        application = {
          ...application,
          status,
          plan: { ...application.plan, ...body.plan },
          updatedAt: '2026-09-15T12:10:00.000Z',
        };
        reviewerUpdates++;
        return route.fulfill({ json: application });
      }
      if (pathname === `/api/applications/${applicationId}/history` && method === 'GET') {
        return route.fulfill({ json: [] });
      }
      throw new Error(`Unexpected request: ${method} ${pathname}`);
    });
  };

  const firstSession = await browser.newContext();
  const firstReviewer = await firstSession.newPage();
  await firstReviewer.clock.install();
  await installApplicationApi(firstReviewer, () => { firstQueueReads++; });

  const secondSession = await browser.newContext();
  const secondReviewer = await secondSession.newPage();
  await secondReviewer.clock.install();
  await installApplicationApi(secondReviewer, () => { secondQueueReads++; });
  let secondDocumentLoads = 0;
  secondReviewer.on('request', request => {
    if (request.isNavigationRequest()) secondDocumentLoads++;
  });

  try {
    await firstReviewer.goto('/test/harness.html?queue=staff');
    const firstQueue = firstReviewer.getByTestId('active-plan-SUBMITTED-BUILDING-REVIEW-01');
    await firstReviewer.getByTestId('tab-staff-queue').click();
    await expect(firstQueue).toContainText('Draft — Requires Review');

    await secondReviewer.goto('/test/harness.html?queue=staff');
    const secondQueue = secondReviewer.getByTestId('active-plan-SUBMITTED-BUILDING-REVIEW-01');
    await secondReviewer.getByTestId('tab-staff-queue').click();
    await expect(secondQueue).toContainText('Draft — Requires Review');
    expect(firstQueueReads).toBeGreaterThan(0);
    expect(secondQueueReads).toBeGreaterThan(0);

    await firstQueue.getByRole('button', { name: 'Review Plan' }).click();
    await firstQueue.getByRole('button', { name: 'Complete Review' }).click();
    await expect.poll(() => reviewerUpdates).toBe(1);
    await expect(firstReviewer.getByText('Queue Empty')).toBeVisible();

    // The other session remains unchanged until its production polling interval runs.
    await expect(secondQueue).toContainText('Draft — Requires Review');
    const readsBeforePolling = secondQueueReads;
    await secondReviewer.clock.fastForward(15_000);
    await expect.poll(() => secondQueueReads).toBeGreaterThan(readsBeforePolling);

    await expect(secondReviewer.getByText('Queue Empty')).toBeVisible();
    await secondReviewer.getByTestId('tab-staff-catalog').click();
    await expect(secondReviewer.getByTestId(`catalog-record-${applicationId}`)).toContainText('Approved');
    expect(secondDocumentLoads).toBe(1);
  } finally {
    await Promise.all([firstSession.close(), secondSession.close()]);
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