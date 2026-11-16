# No Type Links on Go and C# Field Names

## Status

Accepted

Extends [no type links in literals](./2026-10-26-no-type-links-in-literals.md),
which stays Accepted: the linker there skips tokens inside strings and
comments; this entry adds struct field and object property names in Go and C#
to the text it skips, and widens the gate that decides which fences request
grammar scopes so such a key is seen even in a fence without a quote.
Everything else about that decision stands, including the grammar-scope
marker, the token split and the cache key.

## Context

Docgen offers a type name for linking when it appears in live code, and the
linker then links every copy of the name. Go and C# capitalize struct fields
and properties, so a field can spell a type name that the same example also
uses: in a Go composite literal `&awsdynamodb.TableProps{ Stream:
awsdynamodb.StreamViewType_NEW_IMAGE }` the key `Stream` was linked to the
Kinesis `Stream` class, and a C# object initializer `new TableProps { Stream =
... }` did the same. A field name is never a type reference, so the link is
wrong. TypeScript, Python and Java spell their keys in lower case, so they do
not collide and are untouched.

## Decision

- **Decide per token, from the grammar first.** Shiki scopes a Go
  composite-literal key, an identifier before `:`, as
  `variable.other.property.go`, while a type is `entity.name.type.go`, a bare
  selector is `variable.other.go` and a function or constructor is
  `entity.name.function.*`. A token whose innermost scope is the Go property
  scope is marked text.
- **C# falls back to the following character.** The C# grammar has no
  property-name scope: an initializer name shares `variable.other.readwrite.cs`
  with every plain variable read. So a token in that scope is text when the
  rest of its line starts with a lone `=`, which makes it an assignment target;
  in generated examples that is the object-initializer property, and a plain
  statement such as `Stream = other;` is marked the same way on purpose, since
  an assignment target is never a type reference either. `==` and `=>` do not
  count, so comparisons and lambdas keep their identifiers as code. A variable
  read that spells a type name stays as it was.
- **Same marker, same linker.** The field-name rule sits beside the literal
  rule in `isNolinkScope` and feeds the existing `code-nolink` class, so the
  linker needs no change: a run whose span carries the class is left alone.
  The transformer now sees each line's text so the C# rule can look past the
  token.
- **Fences without quotes still get scopes when they need them.** The gate that
  asks Shiki for scope names also fires for a capitalized identifier at a line
  start or after `{`, `,` or `(`, followed by `:` (not `:=`) or a lone `=`, the
  shape of a Go key or C# property, inline or on its own line. Lower-case keys in
  the other languages do not trigger it; an upper-case constant assignment
  (`BUCKET = ...`) does, which costs one scoped highlight and changes no output.

## Consequences

- On a `Table` page the Go example's `Stream:` key is plain while `TableProps`
  still links, and the C# `Stream =` property is plain while `new Stream(...)`,
  `Stream` in a signature, and `StreamViewType.NEW_IMAGE` still link.
- A Go selector such as `table.TableArn` keeps its plain variable scope and is
  unaffected: it links only when its name is offered, exactly as before.
- A C# variable read that spells a type name (`return Stream;`) is unchanged by
  this rule: it still links, as it did before.
- `test/example-nolink.test.ts` runs the real highlighter on Go and C# examples
  whose field names equal an offered type, and the Go literal case now expects
  only `BucketProps`: its one `RemovalPolicy` link came from the field key.
  `test/example-type-links.test.ts` runs the Go `Table` example through docgen's
  attribute and the highlight-time marker together.
