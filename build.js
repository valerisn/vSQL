// Bundles the TypeScript source (and mysql2) into a single dist/index.js so the
// resource can be dropped into a server without shipping node_modules.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node16',
  outfile: 'dist/index.js',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  // mysql2 pulls these in only for non-default auth/compression paths; FXServer
  // ships without them and they're optional, so don't fail the build over them.
  external: ['aws-sdk', 'mock-aws-s3', 'nock', 'cardinal']
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[vSQL] watching for changes...');
  } else {
    await esbuild.build(options);
    console.log('[vSQL] build complete -> dist/index.js');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
