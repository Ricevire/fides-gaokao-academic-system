import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReportDir = path.join(projectRoot, 'reports', 'releases');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const [rawKey, inlineValue] = item.slice(2).split(/=(.*)/s);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
    } else if (!next || next.startsWith('--')) {
      options[rawKey] = true;
    } else {
      options[rawKey] = next;
      index += 1;
    }
  }

  return options;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanBaseUrl(value) {
  return String(value || 'http://localhost:3000').replace(/\/+$/, '');
}

async function fetchJson(url) {
  const startedAt = process.hrtime.bigint();
  const response = await fetch(url);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const payload = await response.json().catch(() => ({}));
  return {
    url,
    ok: response.ok,
    status: response.status,
    durationMs: Number(durationMs.toFixed(1)),
    payload
  };
}

async function checkHealth({ baseUrl, samples }) {
  const checks = [];
  for (let index = 0; index < samples; index += 1) {
    checks.push(await fetchJson(`${baseUrl}/health/live`));
    checks.push(await fetchJson(`${baseUrl}/health/ready`));
  }

  return {
    passed: checks.every((item) => item.ok && item.payload?.ok === true),
    checks
  };
}

async function readJson(filePath) {
  if (!filePath) return null;
  return JSON.parse(await readFile(path.resolve(projectRoot, filePath), 'utf8'));
}

function validateCapacityReport(report, { minSuccessRate, maxP95Ms }) {
  if (!report) {
    return {
      passed: null,
      reason: 'not provided'
    };
  }

  const successRate = Number(report.summary?.successRate || 0);
  const p95Ms = Number(report.summary?.p95Ms || Number.POSITIVE_INFINITY);
  return {
    passed: successRate >= minSuccessRate && p95Ms <= maxP95Ms,
    minSuccessRate,
    maxP95Ms,
    successRate,
    p95Ms,
    reportFile: report.reportFile || null
  };
}

function validateBackupManifest(manifest) {
  if (!manifest) {
    return {
      passed: null,
      reason: 'not provided'
    };
  }

  const sha256 = manifest.file?.sha256 || '';
  const totalRows = Number(manifest.totalRows || 0);
  const tableCount = Number(manifest.tableCount || 0);
  return {
    passed: /^[a-f0-9]{64}$/i.test(sha256) && tableCount > 0,
    sourceDatabase: manifest.sourceDatabase || null,
    tableCount,
    totalRows,
    backupPath: manifest.file?.path || null,
    sha256
  };
}

function decide({ health, capacity, backup, requireCapacity, requireBackup }) {
  const failures = [];
  if (!health.passed) failures.push('health check failed');
  if (requireCapacity && capacity.passed !== true) failures.push('capacity gate failed or missing');
  if (requireBackup && backup.passed !== true) failures.push('backup manifest gate failed or missing');
  return {
    passed: failures.length === 0,
    failures
  };
}

async function runReleaseCheck({
  baseUrl,
  phase,
  version,
  samples,
  capacityReportPath,
  backupManifestPath,
  minSuccessRate,
  maxP95Ms,
  requireCapacity,
  requireBackup,
  reportDir
}) {
  await mkdir(reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const [health, capacityReport, backupManifest] = await Promise.all([
    checkHealth({ baseUrl, samples }),
    readJson(capacityReportPath),
    readJson(backupManifestPath)
  ]);
  const capacity = validateCapacityReport(capacityReport, { minSuccessRate, maxP95Ms });
  const backup = validateBackupManifest(backupManifest);
  const gate = decide({ health, capacity, backup, requireCapacity, requireBackup });
  const report = {
    type: 'fides-release-check',
    startedAt,
    completedAt: new Date().toISOString(),
    phase,
    version,
    baseUrl,
    health,
    capacity,
    backup,
    gates: {
      requireCapacity,
      requireBackup,
      ...gate
    }
  };
  const reportFile = path.join(reportDir, `release-check-${timestamp()}.json`);
  await writeFile(reportFile, `${JSON.stringify({ ...report, reportFile }, null, 2)}\n`, 'utf8');
  return { ...report, reportFile };
}

function printHelp() {
  console.log(`Usage:
  node scripts/release-check.js [options]

Options:
  --phase canary|promote|rollback
  --version 1.0.0
  --base-url http://localhost:3000
  --samples 3
  --capacity-report reports/capacity/capacity-xxx.json
  --backup-manifest backups/fides_gaokao_xxx.sql.manifest.json
  --require-capacity
  --require-backup
  --min-success-rate 0.99
  --max-p95-ms 1500
  --report-dir reports/releases
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await runReleaseCheck({
    baseUrl: cleanBaseUrl(options['base-url'] || process.env.RELEASE_BASE_URL),
    phase: String(options.phase || process.env.RELEASE_PHASE || 'canary'),
    version: String(options.version || process.env.RELEASE_VERSION || 'unknown'),
    samples: Math.max(1, Math.floor(asNumber(options.samples || process.env.RELEASE_HEALTH_SAMPLES, 3))),
    capacityReportPath: options['capacity-report'] || process.env.RELEASE_CAPACITY_REPORT,
    backupManifestPath: options['backup-manifest'] || process.env.RELEASE_BACKUP_MANIFEST,
    minSuccessRate: Math.min(1, asNumber(options['min-success-rate'] || process.env.RELEASE_MIN_SUCCESS_RATE, 0.99)),
    maxP95Ms: asNumber(options['max-p95-ms'] || process.env.RELEASE_MAX_P95_MS, 1500),
    requireCapacity: Boolean(options['require-capacity'] || process.env.RELEASE_REQUIRE_CAPACITY === 'true'),
    requireBackup: Boolean(options['require-backup'] || process.env.RELEASE_REQUIRE_BACKUP === 'true'),
    reportDir: path.resolve(projectRoot, options['report-dir'] || process.env.RELEASE_REPORT_DIR || defaultReportDir)
  });

  console.log(`Release check report: ${report.reportFile}`);
  console.log(`Gate: ${report.gates.passed ? 'passed' : 'failed'}`);
  if (report.gates.failures.length) console.table(report.gates.failures);
  if (!report.gates.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
