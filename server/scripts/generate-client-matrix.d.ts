export interface SetupClient {
  id: string;
  name: string;
  hooks: string;
  install?: string;
  steps?: string[];
  hooksNote?: string;
  companion?: { name: string; url?: string };
  configFile?: string;
  configFormat?: string;
}

export interface SharedSetup {
  id: string;
  name: string;
  install: string;
  clients: string[];
  steps: string[];
}

export function validateClients(data: unknown): string[];
export function renderReadmeSetup(
  clients: readonly SetupClient[],
  sharedSetups?: readonly SharedSetup[]
): string;
export function renderHooksTable(clients: readonly SetupClient[]): string;
export function renderConfigTable(clients: readonly SetupClient[]): string;
export function replaceRegion(text: string, name: string, body: string): string;
