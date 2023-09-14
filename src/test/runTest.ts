// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import { spawnSync } from 'child_process';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const vscodeExecutablePath = await downloadAndUnzipVSCode('insiders');
        const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
        console.info(`Installing Jupyter Extension`);
        spawnSync(cliPath, ['--install-extension', 'ms-toolsai.jupyter', '--disable-telemetry'], {
            encoding: 'utf-8',
            stdio: 'inherit'
        });

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}

main().catch((ex) => console.error('Unexpected error in running tests', ex));
