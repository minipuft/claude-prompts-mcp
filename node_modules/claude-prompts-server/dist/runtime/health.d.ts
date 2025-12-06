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
export declare function buildHealthReport(input: HealthReportInput): HealthReport;
