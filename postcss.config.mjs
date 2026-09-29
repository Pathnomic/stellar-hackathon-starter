/*
 * How the stylesheet is built.
 *
 * Tailwind 4 has no configuration file: the whole theme lives in `app/globals.css`
 * as `@theme`, which reads the names `app/tokens.css` and `app/fonts.css` define.
 * What still has to exist is this - the one plugin that puts Tailwind into the
 * build.
 *
 * ## It is not optional, and its absence fails misleadingly
 *
 * Without this file the build dies with `Module not found: Can't resolve
 * 'tw-animate-css'` - a message about a package, not about styling. The cause,
 * measured: `tw-animate-css` publishes only a `"style"` entry condition and no
 * `"default"` one, which the bundler's own stylesheet resolver does not honour,
 * and the deep path is closed for the same reason. With this plugin in the chain
 * Tailwind owns `@import` resolution, honours `"style"`, and the plain name
 * works. Anyone who meets that error should come here rather than chase the
 * package.
 */

const config = { plugins: { '@tailwindcss/postcss': {} } };

export default config;
