/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  // Run build/test for all changed projects (at once)
  '(apps|libs)/**/*.ts': () => [
    'npm run build', // The order of builds matter
    'npm run test',
  ],

  // Run prettier for rest of the files
  '*': ['prettier --ignore-unknown --write'],
}
