// @lifecycle canonical - Manages background services with uniform start/stop hooks.
export interface ManagedService {
  /** Unique identifier for the service */
  readonly name: string;
  /** Start the service (may be synchronous or async) */
  start(): Promise<void> | void;
  /** Stop the service (should be idempotent) */
  stop(): Promise<void> | void;
}

interface RegisteredService {
  service: ManagedService;
  started: boolean;
}

/**
 * ServiceManager orchestrates lifecycle for background services (watchers, timers, etc.).
 * It prevents duplicate starts, provides deterministic shutdown order, and makes it easier
 * to restart services when configuration changes.
 */
export class ServiceManager {
  private services = new Map<string, RegisteredService>();

  register(service: ManagedService): void {
    if (this.services.has(service.name)) {
      throw new Error(`Service "${service.name}" already registered`);
    }
    this.services.set(service.name, { service, started: false });
  }

  hasService(name: string): boolean {
    return this.services.has(name);
  }

  async startService(name: string): Promise<void> {
    const entry = this.services.get(name);
    if (!entry || entry.started) {
      return;
    }
    await entry.service.start();
    entry.started = true;
  }

  async stopService(name: string): Promise<void> {
    const entry = this.services.get(name);
    if (!entry?.started) {
      return;
    }
    await entry.service.stop();
    entry.started = false;
  }

  async startAll(): Promise<void> {
    for (const [name] of this.services) {
      await this.startService(name);
    }
  }

  async stopAll(): Promise<void> {
    const entries = Array.from(this.services.values());
    for (const entry of entries.reverse()) {
      if (entry.started) {
        await entry.service.stop();
        entry.started = false;
      }
    }
  }
}
