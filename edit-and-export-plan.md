# JSON Browser Edit and Export Plan

## Goal

Extend the JSON browser so users can edit selected scalar record fields and export
a modified JSON file, while preserving the current single-file, dependency-free,
offline-first architecture.

This should be an editing extension to the browser, not a full JSON editor. The
first version should focus on scalar record fields such as strings, numbers,
booleans, nulls, and empty values. Nested arrays and objects should remain
read-only.

## Design Goals

- Keep `json/json-browser.html` self-contained.
- Keep the app dependency-free and browser-only.
- Do not require a backend or build step.
- Do not write to disk automatically.
- Preserve the original loaded JSON structure and metadata on export.
- Keep editing state out of shareable URLs.
- Make accidental edits visible and reversible.

## Proposed User Workflow

1. Load JSON using the existing URL, file picker, or drag-and-drop flow.
2. Enable edit mode from the sidebar.
3. Edit scalar values inline on record cards.
4. See changed records and fields visually marked.
5. Optionally reset edits.
6. Export a modified JSON file.

## Initial Scope

Version 1 should include:

- An `Edit mode` toggle.
- Inline editing for scalar fields.
- Edit tracking by original record index.
- Visual dirty state for edited cards and fields.
- A dirty-record count.
- `Reset edits`.
- `Export JSON`.

Version 1 should exclude:

- Nested object or array editing.
- URL persistence of edits.
- Patch-file import/export.
- Multi-user or backend persistence.
- Schema-aware validation beyond basic type preservation.

## State Model

Add edit-related fields to the existing global `state` object:

```js
editMode: false,
edits: {},              // recordIndex -> field -> edited value
dirtyRecords: new Set()
```

The browser currently stores records directly in `state.filtered` and
`state.pageItems`. Editing needs stable record identity after filtering and
pagination, so filtered/page items should carry the original record index:

```js
{ record, index }
```

The original index should refer to the record's position in the selected record
array. This allows export to patch the correct record even when the visible list
is filtered or paginated.

## Record Identity

Arbitrary JSON may not have stable IDs, so the first implementation should use
the original array index as the record identity.

For a root array:

```js
clone[index][field] = editedValue;
```

For a top-level record array:

```js
clone[state.recordKey][index][field] = editedValue;
```

Changing the main record array should clear edits, because record indices refer
to the selected array.

## Rendering Design

In `renderCards`, scalar values should branch on edit mode:

- Edit mode off: render with the existing `renderValue` path.
- Edit mode on, scalar field editable: render an input control.
- Nested fields: continue rendering as read-only expandable sections.

Recommended controls:

- Strings: text input.
- Numbers: number input.
- Booleans: select with `true` and `false`.
- Null or empty values: text input for version 1.

The rendered value should use the edited value when one exists, falling back to
the original record value.

## Type Handling

Version 1 should preserve the original type where practical:

- Original number plus valid numeric input exports as a number.
- Original boolean exports as a boolean.
- Original string exports as a string.
- Original null can export as a string after editing.
- Empty string remains an empty string.

More explicit null handling can be added later with a small type selector or
clear-to-null control.

## Event Handling

Use event delegation on `#cards` for edit controls.

On edit:

1. Read `data-record-index` and `data-field`.
2. Coerce the input value based on the original value's type.
3. Store the result in `state.edits[index][field]`.
4. Add the index to `state.dirtyRecords`.
5. Re-render dirty markers and dirty count.

If an edited value equals the original value, remove that field edit. If a record
has no remaining edited fields, remove it from `state.edits` and
`state.dirtyRecords`.

## Export Design

Do not mutate `state.raw` directly while editing.

On export:

1. Deep-clone `state.raw`.
2. Locate the selected record array in the clone.
3. Apply all edits by record index and field.
4. Serialize using `JSON.stringify(clone, null, 2)`.
5. Download using a `Blob` and temporary object URL.

The export should preserve:

- Top-level metadata.
- Non-selected arrays.
- Nested fields.
- Original field order as much as JavaScript object serialization allows.

Suggested filename:

```text
<original-name-without-extension>.edited.json
```

## UI Additions

Add a small edit area in the existing sidebar, near the Display controls:

- `Edit mode` checkbox.
- Dirty count, for example `3 edited records`.
- `Reset edits` button.
- `Export JSON` button.

For the first implementation, all scalar fields can be editable when edit mode is
enabled. A later version can add an editable-field selector if accidental edits
become a problem.

## URL Behavior

Do not include edits in the URL.

The current URL system should continue to handle source file, search, filters,
pagination, and display options only. This keeps shareable URLs lightweight and
avoids leaking modified data into browser history.

## Code Areas To Change

Most changes should be contained in `json/json-browser.html`:

- `state`: add edit state.
- `loadData` / `setRecordSource`: clear edits when data or record source changes.
- `apply`: preserve original record indices in filtered and paginated results.
- `recordMatches`: support indexed record wrappers or keep matching on raw records.
- `renderCards`: render edit controls and dirty markers.
- `#cards` event handling: capture edit input changes.
- Sidebar markup: add edit controls.
- New helpers: edit coercion, dirty tracking, export, reset edits.

## Risks And Tradeoffs

- Index-based identity is simple but tied to the selected record array. If records
  are reordered in a future feature, edits must keep their original indices.
- Inline inputs increase DOM complexity and may affect performance for very large
  pages, especially with `Records per page = all`.
- Type handling can become complex if users need explicit nulls, arrays, or
  numbers with formatting. Keep version 1 conservative.
- The single-file architecture remains appropriate, but this feature increases
  the need for focused manual or automated regression checks.

## Suggested Implementation Order

1. Add edit state and reset helpers.
2. Change filtering/page items to preserve original record indices.
3. Add sidebar edit controls.
4. Render scalar edit inputs in `renderCards`.
5. Add delegated edit event handling and dirty markers.
6. Add export helper and download button.
7. Manually test URL loading, file loading, filtering, editing, reset, and export.

