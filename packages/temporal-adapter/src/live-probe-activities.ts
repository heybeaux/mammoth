const attempts = new Map<string, number>();

export function retryProbeActivity(challengeId: string): string {
  const attempt = (attempts.get(challengeId) ?? 0) + 1;
  attempts.set(challengeId, attempt);
  if (attempt === 1) {
    throw new Error(`intentional retry probe failure for ${challengeId}`);
  }
  return `retry-ok:${challengeId}:${String(attempt)}`;
}
