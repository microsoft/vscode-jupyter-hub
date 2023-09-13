// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const noop = () => {
    //
};

export function uuid() {
    const id = [];
    const chars = '0123456789abcdef';
    for (var i = 0; i < 36; i++) {
        id[i] = chars.substring(Math.floor(Math.random() * 0x10))[0];
    }
    id[8] = id[13] = id[18] = id[23] = '-';

    return id.join('');
}
