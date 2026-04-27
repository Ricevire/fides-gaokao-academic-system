import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['frontend/src/main.ts'],
  outfile: 'public/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  banner: {
    js: '// Generated from frontend/src by scripts/build-frontend.js. Do not edit directly.'
  }
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Frontend build watcher is running.');
} else {
  await build(options);
}
