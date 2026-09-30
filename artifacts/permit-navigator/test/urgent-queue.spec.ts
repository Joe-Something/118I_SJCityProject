import { expect, test, type Page } from '@playwright/test';
import type { ApplicationRecord } from '@workspace/api-client-react';

const ticketId = '12345678-1234-4234-8234-123456789abc';
const conversationId = '87654321-4321-4321-8321-abcdefabcdef';
const createdAt = '2026-09-01T12:00:00.000Z';
const urgentAnswer = `Flagged in prototype review queue · ${createdAt} · Ticket ${ticketId} · No email delivery or City dispatch confirmed\n\nThis may be an immediate safety hazard. Leave the area and contact emergency services or the appropriate City department now. This prototype has not notified emergency responders or City staff. A human-review item is marked in this workspace only.`;

function staffQueueApplication(applicationId: string): ApplicationRecord {
  return {
    id: applicationId,
    businessName: 'Review Save Test Cafe',
    businessCategory: 'restaurant',
    requestType: 'Building Permit',
    status: 'Draft — Requires Review',
    assignedDepartment: 'Building',
    applicantLanguage: 'English',
    submittedAt: '2026-09-15T12:00:00.000Z',
    description: 'Interior renovation for a neighborhood cafe.',
    synthetic: true,
    plan: {
      id: applicationId,
      userId: 'test-applicant',
      departments: ['Building'],
      departmentAssignees: { Building: 'Marcus Johnson (Building)' },
      intake: {
        businessName: 'Review Save Test Cafe',
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
      createdAt: Date.parse('2026-09-15T11:00:00.000Z'),
      updatedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      submittedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched: ['building-permits'],
    },
    createdAt: '2026-09-15T11:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
  };
}

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

test('reviewer decisions survive completion, reopening, another session refresh, and reload', async ({ browser }) => {
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
  let reopenAttempts = 0;
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
        if (status === 'In Review (Re-opened)') {
          reopenAttempts++;
          if (reopenAttempts === 1) {
            return route.fulfill({ status: 503, json: { error: 'Review could not be saved' } });
          }
        }
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
  let firstDocumentLoads = 0;
  firstReviewer.on('request', request => {
    if (request.isNavigationRequest()) firstDocumentLoads++;
  });
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
    await firstQueue.getByTestId(`button-note-${applicationId}-building-permits`).click();
    await firstQueue.getByTestId(`input-note-${applicationId}-building-permits`).fill('Confirm the accessible entrance clearance.');
    await firstQueue.getByTestId(`button-save-note-${applicationId}-building-permits`).click();
    await expect.poll(() => reviewerUpdates).toBe(1);

    await firstQueue.getByTestId(`button-override-${applicationId}-business-registration`).click();
    await firstQueue.getByTestId(`textarea-override-${applicationId}-business-registration`).fill('Use the updated neighborhood business registration checklist.');
    await firstQueue.getByTestId(`button-save-override-${applicationId}-business-registration`).click();
    await expect.poll(() => reviewerUpdates).toBe(2);

    await firstQueue.getByTestId(`button-reject-${applicationId}-zoning-clearance`).click();
    await expect.poll(() => reviewerUpdates).toBe(3);
    await firstQueue.getByRole('button', { name: 'Complete Review' }).click();
    await expect.poll(() => reviewerUpdates).toBe(4);
    await expect(firstReviewer.getByText('Queue Empty')).toBeVisible();

    // The other session remains unchanged until its production polling interval runs.
    await expect(secondQueue).toContainText('Draft — Requires Review');
    const readsBeforePolling = secondQueueReads;
    await secondReviewer.clock.fastForward(15_000);
    await expect.poll(() => secondQueueReads).toBeGreaterThan(readsBeforePolling);

    await expect(secondReviewer.getByText('Queue Empty')).toBeVisible();
    await secondReviewer.getByTestId('tab-staff-catalog').click();
    const catalogRecord = secondReviewer.getByTestId(`catalog-record-${applicationId}`);
    await expect(catalogRecord).toContainText('Rejected');
    await expect(catalogRecord).toContainText('Confirm the accessible entrance clearance.');
    await expect(catalogRecord).toContainText('Use the updated neighborhood business registration checklist.');
    await expect(catalogRecord).toContainText('zoning-clearance: Rejected');
    await secondReviewer.getByTestId(`button-reopen-${applicationId}`).click();
    await expect.poll(() => reopenAttempts).toBe(1);
    await expect(catalogRecord.getByTestId(`reopen-error-${applicationId}`))
      .toContainText("We couldn't save this plan's reopening");
    await expect(catalogRecord.getByTestId(`reopen-error-${applicationId}`))
      .toContainText('It remains in the review catalog');
    await expect(catalogRecord).toContainText('Rejected');
    await expect(secondReviewer.getByTestId(`active-plan-${applicationId}`)).toHaveCount(0);
    await expect.poll(() => reviewerUpdates).toBe(4);

    await secondReviewer.getByTestId(`button-reopen-${applicationId}`).click();
    await expect.poll(() => reopenAttempts).toBe(2);
    await expect.poll(() => reviewerUpdates).toBe(5);
    const reopenedInSecondSession = secondReviewer.getByTestId(`active-plan-${applicationId}`);
    await expect(reopenedInSecondSession).toContainText('In Review (Re-opened)');
    await expect(secondReviewer.getByTestId(`text-staff-note-${applicationId}-building-permits`)).toContainText('Confirm the accessible entrance clearance.');
    await expect(reopenedInSecondSession).toContainText('Use the updated neighborhood business registration checklist.');
    await expect(secondReviewer.getByTestId(`button-reapprove-${applicationId}-zoning-clearance`)).toBeVisible();

    // Reopening in the catalog returns the plan to the other session's queue on its regular poll.
    await expect(firstReviewer.getByText('Queue Empty')).toBeVisible();
    const firstReadsBeforeReopenPolling = firstQueueReads;
    await firstReviewer.clock.fastForward(15_000);
    await expect.poll(() => firstQueueReads).toBeGreaterThan(firstReadsBeforeReopenPolling);
    await expect(firstQueue).toContainText('In Review (Re-opened)');
    await expect(firstReviewer.getByTestId(`text-staff-note-${applicationId}-building-permits`)).toContainText('Confirm the accessible entrance clearance.');
    await expect(firstQueue).toContainText('Use the updated neighborhood business registration checklist.');
    await expect(firstReviewer.getByTestId(`button-reapprove-${applicationId}-zoning-clearance`)).toBeVisible();

    await firstReviewer.reload();
    await firstReviewer.getByTestId('tab-staff-queue').click();
    const refreshedQueue = firstReviewer.getByTestId(`active-plan-${applicationId}`);
    await expect(refreshedQueue).toContainText('In Review (Re-opened)');
    await refreshedQueue.getByRole('button', { name: 'Review Plan' }).click();
    await expect(firstReviewer.getByTestId(`text-staff-note-${applicationId}-building-permits`)).toContainText('Confirm the accessible entrance clearance.');
    await expect(refreshedQueue).toContainText('Use the updated neighborhood business registration checklist.');
    await expect(firstReviewer.getByTestId(`button-reapprove-${applicationId}-zoning-clearance`)).toBeVisible();
    expect(firstDocumentLoads).toBe(2);
    expect(secondDocumentLoads).toBe(1);
  } finally {
    await Promise.all([firstSession.close(), secondSession.close()]);
  }
});

