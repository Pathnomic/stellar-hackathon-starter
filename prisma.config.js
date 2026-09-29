/**
 * Where the toolchain finds this app's shape, and where its stored information
 * lives when someone runs the toolchain by hand.
 *
 * Three things about this file are deliberate.
 *
 *  - **It is plain JavaScript with no imports.** The toolchain's own helper would
 *    make this file need the toolchain installed, and this app deliberately does
 *    not depend on it: an app that only ever runs still works, because
 *    `lib/data/` applies the steps in `prisma/migrations/` itself at start-up.
 *  - **The location is written out here, literally.** This app refuses to start
 *    while a plaintext secrets file exists (`next.config.mjs`), so there is no
 *    `.env` for a location to hide in. A file path is not a private value.
 *  - **Tellop does not read this.** When Tellop rehearses or applies a data
 *    change it supplies the location itself, per step, and never takes it from a
 *    file inside the project - the same rule it applies to every other setting a
 *    project could rewrite.
 */

export default {
  schema: 'prisma/schema.prisma',
  datasource: {
    url: 'file:./.data/app.db',
  },
};
