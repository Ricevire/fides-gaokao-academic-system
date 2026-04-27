import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReportDir = path.join(projectRoot, 'reports', 'capacity');

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

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}

async function login({ baseUrl, username, password }) {
  if (!username || !password) return null;

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) {
    throw new Error(`login failed: ${response.status} ${payload.message || ''}`.trim());
  }
  return payload.token;
}

async function requestOnce({ baseUrl, item, token }) {
  const startedAt = process.hrtime.bigint();
  try {
    const url = item.startsWith('http://') || item.startsWith('https://') ? item : `${baseUrl}${item.startsWith('/') ? item : `/${item}`}`;
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined
    });
    await response.arrayBuffer();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      durationMs
    };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return {
      ok: false,
      status: 'error',
      durationMs,
      error: error.message || String(error)
    };
  }
}

async function runCapacityTest({
  baseUrl,
  paths,
  durationMs,
  concurrency,
  token,
  reportDir,
  minSuccessRate,
  maxP95Ms
}) {
  await mkdir(reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationMs;
  const latencies = [];
  const statusCounts = {};
  const errors = {};
  let total = 0;
  let success = 0;
  let sequence = 0;

  async function worker() {
    while (Date.now() < deadline) {
      const item = paths[sequence % paths.length];
      sequence += 1;
      const result = await requestOnce({ baseUrl, item, token });

      total += 1;
      if (result.ok) success += 1;
      latencies.push(result.durationMs);

      const statusKey = String(result.status);
      statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
      if (result.error) errors[result.error] = (errors[result.error] || 0) + 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const sorted = latencies.slice().sort((a, b) => a - b);
  const actualDurationMs = Date.now() - (new Date(startedAt).getTime());
  const successRate = total ? success / total : 0;
  const summary = {
    total,
    success,
    failed: total - success,
    successRate: Number(successRate.toFixed(4)),
    rps: Number((total / Math.max(actualDurationMs / 1000, 1)).toFixed(2)),
    minMs: Number((sorted[0] || 0).toFixed(1)),
    p50Ms: Number(percentile(sorted, 50).toFixed(1)),
    p95Ms: Number(percentile(sorted, 95).toFixed(1)),
    p99Ms: Number(percentile(sorted, 99).toFixed(1)),
    maxMs: Number((sorted[sorted.length - 1] || 0).toFixed(1))
  };

  const gates = {
    minSuccessRate,
    maxP95Ms,
    passed: successRate >= minSuccessRate && summary.p95Ms <= maxP95Ms
  };
  const report = {
    type: 'fides-capacity-test',
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl,
    durationMs: actualDurationMs,
    configuredDurationMs: durationMs,
    concurrency,
    paths,
    summary,
    gates,
    statusCounts,
    errors
  };
  const reportFile = path.join(reportDir, `capacity-${timestamp()}.json`);
  await writeFile(reportFile, `${JSON.stringify({ ...report, reportFile }, null, 2)}\n`, 'utf8');

  return { ...report, reportFile };
}

function printHelp() {
  console.log(`Usage:
  node scripts/capacity-test.js [options]

Options:
  --base-url http://localhost:3000
  --paths /health/live,/health/ready
  --duration-ms 30000
  --concurrency 10
  --auth-username admin --auth-password password
  --min-success-rate 0.99
  --max-p95-ms 1500
  --report-dir reports/capacity
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baseUrl = cleanBaseUrl(options['base-url'] || process.env.CAPACITY_BASE_URL);
  const paths = String(options.paths || process.env.CAPACITY_PATHS || '/health/live,/health/ready')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!paths.length) throw new Error('at least one path is required');

  const durationMs = asNumber(options['duration-ms'] || process.env.CAPACITY_DURATION_MS, 30_000);
  const concurrency = Math.max(1, Math.floor(asNumber(options.concurrency || process.env.CAPACITY_CONCURRENCY, 10)));
  const minSuccessRate = Math.min(1, asNumber(options['min-success-rate'] || process.env.CAPACITY_MIN_SUCCESS_RATE, 0.99));
  const maxP95Ms = asNumber(options['max-p95-ms'] || process.env.CAPACITY_MAX_P95_MS, 1500);
  const reportDir = path.resolve(projectRoot, options['report-dir'] || process.env.CAPACITY_REPORT_DIR || defaultReportDir);
  const token = await login({
    baseUrl,
    username: options['auth-username'] || process.env.CAPACITY_AUTH_USERNAME,
    password: options['auth-password'] || process.env.CAPACITY_AUTH_PASSWORD
  });

  const report = await runCapacityTest({
    baseUrl,
    paths,
    durationMs,
    concurrency,
    token,
    reportDir,
    minSuccessRate,
    maxP95Ms
  });

  console.log(`Capacity report: ${report.reportFile}`);
  console.table(report.summary);
  console.log(`Gate: ${report.gates.passed ? 'passed' : 'failed'} (successRate >= ${minSuccessRate}, p95Ms <= ${maxP95Ms})`);
  if (!report.gates.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
