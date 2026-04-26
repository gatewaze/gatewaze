/**
 * Custom ESLint rule per spec-platform-listing-pattern.md §20.1.
 *
 * Forbids raw SQL string concatenation / template literals in any
 * file under packages/shared/src/listing/** or **/listing-schema.ts.
 * The listing primitive must always go through the parameterised
 * Supabase query builder.
 *
 * Catches:
 *   - Template literals containing 'SELECT'/'INSERT'/'UPDATE'/'DELETE'
 *     keywords whose contents contain ${...} interpolation
 *   - String concatenation that produces a SQL keyword + a variable
 *
 * Misses (acceptable — caught by other tooling):
 *   - Raw SQL in modules outside the listing layer (uses pgrest builder
 *     directly is idiomatic; the rule is scoped to listing files only)
 *   - SQL hidden inside opaque function calls
 */

'use strict';

const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw SQL string concatenation in the listing primitive',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
    messages: {
      rawSql:
        'Raw SQL is forbidden in listing files. Use the Supabase query builder ' +
        '(.eq, .in, .gte, .lte, .ilike, .is) so values are parameterised. See ' +
        'spec-platform-listing-pattern.md §20.1.',
    },
  },

  create(context) {
    const filename = context.getFilename();
    const inListingFile =
      filename.includes('/listing/') ||
      filename.endsWith('listing-schema.ts') ||
      filename.endsWith('listing-schema.tsx');
    if (!inListingFile) return {};

    function checkLiteral(node, raw) {
      if (typeof raw !== 'string') return;
      if (!SQL_KEYWORDS.test(raw)) return;
      // Allow comments; only flag literals.
      context.report({ node, messageId: 'rawSql' });
    }

    return {
      // Template literal with at least one ${} expression that contains a SQL keyword
      TemplateLiteral(node) {
        if (node.expressions.length === 0) return;
        const fullText = node.quasis.map((q) => q.value.raw).join('${...}');
        if (SQL_KEYWORDS.test(fullText)) {
          context.report({ node, messageId: 'rawSql' });
        }
      },
      // String concat with a SQL keyword
      BinaryExpression(node) {
        if (node.operator !== '+') return;
        const left = node.left;
        const right = node.right;
        const leftIsKw = left.type === 'Literal' && typeof left.value === 'string' && SQL_KEYWORDS.test(left.value);
        const rightIsKw = right.type === 'Literal' && typeof right.value === 'string' && SQL_KEYWORDS.test(right.value);
        if (leftIsKw || rightIsKw) {
          context.report({ node, messageId: 'rawSql' });
        }
      },
    };
  },
};