test('staff queue stays usable through a failed refresh and updates after recovery', async ({ page }) => {
  const applicationId = 'STALE-QUEUE-REFRESH-01';
  let application: ApplicationRecord = {
    id: applicationId,
    businessName: 'Last Known Queue Cafe',
    businessCategory: 'restaurant',
    requestType: 'Building Permit',
    status: 'Draft — Requires Review',
    assignedDepartment: 'Building',
    applicantLanguage: 'English',
    submittedAt: '2026-09-15T12:00:00.000Z',
    description: 'Interior renovation for a neighborhood cafe.',
    synthetic: true,
    plan: {
      id: applicationId,
      userId: 'test-applicant',
      departments: ['Building'],
      departmentAssignees: { Building: 'Marcus Johnson (Building)' },
      intake: {
        businessName: 'Last Known Queue Cafe',
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
      createdAt: Date.parse('2026-09-15T11:00:00.000Z'),
      updatedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      submittedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched: ['building-permits'],
    },
    createdAt: '2026-09-15T11:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
  };
  let queueReads = 0;

  await page.clock.install();
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/applications/staff' && method === 'GET') {
      queueReads++;
      if (queueReads === 2) return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
      return route.fulfill({ json: [application] });
    }
    if (pathname === `/api/applications/${applicationId}/history` && method === 'GET') {
      return route.fulfill({ json: [] });
    }
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await page.goto('/test/harness.html?queue=staff');
  await page.getByTestId('tab-staff-queue').click();
  const reviewCard = page.getByTestId(`active-plan-${applicationId}`);
  await expect(reviewCard).toContainText('Draft — Requires Review');

  const readsBeforeFailure = queueReads;
  await page.clock.fastForward(15_000);
  await expect.poll(() => queueReads).toBeGreaterThan(readsBeforeFailure);
  await expect(page.getByTestId('records-refresh-warning')).toContainText('last successfully loaded review state');
  await expect(reviewCard).toContainText('Draft — Requires Review');
  await reviewCard.getByRole('button', { name: 'Review Plan' }).click();
  await expect(page.getByTestId(`panel-staff-review-${applicationId}`)).toBeVisible();

  application = {
    ...application,
    status: 'Approved',
    plan: { ...application.plan, status: 'Approved' },
    updatedAt: '2026-09-15T12:10:00.000Z',
  };
  const readsBeforeRecovery = queueReads;
  await page.clock.fastForward(15_000);
  await expect.poll(() => queueReads).toBeGreaterThan(readsBeforeRecovery);
  await expect(page.getByTestId('records-refresh-warning')).toHaveCount(0);
  await page.getByTestId('tab-staff-catalog').click();
  await expect(page.getByTestId(`catalog-record-${applicationId}`)).toContainText('Approved');
});

