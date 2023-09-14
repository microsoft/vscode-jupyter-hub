// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from 'child_process';
import { CI_PYTHON_PATH } from '../constants';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { EXTENSION_DIR, TEMP_DIR } from '../constants.node';

const configFile = path.join(EXTENSION_DIR, 'build', 'jupyterhub_config.py');
export async function startJupterHub(): Promise<{ dispose: () => void }> {
    setupTempDir();
    const token = await generateJupyberHubToken();
    const url = 'http://localhost:8000';
    fs.writeFileSync(path.join(TEMP_DIR, 'jupyterhub.json'), JSON.stringify({ url, token }));
    return spawnJupyterHub();
}

function setupTempDir() {
    if (fs.existsSync(TEMP_DIR)) {
        return;
    }
    fs.mkdirSync(TEMP_DIR);
}

export async function generateJupyberHubToken() {
    return new Promise<string>((resolve) => {
        try {
            const proc = spawn(
                CI_PYTHON_PATH,
                ['-m', 'jupyterhub', 'token', os.userInfo().username, '--config', configFile],
                {
                    cwd: TEMP_DIR,
                    env: process.env
                }
            );
            proc.stdout.on('data', (data) => {
                resolve(data.toString().trim());
            });
        } catch (ex) {
            console.error('Failed to generate JupyterHub token', ex);
        }
    });
}
function spawnJupyterHub() {
    const proc = spawn('python', ['-m', 'jupyterhub', '--config', configFile], {
        stdio: 'inherit',
        cwd: TEMP_DIR
    });
    return { dispose: () => proc.kill() };
}
