import { assert } from 'chai';
import { getSuggestedDisplayName } from '../../urlCapture';

describe('Suggested display name', function () {
    it('uses the host name', function () {
        assert.strictEqual(
            getSuggestedDisplayName('https://jupyter.example.com/jh', undefined, []),
            'jupyter.example.com'
        );
    });
    it('includes the name of a named server', function () {
        assert.strictEqual(
            getSuggestedDisplayName('https://jupyter.example.com', 'gpu', []),
            'jupyter.example.com (gpu)'
        );
    });
    it('uses a generic name for ip addresses', function () {
        assert.strictEqual(getSuggestedDisplayName('http://192.168.0.1:8000', undefined, []), 'JupyterHub');
    });
    it('does not use the reserved name localhost', function () {
        assert.strictEqual(getSuggestedDisplayName('http://localhost:8000', undefined, []), 'localhost 1');
    });
    it('avoids names that are already in use', function () {
        assert.strictEqual(
            getSuggestedDisplayName('https://jupyter.example.com', undefined, ['jupyter.example.com']),
            'jupyter.example.com 1'
        );
    });
});