test('staff queue clears previously loaded applications when access is denied', async ({ page }) => {
  const applicationId = 'STAFF-ACCESS-DENIED-01';
  let queueReads = 0;

  await page.clock.install();
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/applications/staff' && route.request().method() === 'GET') {
      queueReads++;
      if (queueReads === 2) return route.fulfill({ status: 403, json: { error: 'Staff access denied' } });
      if (queueReads === 3) return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
      return route.fulfill({ json: [staffQueueApplication(applicationId)] });
    }
    throw new Error(`Unexpected request: ${route.request().method()} ${pathname}`);
  });

  await page.goto('/test/harness.html?queue=staff');
  await page.getByTestId('tab-staff-queue').click();
  const reviewCard = page.getByTestId(`active-plan-${applicationId}`);
  await expect(reviewCard).toBeVisible();

  await page.clock.fastForward(15_000);
  await expect.poll(() => queueReads).toBe(2);
  await expect(page.getByRole('alert')).toContainText('Staff access requires an administrator-assigned Clerk role and department');
  await expect(reviewCard).toHaveCount(0);

  await page.clock.fastForward(15_000);
  await expect.poll(() => queueReads).toBe(3);
  await expect(page.getByTestId('records-refresh-warning')).toHaveCount(0);
  await expect(reviewCard).toHaveCount(0);
});

test('review save confirmation is separate from a failed queue refresh and update failures stay clear', async ({ page }) => {
  const applicationId = 'REVIEW-SAVE-REFRESH-01';
  let application = staffQueueApplication(applicationId);
  let queueReads = 0;
  let reviewUpdates = 0;
  let failNextQueueRead = false;

  await page.clock.install();
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/applications/staff' && method === 'GET') {
      queueReads++;
      if (failNextQueueRead) {
        failNextQueueRead = false;
        return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
      }
      return route.fulfill({ json: [application] });
    }
    if (pathname === `/api/applications/${applicationId}/review` && method === 'PATCH') {
      reviewUpdates++;
      if (reviewUpdates === 1) {
        return route.fulfill({ status: 503, json: { error: 'Review could not be saved' } });
      }
      const body = route.request().postDataJSON() as { plan: Record<string, unknown> };
      const status = String(body.plan.status);
      application = {
        ...application,
        status,
        plan: { ...application.plan, ...body.plan },
        updatedAt: '2026-09-15T12:10:00.000Z',
      };
      return route.fulfill({ json: application });
    }
    if (pathname === `/api/applications/${applicationId}/history` && method === 'GET') {
      return route.fulfill({ json: [] });
    }
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await page.goto('/test/harness.html?queue=staff');
  await page.getByTestId('tab-staff-queue').click();
  const reviewCard = page.getByTestId(`active-plan-${applicationId}`);
  await expect(reviewCard).toContainText('Draft — Requires Review');
  await reviewCard.getByRole('button', { name: 'Review Plan' }).click();
  await expect(page.getByTestId(`panel-staff-review-${applicationId}`)).toBeVisible();

  await page.getByRole('button', { name: 'Complete Review' }).click();
  await expect(page.getByText('Review not saved')).toBeVisible();
  expect(reviewUpdates).toBe(1);

  failNextQueueRead = true;
  await page.getByRole('button', { name: 'Complete Review' }).click();
  await expect.poll(() => reviewUpdates).toBe(2);
  await expect.poll(() => queueReads).toBe(2);
  await expect(page.getByText('Review saved', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Your change was saved, but the staff queue could not be refreshed. The warning on this page explains that the displayed data may be out of date.',
    { exact: true },
  )).toBeVisible();
  await expect(page.getByTestId('records-refresh-warning'))
    .toContainText('last successfully loaded review state');
  await expect(reviewCard).toContainText('Draft — Requires Review');
});

