/**
 * ServiceManager orchestrates lifecycle for background services (watchers, timers, etc.).
 * It prevents duplicate starts, provides deterministic shutdown order, and makes it easier
 * to restart services when configuration changes.
 */
export class ServiceManager {
    constructor() {
        this.services = new Map();
    }
    register(service) {
        if (this.services.has(service.name)) {
            throw new Error(`Service "${service.name}" already registered`);
        }
        this.services.set(service.name, { service, started: false });
    }
    hasService(name) {
        return this.services.has(name);
    }
    async startService(name) {
        const entry = this.services.get(name);
        if (!entry || entry.started) {
            return;
        }
        await entry.service.start();
        entry.started = true;
    }
    async stopService(name) {
        const entry = this.services.get(name);
        if (!entry?.started) {
            return;
        }
        await entry.service.stop();
        entry.started = false;
    }
    async startAll() {
        for (const [name] of this.services) {
            await this.startService(name);
        }
    }
    async stopAll() {
        const entries = Array.from(this.services.values());
        for (const entry of entries.reverse()) {
            if (entry.started) {
                await entry.service.stop();
                entry.started = false;
            }
        }
    }
}
//# sourceMappingURL=service-manager.js.map