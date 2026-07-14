import { spawn } from 'node:child_process';

const verificationSteps: readonly (readonly string[])[] = [
  ['pnpm', '--filter', '@mammoth/provider-port', 'test'],
  ['pnpm', '--filter', '@mammoth/openai-compatible-provider', 'test'],
  ['pnpm', '--filter', '@mammoth/persistence', 'test', '--', 'p7'],
  ['pnpm', '--filter', '@mammoth/p7-application-service', 'test'],
  ['pnpm', '--filter', '@mammoth/temporal-adapter', 'test', '--', 'p7'],
  ['pnpm', '--filter', '@mammoth/cli', 'test', '--', 'p7'],
];

for (const step of verificationSteps) {
  await run(step);
}

async function run(step: readonly string[]): Promise<void> {
  const [command, ...args] = step;
  if (!command) throw new Error('empty verification step');
  process.stdout.write(`\n$ ${[command, ...args].join(' ')}\n`);
  await new Promise<void>((resolveStep, rejectStep) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', rejectStep);
    child.on('close', (code) => {
      if (code === 0) resolveStep();
      else rejectStep(new Error(`${command} exited with ${String(code)}`));
    });
  });
}
