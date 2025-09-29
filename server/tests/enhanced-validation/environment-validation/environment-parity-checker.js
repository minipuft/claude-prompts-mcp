/**
 * Environment Parity Validation System
 *
 * Validates consistency between local and CI environments to prevent
 * environment-specific failures in GitHub Actions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Environment Parity Checker
 *
 * Detects environment differences that could cause CI failures
 */
export class EnvironmentParityChecker {
  constructor(logger) {
    this.logger = logger;
    this.projectRoot = path.resolve(__dirname, '../../..');
  }

  /**
   * Validate Node.js version against package.json requirements
   */
  async validateNodeVersion() {
    try {
      const packagePath = path.join(this.projectRoot, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

      const currentVersion = process.version;
      const engineRequirement = packageJson.engines?.node;

      if (!engineRequirement) {
        return {
          valid: true,
          currentVersion,
          requiredVersion: 'Not specified',
          warning: 'No Node.js version requirement specified in package.json'
        };
      }

      // Parse version requirement (handle >=16, ^18, etc.)
      const versionMatch = engineRequirement.match(/([>=^~]*)([0-9.]+)/);
      if (!versionMatch) {
        return {
          valid: false,
          currentVersion,
          requiredVersion: engineRequirement,
          error: 'Invalid version requirement format'
        };
      }

      const [, operator, requiredVersion] = versionMatch;
      const currentMajor = parseInt(currentVersion.slice(1).split('.')[0]);
      const requiredMajor = parseInt(requiredVersion.split('.')[0]);

      let compatible = false;
      let details = '';

      switch (operator) {
        case '>=':
          compatible = currentMajor >= requiredMajor;
          details = `Current ${currentMajor} >= Required ${requiredMajor}`;
          break;
        case '^':
          compatible = currentMajor >= requiredMajor;
          details = `Current ${currentMajor} compatible with ^${requiredMajor}`;
          break;
        case '~':
          compatible = currentMajor === requiredMajor;
          details = `Current ${currentMajor} matches ~${requiredMajor}`;
          break;
        default:
          compatible = currentMajor >= requiredMajor;
          details = `Current ${currentMajor} >= Required ${requiredMajor} (default check)`;
      }

      return {
        valid: compatible,
        currentVersion,
        requiredVersion: engineRequirement,
        details,
        recommendation: compatible ? null : `Upgrade Node.js to meet requirement: ${engineRequirement}`
      };

    } catch (error) {
      return {
        valid: false,
        error: `Node version validation failed: ${error.message}`,
        currentVersion: process.version
      };
    }
  }

  /**
   * Validate environment variables consistency
   */
  async validateEnvironmentVariables() {
    const criticalEnvVars = [
      'NODE_ENV',
      'MCP_SERVER_ROOT',
      'MCP_PROMPTS_CONFIG_PATH'
    ];

    const envReport = {
      valid: true,
      variables: {},
      missing: [],
      recommendations: []
    };

    for (const varName of criticalEnvVars) {
      const value = process.env[varName];

      envReport.variables[varName] = {
        defined: value !== undefined,
        value: value || null,
        source: 'process.env'
      };

      if (!value && varName === 'NODE_ENV') {
        envReport.missing.push(varName);
        envReport.recommendations.push('Set NODE_ENV=test for testing environments');
        envReport.valid = false;
      }
    }

    // Check for CI-specific variables
    const ciIndicators = ['CI', 'GITHUB_ACTIONS', 'ACT'];
    const ciDetected = ciIndicators.some(varName => process.env[varName]);

    envReport.ciEnvironment = {
      detected: ciDetected,
      indicators: ciIndicators.filter(varName => process.env[varName]),
      isLocal: !ciDetected
    };

    // Platform-specific environment checks
    envReport.platform = {
      os: process.platform,
      arch: process.arch,
      isWindows: process.platform === 'win32',
      isWSL: process.env.WSL_DISTRO_NAME !== undefined
    };

    return envReport;
  }

  /**
   * Validate filesystem behavior for cross-platform compatibility
   */
  async validateFilesystemBehavior() {
    const testDir = path.join(this.projectRoot, 'tests', 'temp');
    const fsReport = {
      valid: true,
      pathSeparator: path.sep,
      platform: process.platform,
      issues: [],
      recommendations: []
    };

    try {
      // Ensure test directory exists
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Test case sensitivity
      const testFile1 = path.join(testDir, 'Test.txt');
      const testFile2 = path.join(testDir, 'test.txt');

      fs.writeFileSync(testFile1, 'test1');

      try {
        fs.writeFileSync(testFile2, 'test2');

        // If both files exist, filesystem is case-sensitive
        const file1Exists = fs.existsSync(testFile1);
        const file2Exists = fs.existsSync(testFile2);

        fsReport.caseSensitive = file1Exists && file2Exists;

        // Clean up test files
        try { fs.unlinkSync(testFile1); } catch {}
        try { fs.unlinkSync(testFile2); } catch {}

      } catch (error) {
        // If writing second file fails, filesystem is case-insensitive
        fsReport.caseSensitive = false;
        try { fs.unlinkSync(testFile1); } catch {}
      }

      // Test path length limits
      const longPath = path.join(testDir, 'a'.repeat(255));
      try {
        fs.writeFileSync(longPath, 'test');
        fs.unlinkSync(longPath);
        fsReport.supportsLongPaths = true;
      } catch (error) {
        fsReport.supportsLongPaths = false;
        fsReport.issues.push('Long path support limited');
      }

      // Test symbolic links (if supported)
      try {
        const linkTarget = path.join(testDir, 'target.txt');
        const linkPath = path.join(testDir, 'symlink.txt');

        fs.writeFileSync(linkTarget, 'target');
        fs.symlinkSync(linkTarget, linkPath);

        fsReport.supportsSymlinks = fs.lstatSync(linkPath).isSymbolicLink();

        fs.unlinkSync(linkPath);
        fs.unlinkSync(linkTarget);

      } catch (error) {
        fsReport.supportsSymlinks = false;
        fsReport.issues.push('Symbolic link support unavailable');
      }

      // Clean up test directory
      try {
        fs.rmdirSync(testDir);
      } catch (error) {
        // Directory might not be empty or might not exist
      }

    } catch (error) {
      fsReport.valid = false;
      fsReport.error = `Filesystem validation failed: ${error.message}`;
    }

    return fsReport;
  }

  /**
   * Validate package dependencies consistency
   */
  async validatePackageDependencies() {
    try {
      const packagePath = path.join(this.projectRoot, 'package.json');
      const lockfilePath = path.join(this.projectRoot, 'package-lock.json');

      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      let lockfileExists = false;
      let lockfileData = null;

      try {
        lockfileData = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
        lockfileExists = true;
      } catch (error) {
        // Lockfile doesn't exist or is invalid
      }

      const dependencyReport = {
        valid: true,
        packageJsonExists: true,
        lockfileExists,
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
        issues: [],
        recommendations: []
      };

      // Check for critical MCP dependencies
      const criticalDeps = ['@modelcontextprotocol/sdk'];
      const missingCritical = criticalDeps.filter(dep =>
        !dependencyReport.dependencies.includes(dep)
      );

      if (missingCritical.length > 0) {
        dependencyReport.valid = false;
        dependencyReport.issues.push(`Missing critical dependencies: ${missingCritical.join(', ')}`);
        dependencyReport.recommendations.push('Install missing MCP SDK dependencies');
      }

      // Check lockfile consistency (if exists)
      if (lockfileExists && lockfileData) {
        const lockfileDeps = Object.keys(lockfileData.dependencies || {});
        const packageDeps = [...dependencyReport.dependencies, ...dependencyReport.devDependencies];

        const mismatchedDeps = packageDeps.filter(dep => !lockfileDeps.includes(dep));

        if (mismatchedDeps.length > 0) {
          dependencyReport.issues.push(`Dependencies not in lockfile: ${mismatchedDeps.join(', ')}`);
          dependencyReport.recommendations.push('Run npm install to update lockfile');
        }
      }

      if (!lockfileExists) {
        dependencyReport.recommendations.push('Generate package-lock.json for dependency consistency');
      }

      return dependencyReport;

    } catch (error) {
      return {
        valid: false,
        error: `Dependency validation failed: ${error.message}`,
        packageJsonExists: false
      };
    }
  }

  /**
   * Generate comprehensive environment parity report
   */
  async generateParityReport() {
    this.logger.debug('[ENV PARITY] Starting comprehensive environment validation');

    const startTime = Date.now();

    const nodeVersion = await this.validateNodeVersion();
    const envVars = await this.validateEnvironmentVariables();
    const filesystem = await this.validateFilesystemBehavior();
    const dependencies = await this.validatePackageDependencies();

    const validationTime = Date.now() - startTime;

    const overallValid = nodeVersion.valid && envVars.valid && filesystem.valid && dependencies.valid;

    const report = {
      timestamp: new Date(),
      validationTime,
      overall: {
        valid: overallValid,
        environment: envVars.ciEnvironment.detected ? 'CI' : 'Local',
        platform: process.platform,
        nodeVersion: process.version
      },
      components: {
        nodeVersion,
        environmentVariables: envVars,
        filesystem,
        dependencies
      },
      recommendations: [
        ...nodeVersion.recommendation ? [nodeVersion.recommendation] : [],
        ...envVars.recommendations,
        ...filesystem.recommendations,
        ...dependencies.recommendations
      ]
    };

    this.logger.debug('[ENV PARITY] Environment validation completed', {
      valid: overallValid,
      validationTime,
      platform: process.platform
    });

    return report;
  }

  /**
   * Quick environment compatibility check
   */
  async quickCompatibilityCheck() {
    const nodeCheck = await this.validateNodeVersion();
    const envCheck = await this.validateEnvironmentVariables();

    return {
      compatible: nodeCheck.valid && envCheck.valid,
      issues: [
        ...(nodeCheck.valid ? [] : [nodeCheck.error || nodeCheck.recommendation]),
        ...(envCheck.valid ? [] : envCheck.recommendations)
      ].filter(Boolean)
    };
  }
}

/**
 * Factory function for creating checker instance
 */
export function createEnvironmentParityChecker(logger) {
  return new EnvironmentParityChecker(logger);
}