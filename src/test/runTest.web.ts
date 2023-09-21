// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runTests } from '@vscode/test-web';
import * as path from 'path';
import { EXTENSION_DIR, TEMP_DIR } from './constants.node';
import { getExtensionsDir, startJupterHub } from './suite/helpers.node';
import { dispose } from '../common/lifecycle';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawnSync } from 'child_process';

async function main() {
    const disposables: { dispose(): void }[] = [];
    let exitCode = 0;
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        disposables.push(await startJupterHub());

        const extensionTestsPath = path.resolve(EXTENSION_DIR, 'dist/web/test/suite/test.index.web.js');
        const vscodeExecutablePath = await downloadAndUnzipVSCode('insiders');
        const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
        const extensionsDir = await getExtensionsDir();

        console.info(`Installing Jupyter Extension`);
        spawnSync(
            cliPath,
            [
                '--install-extension',
                'ms-toolsai.jupyter',
                '--pre-release',
                '--extensions-dir',
                extensionsDir,
                '--disable-telemetry'
            ],
            {
                encoding: 'utf-8',
                stdio: 'inherit'
            }
        );

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            folderPath: TEMP_DIR,
            browserType: 'chromium',
            quality: 'insiders'
        });
    } catch (err) {
        console.error('Failed to run tests', err);
        exitCode = 1;
    } finally {
        dispose(disposables);
    }

    // Not all promises complete. Force exit
    process.exit(exitCode);
}

main().catch((ex) => console.error('Unexpected error in running tests', ex));
