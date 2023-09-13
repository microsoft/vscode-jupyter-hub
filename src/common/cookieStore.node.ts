// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parse } from 'cookie';
import { BaseCookieStore } from './cookieStore.base';

export class CookieStore extends BaseCookieStore {
    parseCookies(response: Response): { cookie: string; path?: string }[] {
        const cookiesByPath = new Map<string, Set<string>>();
        const cookies: string[] =
            'raw' in response.headers && typeof response.headers.raw === 'function'
                ? response.headers.raw()['set-cookie']
                : undefined;
        if (Array.isArray(cookies) && cookies.length) {
            cookies.forEach((c) => {
                const cookie = parse(c);
                const cookiePath = cookie.Path || '/';
                const allCookiesInThisPath = cookiesByPath.get(cookiePath) || new Set<string>();
                // Find the name of the cookie.
                const cookieName = Object.keys(cookie).find((k) => c.startsWith(k))!;
                allCookiesInThisPath.add(`${cookieName}=${cookie[cookieName]}`);
                cookiesByPath.set(cookiePath, allCookiesInThisPath);
            });
        }
        const cookiesToSend: { cookie: string; path?: string }[] = [];
        cookiesByPath.forEach((cookiesInPath, p) => {
            Array.from(cookiesInPath).forEach((c) => {
                cookiesToSend.push({ cookie: c, path: p });
            });
        });
        return cookiesToSend;
    }
}
