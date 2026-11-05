// A development workspace .env must never produce a React development release.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
