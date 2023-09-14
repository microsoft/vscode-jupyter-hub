// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { JupyterHubApi } from '../../jupyterHubApi';
import { noop } from '../../common/utils';
// import * as myExtension from '../../extension';

describe('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.').then(noop, noop);

    it('Sample test should run and vscode should import', () => {
        assert.ok(vscode);
        assert.ok(JupyterHubApi);
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });
});
