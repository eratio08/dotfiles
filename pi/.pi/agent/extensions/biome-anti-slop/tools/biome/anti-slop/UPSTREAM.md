# Anti-slop Biome port

This port is incomplete.
Do not treat it as a complete replacement for anti-slop.

The source is the [upstream anti-slop repository](https://github.com/dmmulroy/anti-slop).
The upstream revision is `13909c9e07590f5a85d93c62712259fe14a883f7`.
The port revision is `prototype-17`.
The tested Biome version is `2.6.4`.
The upstream license is in `LICENSE`.
The accumulating-spread companion uses [Oxc](https://github.com/oxc-project/oxc/blob/c42d6397eab5b2d5bb2bd6746c57bc2a9cad21bd/crates/oxc_linter/src/rules/oxc/no_accumulating_spread.rs).
The Oxc license is in `OXC-LICENSE`.

## Rule results

The tests run the upstream examples and selected boundary cases unless a row says otherwise.
A passing example does not prove complete parity.

| Rule | Result |
| --- | --- |
| `no-array-filter-map` | Examples pass, including selected alias and shadowing cases. |
| `no-reduce-accumulator-copy` | Examples pass, including selected alias and shadowing cases. |
| `no-accumulating-spread` | Selected Oxc examples pass; see the limitations below. |
| `no-chained-type-assertions` | Examples pass, including the `as const` exception. |
| `no-conditional-empty-object-spread` | Examples pass; the rule does not provide a rewrite. |
| `no-known-value-widening` | Examples pass, including selected alias and type predicate cases. |
| `no-module-mocking` | Jest and Vitest examples pass. |
| `no-object-parameters` | Examples pass, including selected alias cases. |
| `no-reflect-apply` | Examples pass, including selected shadowing and escaped property cases. |
| `no-reflect-get` | Examples pass, including selected shadowing and escaped property cases. |
| `no-runtime-typeof` | Examples pass for both `allowInTypeGuards` values. |
| `no-shape-in-symbol-names` | Examples pass, including selected static member and import cases. |
| `no-unknown-parameters` | Examples pass, including selected `cause` and predicate exceptions. |
| `no-unknown-returns` | Examples pass, including selected alias cases. |
| `no-unknown-type-aliases` | Examples pass, including selected generic cases. |
| `no-unsafe-dictionary-type` | Examples pass, including selected finite-key and constraint cases. |
| `no-widen-then-assert` | Examples pass; ambiguous repeated source text is skipped. |
| `require-readable-spacing` | Not installed; no supported whitespace insertion fix is available. |
| `require-safety-comment-for-type-assertion` | Not installed; initial leading comments are unavailable. |
| `no-manual-effect-error-tag` | Optional Effect examples pass. |
| `no-manual-tag-comparison` | Optional Effect examples pass. |
| `no-manual-tagged-construction` | Optional Effect examples pass. |
| `no-service-constructor-imports` | Optional Effect examples pass; package-alias imports are not detected. |
| `prefer-effect-match` | Optional Effect examples pass. |

## Rule behavior

These descriptions explain the upstream anti-slop rules and the Oxc companion.
The table above shows the Biome port's tested coverage and unsupported rules.

A type assertion tells TypeScript to treat a value as a type.
It does not check the value at runtime.
A type predicate tells TypeScript a value's type after a successful check.
A type alias gives a type a name.
A dictionary maps keys to values.

### Generic rules

- `no-array-filter-map`: This rule reports adjacent array `filter` and `map` calls, in either order.
  Iterator pipelines that process values as needed remain allowed.
- `no-reduce-accumulator-copy`: This rule reports selected non-spread copies of the value built by `reduce` or `reduceRight`.
  Examples include `acc.concat(...)` and `Object.assign({}, acc)`.
- `no-accumulating-spread`: This Oxc companion reports array or object spreads that copy an accumulated value inside a reducer or supported loop.
  Examples include `[...acc, item]` and `{ ...acc, [key]: value }`.
- `no-chained-type-assertions`: This rule reports nested `as` or angle-bracket assertions, such as `value as object as User`.
  Chains made only of `const` assertions remain allowed.
- `no-conditional-empty-object-spread`: This rule reports object spreads with a conditional empty branch, such as `...(condition ? { value } : {})`.
  The rule has no automatic rewrite because omitting a property differs from assigning `undefined`.
- `no-known-value-widening`: This rule reports known values given less specific types such as `unknown`, `object`, or `Record<string, Handler>`.
  It also reports known values passed to the `unknown` parameter that a local type predicate narrows.
  Empty dictionaries used to accumulate values and finite-key `Record` targets remain allowed.
- `no-module-mocking`: This rule reports Jest and Vitest `mock`, `doMock`, and `unstable_mockModule` calls.
  It favors replacing dependencies through real interfaces or services.
- `no-object-parameters`: This rule reports function parameters typed as `object`, a union containing `object`, or a local alias to either.
- `no-reflect-apply`: This rule reports calls to the global `Reflect.apply` function.
  It favors typed function calls.
- `no-reflect-get`: This rule reports calls to the global `Reflect.get` function.
  It favors typed property access or parsing at the input boundary.
- `no-runtime-typeof`: This rule reports runtime `typeof` expressions.
  Equality and inequality comparisons with `"undefined"` remain allowed.
  If `allowInTypeGuards` is enabled, `typeof` is also allowed inside functions with type predicate or assertion signatures.
- `no-shape-in-symbol-names`: This rule reports locally owned names that contain `shape`, regardless of case.
  Static member reads such as `schema.shape` remain allowed.
- `no-unknown-parameters`: This rule reports function parameters typed as `unknown` or a union containing it.
  A parameter named `cause` and the subject of a type predicate remain allowed.
- `no-unknown-returns`: This rule reports explicit return types that resolve to `unknown`, `Promise<unknown>`, or `PromiseLike<unknown>`.
  It also resolves local aliases and unions containing those types.
- `no-unknown-type-aliases`: This rule reports type aliases that resolve to `unknown`, including local generic aliases and unions containing `unknown`.
- `no-unsafe-dictionary-type`: This rule reports dictionary value types such as `unknown`, `any`, `object`, and `{}`.
  It also reports dictionary value aliases and unions that contain those types.
  Generic constraints such as `T extends Record<string, unknown>` remain allowed.
- `no-widen-then-assert`: This rule reports local constants that lose a known type and later regain a narrower type through an assertion.
  The broad type can be `unknown`, `any`, `object`, or a `Record` with unrestricted keys.
- `require-readable-spacing`: This rule requires blank lines between top-level statement groups and around multiline variable declarations.
  Between statements, it requires blank lines before `if`, `switch`, `try`, loops, or `return`.
  It also requires blank lines after blocks when another statement follows.
  Adjacent imports, single-line variable declarations, and overload signatures with their implementation can stay grouped.
  A leading comment on a later variable declaration starts a new group.
  The upstream fix adds whitespace only.
- `require-safety-comment-for-type-assertion`: This rule requires a nearby comment with a non-empty reason for each type assertion except `const` assertions.
  The comment must precede the assertion or its containing statement.
  The default marker is `SAFETY:`, and it must precede the reason.
  The upstream rule allows other marker names.

### Effect rules

A tagged value uses `_tag` to identify its kind.

- `no-manual-effect-error-tag`: This rule reports `_tag` comparisons with string literals and switches on `_tag` inside broad Effect catch handlers.
  These handlers use `Effect.catch`, `Effect.catchAll`, or `Effect.catchIf`.
  It favors `Effect.catchTag`, `Effect.catchTags`, `Effect.catchReason`, or `Effect.catchReasons`.
- `no-manual-tag-comparison`: This rule reports `_tag` comparisons with string literals and switches on `_tag` outside broad Effect catch handlers.
  It favors `Match` or `Predicate.isTagged`.
- `no-manual-tagged-construction`: This rule reports object literals with a literal string `_tag`, such as `{ _tag: "Ready" }`.
  Direct patterns in `Match.when` and `Match.not` remain allowed.
- `no-service-constructor-imports`: This rule reports named imports from `./` or `../` whose name starts with `make` followed by an uppercase letter.
  For example, it reports `makeUserService`.
  Imports in `*.test.*` and `*.spec.*` files remain allowed.
  It favors the service Layer.
- `prefer-effect-match`: This rule reports chains of conditional expressions that compare the same value to literals.
  It favors Effect `Match`.

## Limitations

The latest Biome release checked by this port is `2.6.4`.

Its JavaScript plugin API omits initial leading comments and has no whitespace insertion API.
The port therefore omits the safety-comment and spacing rules.

The tested named plugin suppression does not suppress JavaScript plugin diagnostics.
The port does not support per-rule severity settings.

`no-widen-then-assert` skips cases with ambiguous repeated source text.
The Oxc companion skips reducer callbacks with identical argument text and checks the assignment containing a spread, not the first write.
Biome `noAccumulatingSpread` can report some of the same cases.

Biome `2.6.4` fails to load plugins that end with an export list without a semicolon.
The port uses direct exports.
