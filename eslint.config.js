import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**', 'src/catalog/**'],
    rules: {
      // Determinism: the planning engine must not read time or randomness.
      // See spec/implementation-design.md "Id assignment and determinism".
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'The engine must be deterministic: no Date.now (spec/implementation-design.md).',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'The engine must be deterministic: no new Date() (spec/implementation-design.md).',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'The engine must be deterministic: no Math.random (spec/implementation-design.md).',
        },
      ],
    },
  },
);
