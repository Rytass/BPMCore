import dataSource from './data-source';
import { reconcileLegacyMigrationNames } from './reconcile-legacy-migrations';

async function run(): Promise<void> {
  const action = process.argv[2] ?? 'run';
  const source = await dataSource;

  await source.initialize();

  try {
    if (action === 'revert') {
      await source.undoLastMigration();
      return;
    }

    await reconcileLegacyMigrationNames(source);
    await source.runMigrations();
  } finally {
    await source.destroy();
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
