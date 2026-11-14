import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  const extensionCtx = await esbuild.context({
    ...sharedOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  });

  const mcpCtx = await esbuild.context({
    ...sharedOptions,
    entryPoints: ['src/mcpStdio.ts'],
    outfile: 'dist/mcp-stdio.js',
    banner: {
      js: '#!/usr/bin/env node',
    },
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), mcpCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([extensionCtx.rebuild(), mcpCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), mcpCtx.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
