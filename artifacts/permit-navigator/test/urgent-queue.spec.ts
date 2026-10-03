import { expect, test, type Locator, type Page } from '@playwright/test';
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

function reviewedStaffApplication(
  applicationId: string,
  status: 'Approved' | 'Rejected',
  businessName: string,
  address: string,
  businessType: string,
  businessOther = '',
): ApplicationRecord {
  const record = staffQueueApplication(applicationId);
  const intake = record.plan.intake as Record<string, unknown>;
  return {
    ...record,
    businessName,
    businessCategory: businessType,
    status,
    plan: {
      ...record.plan,
      status,
      intake: { ...intake, businessName, address, businessType, businessOther },
    },
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

async function openUrgentFlagsMenu(page: Page) {
  const trigger = page.getByTestId('button-urgent-flags');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByTestId('urgent-flags-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function openUrgentFlagActions(page: Page, menu: Locator, state: 'needs review' | 'acknowledged' = 'needs review') {
  const flag = menu.getByRole('menuitem', {
    name: `High-urgency flag, ticket ${ticketId}, ${state}`,
  });
  await flag.focus();
  await page.keyboard.press('ArrowRight');
  const actions = page.getByRole('menu', { name: `Details and actions for ticket ${ticketId}` });
  await expect(actions).toBeVisible();
  return actions;
}

test('review catalog search matches full and partial application IDs alongside existing filters', async ({ page }) => {
  const approvedId = 'SJ-REVIEW-APPLICATION-1001';
  const rejectedId = 'SJ-REVIEW-APPLICATION-2002';
  const applications = [
    reviewedStaffApplication(
      approvedId,
      'Approved',
      'Cedar Cafe',
      '123 Cedar Street',
      'restaurant',
    ),
    reviewedStaffApplication(
      rejectedId,
      'Rejected',
      'Juniper Bakery',
      '456 Juniper Avenue',
      'other',
      'Bakery',
    ),
  ];

  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/applications/staff' && route.request().method() === 'GET') {
      return route.fulfill({ json: applications });
    }
    throw new Error(`Unexpected request: ${route.request().method()} ${pathname}`);
  });

  await page.goto('/test/harness.html?queue=staff');
  await page.getByTestId('tab-staff-catalog').click();

  const approvedCard = page.getByTestId(`catalog-record-${approvedId}`);
  const rejectedCard = page.getByTestId(`catalog-record-${rejectedId}`);
  const search = page.getByTestId('input-catalog-search');
  await expect(approvedCard).toBeVisible();
  await expect(rejectedCard).toBeVisible();

  await search.fill(approvedId);
  await expect(approvedCard).toBeVisible();
  await expect(rejectedCard).toHaveCount(0);

  await search.fill('2002');
  await expect(rejectedCard).toBeVisible();
  await expect(approvedCard).toHaveCount(0);

  await search.fill('456 Juniper Avenue');
  await expect(rejectedCard).toBeVisible();
  await expect(approvedCard).toHaveCount(0);

  await search.fill('bakery');
  await expect(rejectedCard).toBeVisible();
  await expect(approvedCard).toHaveCount(0);

  await search.clear();
  await page.getByTestId('select-catalog-filter').selectOption('Rejected');
  await expect(rejectedCard).toBeVisible();
  await expect(approvedCard).toHaveCount(0);
});

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
    const flagMenu = await openUrgentFlagsMenu(page);
    await expect(flagMenu.getByText('Loading flagged items…')).toBeVisible();
    releaseFirst();
    const queue = page.getByRole('region', { name: 'High-urgency review queue' });
    await expect(queue).toBeVisible();
    await expect(flagMenu.getByRole('alert')).toContainText('Review queue unavailable');
    await flagMenu.getByRole('menuitem', { name: 'Retry review queue' }).click();
    await expect(flagMenu.getByRole('menuitem', { name: `High-urgency flag, ticket ${ticketId}, needs review` })).toBeVisible();
    await expect(page.getByTestId('button-urgent-flags')).toHaveAttribute('aria-label', 'High-urgency workspace flags, 1 active');
    const flagActions = await openUrgentFlagActions(page, flagMenu);
    await flagActions.getByRole('menuitem', { name: 'Acknowledge flag' }).click();
    await expect(flagActions.getByRole('alert')).toContainText('Acknowledgement could not be saved');
    await expect(flagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toBeVisible();
    await flagActions.getByRole('menuitem', { name: 'Acknowledge flag' }).click();
    await expect.poll(() => acknowledgementAttempts).toBe(2);
    await expect.poll(() => queueReads).toBeGreaterThanOrEqual(3); // invalidation refetched the GET
    await expect(flagMenu.getByText('No active high-urgency flags. Previously acknowledged items are listed below.')).toBeVisible();
    await expect(flagMenu.getByRole('menuitem', { name: `High-urgency flag, ticket ${ticketId}, acknowledged` })).toBeVisible();
    await expect(flagActions.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(flagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toHaveCount(0);
    await page.reload();
    const reloadedFlagMenu = await openUrgentFlagsMenu(page);
    await expect(reloadedFlagMenu.getByText('No active high-urgency flags. Previously acknowledged items are listed below.')).toBeVisible();
    const reloadedFlagActions = await openUrgentFlagActions(page, reloadedFlagMenu, 'acknowledged');
    await expect(reloadedFlagActions.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(reloadedFlagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toHaveCount(0);
  });
}

test('urgent flag dropdown exposes the empty state and closes with Escape', async ({ page }) => {
  await page.route('**/api/workspace/escalations', route => route.fulfill({ json: [] }));
  await page.goto('/test/harness.html?desk=Fire%20Prevention');

  const trigger = page.getByTestId('button-urgent-flags');
  await expect(trigger).toHaveAttribute('aria-label', 'High-urgency workspace flags, 0 active');
  const menu = await openUrgentFlagsMenu(page);
  await expect(menu.getByText('No active high-urgency flags.', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

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
    const firstFlagMenu = await openUrgentFlagsMenu(firstReviewer);
    const firstFlagActions = await openUrgentFlagActions(firstReviewer, firstFlagMenu);
    await expect(firstFlagActions.getByText('Awaiting prototype staff acknowledgement')).toBeVisible();
    await expect(firstFlagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toBeVisible();

    const secondReviewer = await context.newPage();
    await secondReviewer.goto('/test/harness.html?desk=Fire%20Prevention');
    const secondQueue = secondReviewer.getByRole('region', { name: 'High-urgency review queue' });
    const secondFlagMenu = await openUrgentFlagsMenu(secondReviewer);
    const secondFlagActions = await openUrgentFlagActions(secondReviewer, secondFlagMenu);
    await secondFlagActions.getByRole('menuitem', { name: 'Acknowledge flag' }).click();
    await expect(secondFlagActions.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(secondFlagActions.getByText('Acknowledged by Jordan Lee (Fire)')).toBeVisible();

    // The first reviewer's cache stays unchanged until its polling interval runs.
    await expect(firstQueue).toBeVisible();
    await expect(firstFlagActions.getByText('Awaiting prototype staff acknowledgement')).toBeVisible();
    await expect(firstFlagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toBeVisible();
    const readsBeforePolling = queueReads;
    await firstReviewer.clock.fastForward(30_000);
    await expect.poll(() => queueReads).toBeGreaterThan(readsBeforePolling);

    await expect(firstFlagMenu.getByText('No active high-urgency flags. Previously acknowledged items are listed below.')).toBeVisible();
    await expect(firstFlagActions.getByText('Acknowledged in prototype queue')).toBeVisible();
    await expect(firstFlagActions.getByText('Acknowledged by Jordan Lee (Fire)')).toBeVisible();
    await expect(firstFlagActions.getByRole('menuitem', { name: 'Acknowledge flag' })).toHaveCount(0);
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
      if (pathname === `/api/applications/${applicationId}/documents` && method === 'GET') {
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
    const statusLabel = firstQueue.locator('.staff-status-label');
    const reviewControl = firstQueue.locator('.staff-plan-card-review');
    const desktopStatusBox = await statusLabel.boundingBox();
    const desktopReviewBox = await reviewControl.boundingBox();
    expect(desktopStatusBox).not.toBeNull();
    expect(desktopReviewBox).not.toBeNull();
    expect(desktopStatusBox!.width).toBeCloseTo(160, 0);
    expect(desktopReviewBox!.width).toBeCloseTo(desktopStatusBox!.width, 0);
    expect(desktopReviewBox!.height).toBeCloseTo(desktopStatusBox!.height, 0);

    await firstReviewer.setViewportSize({ width: 402, height: 874 });
    const mobileStatusBox = await statusLabel.boundingBox();
    const mobileReviewBox = await reviewControl.boundingBox();
    expect(mobileStatusBox).not.toBeNull();
    expect(mobileReviewBox).not.toBeNull();
    expect(mobileStatusBox!.width).toBeCloseTo(mobileReviewBox!.width, 0);
    expect(mobileStatusBox!.height).toBeCloseTo(mobileReviewBox!.height, 0);
    await firstReviewer.setViewportSize({ width: 1280, height: 720 });

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
    await firstQueue.getByTestId(`button-complete-review-${applicationId}`).click();
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

    await firstReviewer.getByTestId(`button-override-${applicationId}-business-registration`).click();
    await firstReviewer.getByTestId(`button-clear-override-${applicationId}-business-registration`).click();
    await expect.poll(() => reviewerUpdates).toBe(6);
    expect(application.plan.overrides['business-registration']).toBeUndefined();
    await expect(firstReviewer.getByTestId(`text-original-recommendation-${applicationId}-business-registration`))
      .toContainText('Most new businesses start by registering the business name and structure before opening.');
    await expect(refreshedQueue).not.toContainText('Use the updated neighborhood business registration checklist.');

    // The other reviewer sees the cleared override after its next queue refresh.
    const secondReadsBeforeClearPolling = secondQueueReads;
    await secondReviewer.clock.fastForward(15_000);
    await expect.poll(() => secondQueueReads).toBeGreaterThan(secondReadsBeforeClearPolling);
    await expect(secondReviewer.getByTestId(`text-original-recommendation-${applicationId}-business-registration`))
      .toContainText('Most new businesses start by registering the business name and structure before opening.');

    // The cleared value remains absent after a full reload and reopening the active review.
    await firstReviewer.reload();
    await firstReviewer.getByTestId('tab-staff-queue').click();
    const reloadedQueue = firstReviewer.getByTestId(`active-plan-${applicationId}`);
    await reloadedQueue.getByRole('button', { name: 'Review Plan' }).click();
    await expect(firstReviewer.getByTestId(`text-original-recommendation-${applicationId}-business-registration`))
      .toContainText('Most new businesses start by registering the business name and structure before opening.');
    await expect(reloadedQueue).not.toContainText('Use the updated neighborhood business registration checklist.');

    expect(firstDocumentLoads).toBe(3);
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