test('applicant saved plans stay usable through a failed refresh and update after recovery', async ({ page }) => {
  const applicantId = 'SAVED-PLAN-REFRESH-01';
  const currentApplicantId = 'test-browser-user:test-applicant@example.com';
  const makeApplication = (id: string, businessName: string): ApplicationRecord => ({
    id,
    businessName,
    businessCategory: 'restaurant',
    requestType: 'Building Permit',
    status: 'Draft — Requires Review',
    assignedDepartment: 'Building',
    applicantLanguage: 'English',
    submittedAt: new Date('2026-09-15T12:00:00.000Z'),
    description: 'Interior renovation for a neighborhood cafe.',
    synthetic: true,
    plan: {
      id,
      userId: currentApplicantId,
      departments: ['Building'],
      departmentAssignees: {},
      intake: {
        businessName,
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
      createdAt: Date.parse('2026-09-15T11:00:00.000Z'),
      updatedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      submittedAt: Date.parse('2026-09-15T12:00:00.000Z'),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched: ['building-permits'],
    },
    createdAt: new Date('2026-09-15T11:00:00.000Z'),
    updatedAt: new Date('2026-09-15T12:00:00.000Z'),
  });
  let application = makeApplication(applicantId, 'Last Known Saved Cafe');
  let reads = 0;

  await page.clock.install();
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/applications/mine' && route.request().method() === 'GET') {
      reads++;
      if (reads === 2) return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
      return route.fulfill({ json: [application] });
    }
    throw new Error(`Unexpected request: ${route.request().method()} ${pathname}`);
  });

  await page.goto('/test/harness.html?applicant=records');
  const savedPlan = page.getByTestId(`dashboard-plan-card-${applicantId}`);
  await expect(savedPlan).toContainText('Last Known Saved Cafe');
  await expect(page.getByTestId('records-refresh-warning')).toHaveCount(0);

  const readsBeforeFailure = reads;
  await page.clock.fastForward(15_000);
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeFailure);
  await expect(page.getByTestId('records-refresh-warning')).toContainText('may be out of date');
  await expect(savedPlan).toContainText('Last Known Saved Cafe');
  await savedPlan.getByRole('button', { name: 'Open Plan' }).click();
  await expect(page.getByTestId('applicant-plan-detail')).toContainText('Last Known Saved Cafe');
  await page.getByRole('button', { name: 'Back to saved plans' }).click();

  application = makeApplication('SAVED-PLAN-CURRENT-02', 'Current Saved Bakery');
  const readsBeforeRecovery = reads;
  await page.clock.fastForward(15_000);
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRecovery);
  await expect(page.getByTestId('records-refresh-warning')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-plan-card-SAVED-PLAN-CURRENT-02')).toContainText('Current Saved Bakery');
  await expect(savedPlan).toHaveCount(0);
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
  await expect(page.getByText('Guidance, not a decision.')).toBeHidden();
  await page.getByTestId('input-workspace-question').fill('There is a gas leak near my shop');
  await page.getByTestId('button-send-workspace-message').click();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false }).first()).toBeVisible();
  await page.getByTestId('harness-navigate').click();
  await expect(page.getByText('Permit portal', { exact: true })).toBeVisible();
  await page.getByTestId('harness-navigate').click();
  await expect(page.getByText('Guidance, not a decision.')).toBeHidden();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false })).toBeVisible();
  await expect(page.getByText('has not notified emergency responders or City staff', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Leave the area and contact emergency services', { exact: false })).toBeVisible();
  await expect(page.getByText('No email delivery or City dispatch confirmed', { exact: false })).toBeVisible();
});