import { Client, Connection } from '@temporalio/client';
import type { AppLogger } from '../utils/logger';

/**
 * Lazily connects to Temporal and caches the connection. The API process can
 * therefore boot (and report "temporal: down" on /health) even if Temporal is
 * still starting, instead of crash-looping.
 */
export class TemporalClientProvider {
  private connecting?: Promise<{ client: Client; connection: Connection }>;

  constructor(
    private readonly address: string,
    private readonly namespace: string,
    private readonly logger: AppLogger,
  ) {}

  private connect(): Promise<{ client: Client; connection: Connection }> {
    if (!this.connecting) {
      this.connecting = (async () => {
        const connection = await Connection.connect({
          address: this.address,
          connectTimeout: '5s',
        });
        this.logger.info({ address: this.address, namespace: this.namespace }, 'Temporal client connected');
        return { connection, client: new Client({ connection, namespace: this.namespace }) };
      })().catch((err: unknown) => {
        this.connecting = undefined; // allow a fresh attempt on the next call
        throw err;
      });
    }
    return this.connecting;
  }

  async getClient(): Promise<Client> {
    return (await this.connect()).client;
  }

  /** Round-trips to the Temporal frontend; throws if it is unreachable. */
  async ping(timeoutMs = 2_000): Promise<void> {
    const { connection } = await this.connect();
    await connection.withDeadline(Date.now() + timeoutMs, () =>
      connection.workflowService.getSystemInfo({}),
    );
  }

  async close(): Promise<void> {
    if (!this.connecting) return;
    try {
      const { connection } = await this.connecting;
      await connection.close();
    } catch {
      /* never connected - nothing to close */
    }
  }
}
