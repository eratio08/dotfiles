# Namespace imports and tree-shaking

## Finding

A namespace import groups exports under one local name.
Tree-shaking removes unused code from a bundle.
The rule in [the module design guide](modules.md#use-module-names-in-imports) recommends namespace imports when a file uses several exports, and named imports when a short list reads more clearly.
This is a reasonable style choice, not a TypeScript anti-pattern.
The [TypeScript Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) documents `import * as mod` as standard module syntax.
It shows that `module: "esnext"` preserves this syntax and that `module: "commonjs"` converts it to `require`.
For bundled code, TypeScript recommends `preserve` or `esnext` in its [`module` option](https://www.typescriptlang.org/tsconfig/module.html).
[Webpack's tree-shaking guide](https://webpack.js.org/guides/tree-shaking/) says that tree-shaking relies on static `import` and `export` syntax, which must not be converted to CommonJS before bundling.
The emitted module format matters more than the `* as` spelling alone.

## Bun check

I built two in-memory modules with Bun 1.4.2 and `Bun.build`.
The entry used `import * as Order from "./order.ts"` and read `Order.total`.
The other module exported `total` and `unused`.
Bun emitted `total` and dropped `unused`.
When the entry used `Object.keys(Order)`, Bun kept both exports.
This check shows that static property access can be tree-shaken in Bun, but use of the whole namespace can keep every export.
For dynamic `import()` and `require()` results, Bun's [bundler guide](https://bun.sh/docs/bundler#tree-shaking-import-and-require-results) also lists escaping, spreading, iteration, and computed property access as cases that keep every export.

## Bun barrel-file caveat

Bun's `optimizeImports` option targets files that only re-export other modules.
Bun says that an `import *` makes this option load all submodules instead of skipping unused submodules.
This caveat applies to that Bun option and those re-export files, not to every namespace import.
See the [Bun `optimizeImports` documentation](https://bun.sh/docs/bundler#optimizeimports).

## Recommendation

Keep the current guidance in `references/modules.md`.
Use namespace imports when several related exports make the module name useful at the call site.
Use named imports when only a few exports are needed or when Bun's `optimizeImports` must select from a large re-export file.
Avoid enumerating, spreading, or passing a namespace to unknown code when you need per-export pruning.
Keep `import` and `export` syntax intact until the bundler runs.
