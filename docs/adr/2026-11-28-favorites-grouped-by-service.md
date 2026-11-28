# Favorites Grouped by Service

## Status

Accepted

## Context

The Favorites view of the Explorer preview showed a flat list in stored order,
capped at twenty pages. That is enough for a handful of favorites and stops
working past a dozen: readers of the CDK reference think in services ("my
queues", "my buckets"), so a flat list makes them read every row to find one.
The cap made the problem smaller by refusing work rather than by solving it,
and the refusal surfaced as a message on the page star.

Grouping needs an answer to four questions, and each of them has more than one
defensible answer:

- **Where does a group come from?** Nothing in a favorite says which service it
  belongs to. The page id carries the owning module, and the site has one place
  that turns a module into a service: the generated sidebar's Services list,
  which names services rather than grouping them.
- **What happens when the reader disagrees?** A grouping that cannot be
  overridden is a layout, not a tool. One that is only manual asks every reader
  to do setup before the view is useful.
- **Where does the arrangement live?** The stored favorites are read by the
  preview-off sidebar, the page star and the search ranking, so a new shape
  would have to be migrated in all four places at once.
- **What is the order?** Any order that the reader cannot see the rule for reads
  as no order at all.

## Decision

**A favorite's group comes from a fixed category map, and the reader's own
placement wins over it.** The map is a checked-in file,
`docs/.vitepress/theme/favorite-categories.json`: 24 AWS category names and one
entry per package or submodule id. A page id's first dot-part is its package
(the first `_` of a scoped name standing for `/`). A second part that starts
lower case is a submodule, and then `<package>.<submodule>` is the only entry
consulted — there is no fallback to the package, so a page under a submodule the
map does not name goes to Ungrouped even when its package is mapped. That is
what sends the `aws-cdk-lib.interfaces.*` reference-interface pages to
Ungrouped: `interfaces` reads as their submodule. A page whose second part
starts upper case is a type of the package itself, and the package entry decides.

A map rather than a heuristic, because the category of a service is a fact
about AWS and not something a renderer can derive: `aws_sqs` is Application
integration and `aws_s3` is Storage, and no spelling rule says so. A checked-in
file rather than a generated one, because the categories are editorial and a
build step cannot invent them. A unit test fails when a module docgen documents
is in neither the map nor an explicit list of unmapped ids, so a new service
cannot quietly land in Ungrouped.

**The service name on a row comes from the sidebar skeleton, not from the map.**
A row reads `Queue · SQS`, and that second word is the name the Explorer's own
Services list shows for the entry that owns the page, matched by the longest
module stem the entry lists. Reading the skeleton costs no request — the
Explorer has already fetched and memoized it — and it means the two lists can
never disagree about what a service is called: `EKS (legacy)` and `EKS V2` stay
distinct, `aws-cdk-lib` names its own root types, and a page in neither list
shows no service at all. Deriving a second name from the map's category would
have produced `Queue · Application integration`, which answers a different
question than the one a reader scanning for their queues is asking.

**The group is stored on the favorite, in the array that already exists.**
`cdk-docs:favourites` keeps its name and its shape, an array of
`{ path, title }`, and gains one optional field: `group` is a string for the
reader's group and `null` for their own move to Ungrouped. Absent means the map
decides — when the map has a category it is written back on the next read, and
when it has none the field stays absent and the favorite shows in Ungrouped, so
a category added for it later still reaches it. There is nothing to version and
no migration step for the new theme: every other reader of the key — the
preview-off sidebar, the page star, the search boost — keeps working on the
fields it already reads, and unknown fields are dropped on read, as they were.
A tab still running the previous theme is the exception, and the Consequences
below say what it costs.

Three new keys carry what does not belong on a favorite:
`cdk-docs:favourites:groups` (names the reader made or renamed to, which is
what keeps an empty group alive), `cdk-docs:favourites:aliases` (a map group
name to the reader's name for it) and
`cdk-docs:favourites:collapsed-groups` (the folded groups). Separate keys
rather than one object, for the same reason the collapse flag already has its
own: a key can be added without touching the shape of the favorites
themselves. The spelling of `cdk-docs:favourites` and its prefixed keys stays
as shipped, because renaming a stored key loses data rather than prose.

**An alias is what makes a rename stick.** Renaming a group the map produces
stores `Compute` -> `Servers`, so a Compute page favorited later joins
`Servers` instead of recreating `Compute` beside it. Renaming again moves the
alias, renaming back to the map's own name drops it, and deleting the group
drops it too, so the next Compute page creates `Compute` again. Renaming a
group the reader made stores no alias, because no map category points at it.
Without the alias the reader's rename would be undone by the next page they
starred, which reads as the view forgetting what they did.

**The order is A to Z by name, Ungrouped last, rows A to Z by title.** A rule a
reader can see beats one they have to learn, and it holds whoever named the
group: a group the reader made sorts in among the map's. For map groups alone
that order is also the order of the category list in the map file. Manual order
is a separate feature with its own storage and its own interaction, and it is
not in this change.

**The twenty-favorite cap is gone**, with the message on the page star that
announced it. The grouped list is the reason the cap existed, and it no longer
needs one.

**The view keeps the Escape it uses.** Escape closes an open menu or a name
field, and the sidebar closes the phone drawer when the key is released, so a
reader on a phone would lose the whole drawer to the key that closed a menu.
The view swallows that release only when it used the key; an Escape with
nothing open still closes the drawer. The Undo toast shows `Ctrl+Z` beside its
button and the button names the shortcut in `aria-keyshortcuts`, so the way
back is on the screen as well as in the announcement.

## Consequences

- Favorites stored before this change show up grouped on the next load, with no
  action from the reader, and the written-back array is the only migration.
- A favorite the reader moves stops following the map, including a move to
  Ungrouped. That is the point: the map decides only what nothing else has.
- A favorite the map placed keeps the group it was given, so a later edit that
  moves a module to another category does not regroup it. That is the cost of
  storing the answer, which is what makes the written-back array the whole
  migration. A page the map cannot place keeps no `group` at all, so a category
  added for it later does reach it on the next read.
- Three keys hold the reader's arrangement, so clearing site data loses the
  grouping along with the favorites. They are in this browser either way.
- A tab still running the previous theme writes the old shape: it truncates the
  list to twenty and drops every `group`. A reader who stars a page in such a
  tab after a deploy loses the favorites past twenty and their own placements,
  until that tab is reloaded. Nothing in the new theme can reach a page that is
  already loaded, so this is the cost of removing the cap rather than something
  to fix in code.
- The rows depend on the sidebar skeleton for their service names. When that
  fetch fails the rows still carry their titles and their groups; only the
  service word is missing.
- The category map is a file someone has to maintain. Its coverage is a test
  that runs every documented module id through the lookup the site uses, so a
  module the lookup cannot place surfaces as a failing build rather than as rows
  quietly piling up in Ungrouped. The map the view ships with leaves 21
  documented module ids unplaced, which the test lists by name.
- A group with no favorites in it exists only if the reader made or renamed it.
  A map group disappears when its last favorite goes, and comes back with the
  next page from that service.
- The store grew from four operations to a dozen, and undo is a snapshot of the
  three stored values rather than per-action inverse logic. A snapshot is what
  makes "Undo" after a group delete restore the favorites, the group name and
  the alias together, which three separate inverses would have to keep in step.

This extends the favorites decision in
docs/adr/2026-10-15-sidebar-navigation.md, which recorded the flat array, the
cap and the collapse key, and the Favorites view in
docs/adr/2026-11-26-explorer-preview-rail.md. Both stand except for the cap,
which this removes.
