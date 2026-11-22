import path from 'node:path';
import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Activities } from '../src/activities';
import type { hotelOffersWorkflow } from '../src/workflows';
import {
  ERROR_TYPES,
  SUPPLIER_LABEL,
  type HotelOffer,
  type SaveHotelsInput,
  type SupplierId,
} from '../src/types/hotel';

/**
 * Runs the REAL workflow in the Temporal sandbox against a local dev server with
 * FAKE activities, so orchestration logic (parallelism, partial failure, dedupe,
 * persistence) is tested without HTTP or Redis.
 *
 * First run downloads the Temporal dev server (needs internet). To use a binary
 * you already have:  TEMPORAL_CLI_PATH=/path/to/temporal npm test
 */

const offer = (name: string, price: number, supplier: SupplierId, commissionPct: number): HotelOffer => ({
  name,
  price,
  supplier: SUPPLIER_LABEL[supplier],
  commissionPct,
});

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') }); // keep test output readable
  const cliPath = process.env.TEMPORAL_CLI_PATH;
  env = await TestWorkflowEnvironment.createLocal(
    cliPath ? { server: { executable: { type: 'existing-path', path: cliPath } } } : undefined,
  );
});

afterAll(async () => {
  await env?.teardown();
});

interface Harness {
  saved: SaveHotelsInput[];
  fetchCalls: { supplier: SupplierId; startedAt: number }[];
  run: () => ReturnType<typeof execute>;
}

async function execute(
  fakeFetch: (supplier: SupplierId, city: string) => Promise<HotelOffer[]>,
  harness: Pick<Harness, 'saved' | 'fetchCalls'>,
) {
  const taskQueue = `test-${Math.random().toString(36).slice(2)}`;
  const activities: Activities = {
    fetchSupplierHotels: async ({ supplier, city }) => {
      harness.fetchCalls.push({ supplier, startedAt: Date.now() });
      return fakeFetch(supplier, city);
    },
    saveHotelsToCache: async (input) => {
      harness.saved.push(input);
      return { count: input.hotels.length, ttlSeconds: 60 };
    },
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.join(__dirname, '../src/workflows/index.ts'),
    activities,
  });

  return worker.runUntil(
    env.client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
      taskQueue,
      workflowId: `wf-${taskQueue}`,
      args: [{ city: 'delhi' }],
    }),
  );
}

const newHarness = () => ({ saved: [] as SaveHotelsInput[], fetchCalls: [] as Harness['fetchCalls'] });

describe('hotelOffersWorkflow', () => {
  it('calls both suppliers in parallel, dedupes by name and persists the result', async () => {
    const h = newHarness();
    const result = await execute(async (supplier) => {
      await new Promise((r) => setTimeout(r, 300)); // if calls were sequential, starts would be >=300ms apart
      return supplier === 'A'
        ? [offer('Holtin', 6000, 'A', 10), offer('Hotel Aravali', 2900, 'A', 8)]
        : [offer('Holtin', 5340, 'B', 20), offer('Leela Ambience', 9800, 'B', 14)];
    }, h);

    expect(result.degraded).toBe(false);
    expect(result.failedSuppliers).toEqual([]);
    expect(result.hotels).toEqual([
      offer('Hotel Aravali', 2900, 'A', 8),
      offer('Holtin', 5340, 'B', 20),
      offer('Leela Ambience', 9800, 'B', 14),
    ]);

    expect(h.fetchCalls).toHaveLength(2);
    const [first, second] = h.fetchCalls;
    expect(Math.abs((second?.startedAt ?? 0) - (first?.startedAt ?? 0))).toBeLessThan(250);

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ city: 'delhi', degraded: false, failedSuppliers: [], hotels: result.hotels });
  });

  it('returns a degraded result when one supplier fails, and flags it for the cache', async () => {
    const h = newHarness();
    const result = await execute(async (supplier) => {
      if (supplier === 'A') {
        throw ApplicationFailure.nonRetryable('Supplier responded with HTTP 400', ERROR_TYPES.SUPPLIER_CLIENT_ERROR);
      }
      return [offer('Holtin', 5340, 'B', 20)];
    }, h);

    expect(result.degraded).toBe(true);
    expect(result.failedSuppliers).toEqual(['Supplier A']);
    expect(result.hotels).toEqual([offer('Holtin', 5340, 'B', 20)]);
    expect(h.saved[0]).toMatchObject({ degraded: true, failedSuppliers: ['Supplier A'] });
  });

  it('fails with AllSuppliersUnavailable (and writes nothing) when both suppliers fail', async () => {
    const h = newHarness();
    const failure = execute(async () => {
      throw ApplicationFailure.nonRetryable('boom', ERROR_TYPES.INVALID_SUPPLIER_RESPONSE);
    }, h);

    await expect(failure).rejects.toBeInstanceOf(WorkflowFailedError);
    await failure.catch((err: WorkflowFailedError) => {
      expect(err.cause).toBeInstanceOf(ApplicationFailure);
      expect((err.cause as ApplicationFailure).type).toBe(ERROR_TYPES.ALL_SUPPLIERS_UNAVAILABLE);
    });
    expect(h.saved).toHaveLength(0);
  });

  it('treats an empty city as a valid, cacheable result', async () => {
    const h = newHarness();
    const result = await execute(async () => [], h);
    expect(result.hotels).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(h.saved[0]).toMatchObject({ hotels: [], degraded: false });
  });
});
