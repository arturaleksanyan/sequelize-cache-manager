module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
    },
    extends: [
        'eslint:recommended',
    ],
    env: {
        node: true,
        es6: true,
    },
    rules: {
        'no-console': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
    },
};

