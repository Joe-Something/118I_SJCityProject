import { expect, test, type Page, type Route } from '@playwright/test';

const checkedAt = '2026-09-30T12:00:00.000Z';

function prototypeSource(id: string, state: 'demo' | 'outdated' | 'unavailable') {
  return {
    id,
    topic: 'rules',
    title: `Example source ${id}`,
    version: 'prototype-1',
    revisedAt: '2026-09-29T00:00:00.000Z',
    officialReferenceUrl: 'https://www.sanjoseca.gov/business/development-services-permit-center',
    content: `Fictional example content for ${id}`,
    checkedAt,
    state,
  };
}

function record(id: string, options: { synthetic: boolean; freshness: 'demo' | 'cached' | 'outdated' }) {
  return {
    id,
    category: 'Commercial',
    status: 'Issued',
    department: 'Building',
    language: options.synthetic ? 'English' : 'Not provided',
    description: options.synthetic ? 'Fictional example record' : 'Commercial/industrial building permit metadata',
    synthetic: options.synthetic,
    sourceUrl: options.synthetic ? null : 'https://data.sanjoseca.gov/dataset/last-30-days-building-permits',
    updatedAt: checkedAt,
    sourceDate: options.synthetic ? null : '2026-09-25T12:00:00.000Z',
    sourceImportedAt: options.synthetic ? null : '2026-09-27T12:00:00.000Z',
    freshness: options.freshness,
  };
}

async function routeWorkspace(page: Page, handlers: {
  records?: (route: Route, url: URL) => Promise<void>;
  prototypes?: (route: Route) => Promise<void>;
}) {
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/workspace/conversations' && method === 'GET') {
      return route.fulfill({ json: [] });
    }
    if (pathname === '/api/workspace/records' && method === 'GET' && handlers.records) {
      return handlers.records(route, new URL(route.request().url()));
    }
    if (pathname === '/api/workspace/prototype-sources' && method === 'GET' && handlers.prototypes) {
      return handlers.prototypes(route);
    }
    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });
}

test('reference records show loading and empty states', async ({ page }) => {
  let releaseRecords!: () => void;
  const initialRead = new Promise<void>(resolve => { releaseRecords = resolve; });
  await routeWorkspace(page, {
    records: async (route, url) => {
      if (url.searchParams.get('mode') === 'research') {
        await initialRead;
      }
      await route.fulfill({ json: [] });
    },
    prototypes: async route => route.fulfill({ json: [] }),
  });
  await page.goto('/test/harness.html');
  const referenceDesk = page.locator('.ws-reference');
  await expect(referenceDesk.locator('.ws-ref-skeleton')).toBeVisible();
  releaseRecords();
  await expect(referenceDesk.getByText('No records found')).toBeVisible();
  await expect(referenceDesk.getByText('Reference records will appear here when available.')).toBeVisible();
});

test('public record errors can be retried and outdated and synthetic records stay distinct', async ({ page }) => {
  let recordReads = 0;
  await routeWorkspace(page, {
    records: async route => {
      recordReads++;
      if (recordReads === 1) {
        await route.fulfill({ status: 503, json: { error: 'Source cache unavailable' } });
        return;
      }
      await route.fulfill({ json: [
        record('SJ-OPEN-2026-001-CI', { synthetic: false, freshness: 'outdated' }),
        record('DEMO-D2-EXAMPLE-01', { synthetic: true, freshness: 'demo' }),
      ] });
    },
    prototypes: async route => route.fulfill({ json: [] }),
  });

  await page.goto('/test/harness.html');
  const referenceDesk = page.locator('.ws-reference');
  await expect(referenceDesk.getByText('References unavailable')).toBeVisible();
  await expect(referenceDesk.getByText(/couldn't load the source cache/i)).toBeVisible();
  await referenceDesk.getByTestId('button-retry-records').click();

  const publicRecord = referenceDesk.getByTestId('card-record-SJ-OPEN-2026-001-CI');
  await expect(publicRecord).toContainText('Import overdue — verify directly with City');
  await expect(publicRecord.getByTestId('link-record-source-SJ-OPEN-2026-001-CI')).toHaveAttribute(
    'href',
    'https://data.sanjoseca.gov/dataset/last-30-days-building-permits',
  );
  const syntheticRecord = referenceDesk.getByTestId('card-record-DEMO-D2-EXAMPLE-01');
  await expect(syntheticRecord.getByText('Demo Data — Synthetic')).toBeVisible();
  await expect(syntheticRecord.getByText('Fictional example record')).toBeVisible();
  await expect(syntheticRecord.getByTestId('link-record-source-DEMO-D2-EXAMPLE-01')).toHaveCount(0);
  expect(recordReads).toBe(2);
});

test('prototype source loading, retry, stale, and unavailable states remain explicitly synthetic', async ({ page }) => {
  let releaseFirstRead!: () => void;
  const firstRead = new Promise<void>(resolve => { releaseFirstRead = resolve; });
  let sourceReads = 0;
  await routeWorkspace(page, {
    records: async route => route.fulfill({ json: [] }),
    prototypes: async route => {
      sourceReads++;
      if (sourceReads === 1) {
        await firstRead;
        await route.fulfill({ status: 503, json: { error: 'Prototype source check failed' } });
        return;
      }
      await route.fulfill({ json: [
        prototypeSource('demo-outdated', 'outdated'),
        prototypeSource('demo-unavailable', 'unavailable'),
      ] });
    },
  });

  await page.goto('/test/harness.html');
  await page.getByTestId('button-mode-live').click();
  const referenceDesk = page.locator('.ws-reference');
  await expect(referenceDesk.locator('.ws-ref-skeleton')).toBeVisible();
  releaseFirstRead();
  await expect(referenceDesk.getByText('Demo documents unavailable')).toBeVisible();
  await referenceDesk.getByTestId('button-retry-prototype-sources').click();

  await expect(referenceDesk.getByText('Outdated example — do not rely on it')).toBeVisible();
  await expect(referenceDesk.getByText('Example unavailable — not for use')).toBeVisible();
  await expect(referenceDesk.getByText('This fictional example is unavailable and must not be used.')).toBeVisible();
  const outdated = referenceDesk.getByTestId('card-prototype-source-demo-outdated');
  const unavailable = referenceDesk.getByTestId('card-prototype-source-demo-unavailable');
  await expect(outdated.getByText('Demo Data — Synthetic')).toBeVisible();
  await expect(unavailable.getByText('Demo Data — Synthetic')).toBeVisible();
  await expect(unavailable.getByText('Fictional example content for demo-unavailable')).toHaveCount(0);
  await expect(referenceDesk.getByText('Open City source page').first()).toHaveAttribute(
    'href',
    'https://www.sanjoseca.gov/business/development-services-permit-center',
  );
  expect(sourceReads).toBe(2);
});