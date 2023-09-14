// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import Mocha from 'mocha';
import * as glob from 'glob';
import { setWebSocketCreator } from './helpers';
import { getWebsocketCtor } from './wesocketCtor.node';

setWebSocketCreator(getWebsocketCtor);

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '..');
    return new Promise((c, e) => {
        const testFiles = new glob.Glob('**/**.test.js', { cwd: testsRoot });
        const testFileStream = testFiles.stream();

        testFileStream.on('data', (file) => {
            mocha.addFile(path.resolve(testsRoot, file));
        });
        testFileStream.on('error', (err) => {
            e(err);
        });
        testFileStream.on('end', () => {
            try {
                // Run the mocha test
                mocha.run((failures) => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                console.error(err);
                e(err);
            }
        });
    });
}
