// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, spawnSync } from 'child_process';
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
    fs.writeFileSync(
        path.join(TEMP_DIR, 'jupyterhub.json'),
        JSON.stringify({ url, token, username: os.userInfo().username })
    );
    return spawnJupyterHub();
}

export async function getExtensionsDir(): Promise<string> {
    const name = 'vscode_jupyter_hub_exts';
    const extDirPath = path.join(TEMP_DIR, name);
    if (!fs.existsSync(extDirPath)) {
        fs.mkdirSync(extDirPath);
    }
    return extDirPath;
}

function setupTempDir() {
    if (fs.existsSync(TEMP_DIR)) {
        return;
    }
    fs.mkdirSync(TEMP_DIR);
}

export async function generateJupyberHubToken() {
    return new Promise<string>((resolve, reject) => {
        try {
            const output = spawnSync(
                CI_PYTHON_PATH,
                ['-m', 'jupyterhub', 'token', os.userInfo().username, '--log-level', 'ERROR', '--config', configFile],
                {
                    cwd: TEMP_DIR,
                    env: process.env
                }
            );
            const token = output.stdout?.toString().trim();
            if (token) {
                resolve(token);
            } else {
                reject(
                    new Error(
                        `Failed to generate JupyterHub token, ${output.error?.name}:${output.error?.message}, ${output.error?.stack}, ${output.stderr}`
                    )
                );
            }
        } catch (ex) {
            console.error('Failed to generate JupyterHub token', ex);
            reject(ex);
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
