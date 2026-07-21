import { assert } from 'chai';
import { Uri } from 'vscode';
import { parseAddServerUri } from '../../uriHandler';

describe('Uri Handler', function () {
    const parse = (uri: string) => parseAddServerUri(Uri.parse(uri));

    it('ignores unknown paths', function () {
        assert.isUndefined(parse('vscode://ms-toolsai.jupyter-hub/something-else?url=https://hub.com'));
    });
    it('handles leading and trailing slashes in the path', function () {
        assert.strictEqual(
            parse('vscode://ms-toolsai.jupyter-hub/add-server/?url=https://hub.com')?.url,
            'https://hub.com'
        );
    });
    it('throws when the url is missing', function () {
        assert.throws(() => parse('vscode://ms-toolsai.jupyter-hub/add-server'));
    });
    it('throws when the url is not http(s)', function () {
        assert.throws(() => parse('vscode://ms-toolsai.jupyter-hub/add-server?url=ftp://hub.com'));
        assert.throws(() => parse('vscode://ms-toolsai.jupyter-hub/add-server?url=not a url'));
    });
    it('parses all of the parameters', function () {
        const request = parse(
            'vscode://ms-toolsai.jupyter-hub/add-server?url=https://hub.com&username=bob&token=abc123&displayName=My%20Hub&serverName=gpu'
        );
        assert.deepStrictEqual(request, {
            url: 'https://hub.com',
            username: 'bob',
            token: 'abc123',
            displayName: 'My Hub',
            serverName: 'gpu'
        });
    });
    it('infers the username and token from the url', function () {
        const request = parse('vscode://ms-toolsai.jupyter-hub/add-server?url=https://hub.com/user/bob/lab');
        assert.strictEqual(request?.username, 'bob');
        assert.strictEqual(request?.displayName, '');
        assert.isUndefined(request?.serverName);
    });
    it('parameters take precedence over the values in the url', function () {
        const request = parse(
            'vscode://ms-toolsai.jupyter-hub/add-server?url=https://hub.com/user/bob/lab&username=alice'
        );
        assert.strictEqual(request?.username, 'alice');
    });
});
