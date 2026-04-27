import { closePool } from '../src/db.js';
import { validateMigrationPolicy } from '../src/migrator.js';

function printSummary(result) {
  console.log('Migration policy check passed.');
  console.table([
    {
      migrations: result.migrations.length,
      applied: result.applied.length,
      pending: result.pending.length,
      checksumChanged: result.checksumChanged.length,
      orphaned: result.orphaned.length
    }
  ]);
}

validateMigrationPolicy()
  .then(printSummary)
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
