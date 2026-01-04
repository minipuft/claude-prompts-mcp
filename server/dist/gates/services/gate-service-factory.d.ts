import type { IGateService } from './gate-service-interface.js';
import type { ConfigManager } from '../../config/index.js';
import type { Logger } from '../../logging/index.js';
import type { GateValidator } from '../core/gate-validator.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';
export declare class GateServiceFactory {
    private readonly logger;
    private readonly configManager;
    private readonly gateGuidanceRenderer;
    private readonly gateValidator;
    constructor(logger: Logger, configManager: ConfigManager, gateGuidanceRenderer: GateGuidanceRenderer, gateValidator: GateValidator);
    createGateService(): IGateService;
    hotReload(): Promise<IGateService>;
}
