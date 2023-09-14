module.exports = {
    env: {
        browser: true,
        es6: true,
        node: true
    },
    extends: ['prettier'],
    ignorePatterns: ['*.js', 'vscode.*.d.ts', 'vscode.d.ts', 'types'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: ['tsconfig.json'],
        sourceType: 'module'
    },
    plugins: [
        'eslint-plugin-import',
        'eslint-plugin-jsdoc',
        'eslint-plugin-no-null',
        'eslint-plugin-prefer-arrow',
        'eslint-plugin-react',
        '@typescript-eslint',
        '@typescript-eslint/tslint',
        'no-only-tests',
        'header'
    ],
    rules: {
        'no-only-tests/no-only-tests': ['error', { block: ['test', 'suite'], focus: ['only'] }],
        // Overriding ESLint rules with Typescript-specific ones
        '@typescript-eslint/ban-ts-comment': [
            'error',
            {
                'ts-ignore': 'allow-with-description'
            }
        ],
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        'no-bitwise': 'off',
        'no-dupe-class-members': 'off',
        '@typescript-eslint/no-dupe-class-members': 'error',
        'no-empty-function': 'off',
        '@typescript-eslint/no-empty-function': ['error'],
        '@typescript-eslint/no-empty-interface': 'off',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '_\\w*' }],
        'no-use-before-define': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        'no-useless-constructor': 'off',
        '@typescript-eslint/no-useless-constructor': 'error',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-floating-promises': [
            'error',
            {
                ignoreVoid: false
            }
        ],

        // Other rules
        'class-methods-use-this': 'off',
        'func-names': 'off',
        'import/extensions': 'off',
        'import/namespace': 'off',
        'import/no-extraneous-dependencies': 'off',
        'import/no-unresolved': [
            'error',
            {
                ignore: ['monaco-editor', 'vscode']
            }
        ],
        'import/prefer-default-export': 'off',
        'linebreak-style': 'off',
        'no-await-in-loop': 'off',
        'no-console': 'off',
        'no-control-regex': 'off',
        'no-extend-native': 'off',
        'no-multi-str': 'off',
        'no-param-reassign': 'off',
        'no-prototype-builtins': 'off',
        'no-restricted-syntax': [
            'error',
            {
                selector: 'ForInStatement',
                message:
                    'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.'
            },

            {
                selector: 'LabeledStatement',
                message:
                    'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.'
            },
            {
                selector: 'WithStatement',
                message: '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.'
            }
        ],
        'no-template-curly-in-string': 'off',
        'no-underscore-dangle': 'off',
        'no-useless-escape': 'off',
        'no-void': [
            'error',
            {
                allowAsStatement: true
            }
        ],
        'operator-assignment': 'off',
        'no-restricted-imports': ['error', { paths: ['lodash', 'rxjs', 'lodash/noop', 'rxjs/util/noop'] }],
        strict: 'off',
        'header/header': [
            'error',
            'line',
            [' Copyright (c) Microsoft Corporation.', ' Licensed under the MIT License.'],
            2
        ]
    },
    overrides: [
        {
            files: ['**/*.test.ts'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off'
            }
        }
    ],
    settings: {
        'import/extensions': ['.ts', '.tsx', '.d.ts', '.js', '.jsx'],
        'import/external-module-folders': ['node_modules', 'node_modules/@types'],
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts']
        },
        'import/resolver': {
            node: {
                extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx']
            }
        },
        react: {
            pragma: 'React',
            version: 'detect'
        },
        propWrapperFunctions: ['forbidExtraProps', 'exact', 'Object.freeze'],
        'import/core-modules': [],
        'import/ignore': ['node_modules', '\\.(coffee|scss|css|less|hbs|svg|json)$']
    }
};
