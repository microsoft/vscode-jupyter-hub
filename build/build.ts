// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as glob from 'glob';
import * as path from 'path';
import * as esbuild from 'esbuild';
import type { BuildOptions, Charset, Loader, Plugin, SameShape } from 'esbuild';
import fs from 'fs';

const isDevbuild = !process.argv.includes('--production');
const isWatchMode = process.argv.includes('--watch');
const extensionFolder = path.join(__dirname, '..');

const ImportGlobForWebTests = (): Plugin => ({
    name: 'require-context',
    setup: (build) => {
        build.onResolve({ filter: /\*/ }, async (args) => {
            if (args.resolveDir === '') {
                return; // Ignore unresolvable paths
            }

            return {
                path: args.path,
                namespace: 'import-glob',
                pluginData: {
                    resolveDir: args.resolveDir
                }
            };
        });

        build.onLoad({ filter: /.*/, namespace: 'import-glob' }, async (args) => {
            const files = glob
                .sync(args.path, {
                    cwd: args.pluginData.resolveDir
                })
                .sort();

            let importerCode = `
        ${files.map((module, index) => `import * as module${index} from './${module}'`).join(';')}

        const modules = [${files.map((module, index) => `module${index}`).join(',')}];

        export default modules;
        export const filenames = [${files.map((module, index) => `'${module}'`).join(',')}]
      `;

            return { contents: importerCode, resolveDir: args.pluginData.resolveDir };
        });
    }
});

function createConfig(source: string, outfile: string): SameShape<BuildOptions, BuildOptions> {
    const inject = [path.join(__dirname, isDevbuild ? 'process.development.js' : 'process.production.js')];
    const isWebTarget = source.toLowerCase().endsWith('.web.ts');
    const options: SameShape<BuildOptions, BuildOptions> = {
        entryPoints: [source],
        outfile,
        bundle: true,
        external: ['log4js', 'vscode'], // From webacpk scripts we had.
        target: 'es2018',
        minify: !isDevbuild,
        format:'cjs',
        logLevel: 'info',
        sourcemap: isDevbuild,
        inject,
        plugins: []
    };
    if (isWebTarget) {
        options.define = {
            BROWSER: 'true', // From webacpk scripts we had.
            global: 'this'
        };
        options.external!.push('node:crypto');
        if (source.includes('test') && source.toLowerCase().endsWith('index.web.ts')) {
            options.plugins?.push(ImportGlobForWebTests());
        }
    } else {
        options.platform = 'node';
    }
    return options;
}
async function build(source: string, outfile: string, watch = isWatchMode) {
    if (watch) {
        const context = await esbuild.context(createConfig(source, outfile));
        await context.watch();
    } else {
        await esbuild.build(createConfig(source, outfile));
        const size = fs.statSync(outfile).size;
        const relativePath = `./${path.relative(extensionFolder, outfile)}`;
        console.log(`asset ${relativePath} size: ${(size / 1024).toFixed()} KiB`);
    }
}
async function watch(source: string, outfile: string) {}

async function buildAll() {
    await Promise.all([
        build(
            path.join(extensionFolder, 'src', 'extension.node.ts'),
            path.join(extensionFolder, 'dist', 'extension.node.js')
        ),
        build(
            path.join(extensionFolder, 'src', 'extension.web.ts'),
            path.join(extensionFolder, 'dist', 'extension.web.js')
        ),
        isDevbuild
            ? build(
                  path.join(extensionFolder, 'src', 'test', 'suite', 'index.web.ts'),
                  path.join(extensionFolder, 'dist', 'test', 'suite', 'test.index.web.js')
              )
            : Promise.resolve()
    ]);
}

const started = Date.now();
buildAll();
