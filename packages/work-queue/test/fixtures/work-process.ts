import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { DurableWorkRuntime, LocalWorkStateStore } from '../../src/index.js';

const [mode, statePath, id, resultPath] = process.argv.slice(2);
if (!mode || !statePath || !id) throw new Error('missing fixture arguments');
if (mode === 'hold-lock') {
  mkdirSync(`${statePath}.lock`, { mode: 0o700 });
  const descriptor = openSync(`${statePath}.lock/owner`, 'wx', 0o600);
  writeFileSync(descriptor, `${String(process.pid)}:fixture\n`, 'utf8');
  fsyncSync(descriptor);
  closeSync(descriptor);
  writeFileSync(id, 'ready', 'utf8');
  setInterval(() => undefined, 60_000);
} else {
  const runtime = new DurableWorkRuntime(new LocalWorkStateStore(statePath));

  if (mode === 'enqueue') {
    runtime.enqueue({
      id,
      programId: 'program',
      kind: 'fixture',
      queue: 'retrieval',
      input: { id },
      idempotencyKey: `fixture:${id}`,
    });
  } else if (mode === 'claim') {
    if (!resultPath) throw new Error('claim fixture requires a result path');
    const claimed = runtime.claim('retrieval', id, 60_000);
    writeFileSync(resultPath, claimed ? claimed.item.id : 'none', 'utf8');
  } else {
    throw new Error(`unknown fixture mode: ${mode}`);
  }
}
