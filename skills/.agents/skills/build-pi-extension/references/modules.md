# TypeScript Module Design Rules

## Purpose

A module is a file with its own exports.
A subject is what a group of definitions describes or changes.
A type describes values that code can use.
A central type gives a module its main subject.
An operation reads or changes a value.

This guide gives reusable rules for TypeScript module design across projects.
It draws on the module models in Gleam and OCaml.
Type-only modules are forbidden.

## Source ideas

The [Gleam module tour](https://tour.gleam.run/basics/modules/) groups definitions that belong together under one module name.
That name keeps ownership visible when another module uses those definitions.
The [OCaml module guide](https://ocaml.org/docs/modules) separates a module's public interface from its implementation.
The interface exposes only the definitions that callers need.
Abstract and read-only types show how an interface can hide representation and control how callers create values.
Both models group related types and operations under a subject.
Neither requires one module per type.

## Group by subject

Choose one subject as the organizing point for a module.
Keep its central type with related types and functions that define its behavior.
Other modules import the type from its owner instead of defining a copy.
A module can contain many related types and operations.
Related definitions can include:

- Types that describe the subject, its states, or its parts.
- Errors that its operations raise or handle.
- Types for its inputs and outputs.
- Functions that create or change its values.

## Choose boundaries by independence

Create a module when a group has its own rules, a useful interface, and reasons to change separately.
Keep related definitions in one module when they share rules or change together.
Treat file length as a review signal, not as a rule for grouping modules.
Do not split a subject only to place each type or operation in a separate file.

## Keep errors local

Define each error beside the operations that raise or handle it.
Define a combined error type beside the public interface that returns it.
Do not collect unrelated errors in an error-only module.

## Keep dependencies few and one-way

Keep dependencies few and one-way.

Wiring code joins modules to build an application.
Let wiring code import subject modules, and keep subject modules independent of wiring code.

Let one subject module import another only when its rules require that relationship.
If two modules import each other, move shared definitions to their owner or group related definitions together.
A module with many unrelated imports is wiring code or a sign of poor grouping.

## Use module names in imports

Use namespace imports when a file uses several exports from one module.
That keeps related names together and avoids a long import list.

```ts
import * as Order from "./order.js"

const total = Order.total(order)
```

Use named imports when a small number of names makes the call site clearer.

## Adapt external systems

Keep subject types and rules in their owning module.
Keep translation between a subject and external systems in an adapter.
Let the adapter import the owner type and implement its interface.
Use the owner type instead of copying it into the adapter or caller.

## Keep the public interface narrow

Export the names that callers need.
Keep internal helpers private.
An entry module is the public file callers import.
When a project publishes a package, use its entry point and `exports` map to limit consumer access.
Keep it focused on public exports.
Keep each definition in the module that owns its subject.

## Review questions

Use these questions when reviewing module structure:

- Can a reader find a central type beside its related operations?
- Does each module group definitions by one subject?
- Does each import represent a real dependency?
- Do errors live beside the operations that raise or handle them?
- Does a new module reduce dependencies and give its definitions one owner?
