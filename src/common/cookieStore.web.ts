// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseCookieStore } from './cookieStore.base';

export class CookieStore extends BaseCookieStore {
    parseCookies(_response: Response): { cookie: string; path?: string }[] {
        return [];
    }
}
