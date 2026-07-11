#!/usr/bin/env node
// The workspace packages expose TypeScript sources during the MVP. Loading the
// local, pinned TS runtime keeps the declared bin runnable from any cwd while
// `pnpm build` still proves the complete CLI typechecks and emits JavaScript.
import 'tsx';
await import('../src/bin.ts');
