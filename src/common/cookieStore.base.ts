// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export abstract class BaseCookieStore {
    private readonly cookiesByPath = new Map<string, Set<string>>();
    abstract parseCookies(response: Response): { cookie: string; path?: string }[];

    public trackCookies(response: Response) {
        this.parseCookies(response).forEach((item) => {
            const cookies = this.cookiesByPath.get(item.path || '/') || new Set<string>();
            this.cookiesByPath.set(item.path || '/', cookies);
            cookies.add(item.cookie);
        });
    }
    public getCookiesToSend(location: string) {
        const cookiesToSend: string[] = [];
        this.cookiesByPath.forEach((c, p) => {
            if (location.includes(p) || location.includes(`${p}/`)) {
                cookiesToSend.push(...c);
            }
        });
        return cookiesToSend;
    }
    public getXsrfToken(location: string): string {
        const cookies = this.getCookiesToSend(location).filter((c) => c.startsWith('_xsrf='));
        return cookies.length ? cookies[0].trim().substring('_xsrf='.length) : '';
    }
}
