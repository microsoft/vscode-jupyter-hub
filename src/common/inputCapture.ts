// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationError,
    CancellationToken,
    Disposable,
    EventEmitter,
    QuickInputButton,
    QuickInputButtons,
    QuickPickItem,
    QuickPickItemButtonEvent,
    window
} from 'vscode';
import { dispose } from './lifecycle';

/**
 * Capture input with support for back buttons.
 * The input is not closed until it is disposed.
 * We keep it open as there could be other async operations happening after a value is captured.
 */
export class WorkflowInputCapture {
    private disposables: Disposable[] = [];
    public dispose() {
        dispose(this.disposables);
    }
    public async getValue(
        options: {
            title: string;
            value?: string;
            placeholder?: string;
            validationMessage?: string;
            password?: boolean;
            validateInput?(value: string): Promise<string | undefined>;
            buttons?: QuickInputButton[];
            onDidTriggerButton?: (e: QuickInputButton) => void;
        },
        token: CancellationToken
    ) {
        return new Promise<string | undefined>((resolve, reject) => {
            const input = window.createInputBox();
            this.disposables.push(new Disposable(() => input.hide()));
            this.disposables.push(input);
            input.ignoreFocusOut = true;
            input.title = options.title;
            input.buttons = options.buttons || [];
            input.ignoreFocusOut = true;
            input.value = options.value || '';
            input.placeholder = options.placeholder || '';
            input.password = options.password === true;
            input.validationMessage = options.validationMessage || '';
            input.buttons = [QuickInputButtons.Back];
            input.show();
            input.onDidChangeValue(() => (input.validationMessage = ''), this, this.disposables);
            input.onDidTriggerButton((e) => options.onDidTriggerButton?.(e), this, this.disposables);
            input.onDidHide(() => reject(new CancellationError()), this, this.disposables);
            input.onDidTriggerButton(
                (e) => {
                    if (e === QuickInputButtons.Back) {
                        resolve(undefined);
                    }
                },
                this,
                this.disposables
            );
            input.onDidAccept(
                async () => {
                    // Do not hide the input box,
                    // We keep it open as there could be other async operations happening after this.
                    // UI will be hidden upon disposing.
                    if (options.validateInput) {
                        input.validationMessage = await options.validateInput(input.value);
                        if (input.validationMessage) {
                            return;
                        }
                    }
                    // After this we always end up doing some async stuff,
                    // or display a new quick pick or ui.
                    // Hence mark this as busy until we dismiss this UI.
                    input.busy = true;
                    resolve(input.value || options.value || '');
                },
                this,
                this.disposables
            );
            token.onCancellationRequested(() => reject(new CancellationError()), this, this.disposables);
        });
    }
}

/**
 * Capture quick input with support for back buttons.
 * The input is not closed until it is disposed.
 * We keep it open as there could be other async operations happening after a value is captured.
 */
export class WorkflowQuickInputCapture {
    private disposables: Disposable[] = [];
    private readonly _onDidTriggerItemButton = new EventEmitter<QuickPickItemButtonEvent<QuickPickItem>>();
    readonly onDidTriggerItemButton = this._onDidTriggerItemButton.event;
    constructor() {
        this.disposables.push(this._onDidTriggerItemButton);
    }
    public dispose() {
        dispose(this.disposables);
    }
    public async getValue(
        options: {
            title: string;
            placeholder?: string;
            items: QuickPickItem[];
        },
        token: CancellationToken
    ) {
        return new Promise<QuickPickItem | undefined>((resolve, reject) => {
            const input = window.createQuickPick();
            this.disposables.push(input);
            input.canSelectMany = false;
            input.ignoreFocusOut = true;
            input.placeholder = options.placeholder || '';
            input.title = options.title;
            input.buttons = [QuickInputButtons.Back];
            input.items = options.items;
            input.show();
            this.disposables.push(input.onDidHide(() => reject(new CancellationError())));
            input.onDidTriggerButton(
                (e) => {
                    if (e === QuickInputButtons.Back) {
                        return resolve(undefined);
                    }
                },
                this,
                this.disposables
            );
            input.onDidTriggerItemButton((e) => this._onDidTriggerItemButton.fire(e), this, this.disposables);
            input.onDidAccept(
                () => (input.selectedItems.length ? resolve(input.selectedItems[0]) : undefined),
                this,
                this.disposables
            );
            token.onCancellationRequested(() => reject(new CancellationError()), this, this.disposables);
        });
    }
}
