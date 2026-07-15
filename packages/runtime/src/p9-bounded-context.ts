export function boundedSentenceContext(
  body: string,
  startOffset: number,
  endOffset: number,
): string {
  const priorBoundary = Math.max(
    body.lastIndexOf('.', Math.max(0, startOffset - 1)),
    body.lastIndexOf('!', Math.max(0, startOffset - 1)),
    body.lastIndexOf('?', Math.max(0, startOffset - 1)),
    body.lastIndexOf('\n', Math.max(0, startOffset - 1)),
  );
  const lastSelected = body[endOffset - 1];
  const endsAtBoundary =
    lastSelected === '.' ||
    lastSelected === '!' ||
    lastSelected === '?' ||
    lastSelected === '\n';
  const following = endsAtBoundary
    ? endOffset
    : [
        body.indexOf('.', endOffset),
        body.indexOf('!', endOffset),
        body.indexOf('?', endOffset),
        body.indexOf('\n', endOffset),
      ].filter((index) => index >= 0);
  const contextEnd =
    typeof following === 'number'
      ? following
      : following.length === 0
        ? body.length
        : Math.min(...following) + 1;
  return body.slice(priorBoundary + 1, contextEnd).trim();
}
