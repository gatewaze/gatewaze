/**
 * Custom ESLint rule per spec §5.13: forbid ad-hoc 500 responses
 * outside the standard error envelope. Throw an ApiError instance
 * (lib/errors.ts) instead — the errorEnvelope middleware serialises
 * it correctly.
 *
 * Catches:
 *   res.status(500).send('oops')
 *   res.status(500).json({ error: 'oops' })
 *
 * Does NOT catch:
 *   throw new InternalServerError('oops')           // correct path
 *   res.status(401).json({ error: { code: ... } })  // structured envelope
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid ad-hoc res.status(>= 500) responses outside the standard error envelope.',
    },
    schema: [],
    messages: {
      raw: 'Use ApiError subclasses (lib/errors.ts) and let errorEnvelope serialise the response.',
    },
  },
  create(context) {
    return {
      // Match: res.status(500).send(...) or res.status(500).json(...)
      'CallExpression[callee.type="MemberExpression"]'(node) {
        const callee = node.callee;
        const inner = callee.object;
        if (
          inner?.type !== 'CallExpression' ||
          inner.callee?.type !== 'MemberExpression' ||
          inner.callee.property?.name !== 'status'
        ) return;
        const arg = inner.arguments?.[0];
        if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'number') return;
        if (arg.value < 500) return;
        if (callee.property?.name !== 'send' && callee.property?.name !== 'json') return;
        // Allow when the response body is the structured envelope shape.
        const responseArg = node.arguments?.[0];
        if (
          responseArg?.type === 'ObjectExpression' &&
          responseArg.properties.some(
            p =>
              p.type === 'Property' &&
              ((p.key.type === 'Identifier' && p.key.name === 'error') ||
                (p.key.type === 'Literal' && p.key.value === 'error')),
          )
        ) {
          return;
        }
        context.report({ node, messageId: 'raw' });
      },
    };
  },
};
