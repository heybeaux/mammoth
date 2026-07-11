import test from 'node:test';
import { verifyMvp } from '../src/verify.js';

void test('MVP satisfies the spawned-process acceptance contract', async () => {
  await verifyMvp();
});
