import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CONFIG_PATH = path.join(REPO_ROOT, "e2e", "config.json");

export type E2EConfig = {
  readonly fixtureDirectory: string;
  readonly workspacePrefix: string;
  readonly excludeFromWorkspace: readonly string[];
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly command: string;
    readonly healthPath: string;
    readonly timeout: number;
    readonly reuseExistingServer: boolean;
  };
  readonly playwright: {
    readonly testDirectory: string;
    readonly fullyParallel: boolean;
    readonly workers: number;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
    };
  };
  readonly tests: {
    readonly discoverySearchTimeout: number;
    readonly discoveryViewTimeout: number;
    readonly discoveryMcpTimeout: number;
    readonly newTileTimeout: number;
    readonly registryWaitTimeout: number;
    readonly registryPollInterval: number;
    readonly layoutTolerancePx: number;
  };
};

export function loadE2EConfig(): E2EConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as E2EConfig;
}
