// @lifecycle canonical - Shared health reporting helper for runtime startup.
/**
 * Health reporting utilities reused by runtime and entrypoint monitoring.
 */

export interface HealthReport {
  healthy: boolean;
  modules: {
    foundation: boolean;
    dataLoaded: boolean;
    modulesInitialized: boolean;
    serverRunning: boolean;
  };
  details: {
    promptsLoaded: number;
    categoriesLoaded: number;
    serverStatus?: any;
    moduleStatus: Record<string, boolean>;
  };
  issues: string[];
}

export interface HealthReportInput {
  foundation: boolean;
  dataLoaded: boolean;
  modulesInitialized: boolean;
  serverRunning: boolean;
  moduleStatus: Record<string, boolean>;
  promptsLoaded: number;
  categoriesLoaded: number;
  serverStatus?: any;
  issues?: string[];
}

export function buildHealthReport(input: HealthReportInput): HealthReport {
  const issues = [...(input.issues ?? [])];
  const healthy =
    input.foundation &&
    input.dataLoaded &&
    input.modulesInitialized &&
    input.serverRunning &&
    issues.length === 0;

  return {
    healthy,
    modules: {
      foundation: input.foundation,
      dataLoaded: input.dataLoaded,
      modulesInitialized: input.modulesInitialized,
      serverRunning: input.serverRunning,
    },
    details: {
      promptsLoaded: input.promptsLoaded,
      categoriesLoaded: input.categoriesLoaded,
      serverStatus: input.serverStatus,
      moduleStatus: input.moduleStatus,
    },
    issues,
  };
}
