/**
 * `@mezzanine-ui/icons` is ESM-only, so the CommonJS test environment cannot
 * load it — importing any icon from a component under test fails the whole
 * suite before a single assertion runs. Specs never inspect an icon, they only
 * pass it through to a Mezzanine component, so every name resolves to an opaque
 * stub. Mapped in `jest.config.cts`; the real package is untouched.
 *
 * The stub carries an empty `definition` because a real Mezzanine `Icon`
 * (rendered when a spec uses an unmocked control) spreads `definition.svg` and
 * `definition.path`.
 *
 * Plain CommonJS on purpose: the library `tsconfig` targets ES modules, where
 * the `export =` a Proxy module needs is a compile error.
 */
module.exports = new Proxy(
  {},
  {
    get: (_target, property) => ({
      definition: { path: {}, svg: {} },
      name: String(property),
    }),
  },
);
