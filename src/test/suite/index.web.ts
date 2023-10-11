// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setIsWebExtension } from '../../utils';
import { setWebSocketCreator } from './helpers';
import { getWebsocketCtor } from './websocketCtor.web';

/* eslint-disable import/no-unresolved */
// @ts-ignore Ignore compiler warnings.
import allWebTestes from './*.test.ts';
if (!allWebTestes) {
    // We want to ensure this variable is used.
    console.log(allWebTestes ? 'Bogus log' : '');
}

setIsWebExtension();
setWebSocketCreator(getWebsocketCtor);

// Imports mocha for the browser, defining the `mocha` global.
export function run(): Promise<void> {
    require('mocha/mocha');
    return new Promise((c, e) => {
        mocha.setup({
            ui: 'bdd',
            reporter: undefined
        });


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
}
