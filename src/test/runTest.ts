// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import { spawnSync } from 'child_process';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { TEMP_DIR } from './constants.node';
import { startJupterHub } from './suite/helpers.node';
import { dispose } from '../common/lifecycle';

async function main() {
    const disposables: { dispose(): void }[] = [];
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        disposables.push(await startJupterHub());

        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const vscodeExecutablePath = await downloadAndUnzipVSCode('insiders');
        const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
        console.info(`Installing Jupyter Extension`);
        spawnSync(cliPath, ['--install-extension', 'ms-toolsai.jupyter', '--disable-telemetry'], {
            encoding: 'utf-8',
            stdio: 'inherit'
        });

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [TEMP_DIR], version: 'insiders' });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    } finally {
        dispose(disposables);
    }
}

main().catch((ex) => console.error('Unexpected error in running tests', ex));
