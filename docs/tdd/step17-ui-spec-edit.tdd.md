# Step 17: App Spec Editing in React UI — TDD Evidence Report

**Date:** 25 Oct 2026  
**Status:** ✅ Complete (tested test-first, all suites green)  
**Branch:** `step17-ui-spec-edit`  

---

## 1. Goal

Allow users to interactively inspect and edit the App Spec directly in the **Plan** tab of the React UI before or during the build:
1. **Tweak field types**: Switch among `string`, `email`, `number`, `boolean`, `date`, `enum`, and `ref`.
2. **Adjust select options**: For `enum` fields, edit the comma-separated options with automatic sanitization and trimming.
3. **Add fields**: Add new fields with camelCase normalization, type, options, required toggle, and evidence (`"manual: added in editor"`).
4. **Remove fields**: Delete unneeded fields with cascading cleanup of operations (e.g. `setStatus`) or stats that reference them.
5. **Answer open questions**: Interactive quick-choice buttons (`Fixed list (enum)`, `Managed relation (ref)`, `Free text (string)`, etc.) or custom answers that immediately update the field and resolve the question.
6. **Save & Rebuild**: Send the updated spec to `PUT /api/projects/:id/contract`, creating a new version with a new hash and triggering an automatic rebuild.

---

## 2. Changes

- **`web/src/spec-editor.js`**: Pure helper functions (`toCamelCase`, `isValidCamelCase`, `updateField`, `addField`, `removeField`, `resolveOpenQuestion`, `validateSpec`).
- **`web/src/components/Plan.jsx`**: Interactive component supporting view mode, edit mode, inline field editing, inline "+ Add field" form, delete buttons, open-question quick pills, validation problem alerts, and save notifications.
- **`web/src/components/Tabs.jsx`**: Re-exports `Plan` from `./Plan.jsx`.
- **`web/src/App.jsx`**: Passes `onSaved` callback to `Plan` to refresh project state upon successful spec update.
- **`web/src/api.js`**: Adds `contract(id)` and `updateContract(id, body)` methods.
- **`web/src/styles.css`**: Adds cartoon sticker styling for `.plan-header-bar`, `.plan-alert`, `.plan-input`, `.plan-select`, `.icon-btn-delete`, `.plan-add-field-form`, and `.plan-question-card`.
- **`web/test/spec-editor.test.js`**: 14 new unit tests verifying editing, type conversion, option splitting, question resolution, and validation.

---

## 3. Test Evidence

### `web` Test Suite
```
TAP version 13
# Subtest: pipelineStatus ... ok (12 tests)
# Subtest: custom buttons and the Pages tab ... ok (3 tests)
# Subtest: memory on the stations ... ok (4 tests)
# Subtest: spec-editor: toCamelCase and validation ... ok (2 tests)
# Subtest: spec-editor: updateField ... ok (4 tests)
# Subtest: spec-editor: addField and removeField ... ok (2 tests)
# Subtest: spec-editor: resolveOpenQuestion ... ok (2 tests)
# Subtest: spec-editor: validateSpec ... ok (4 tests)
1..8
# tests 33
# suites 8
# pass 33
# fail 0
```

### `builder-api` Test Suite
```
1..84
# tests 314
# suites 84
# pass 314
# fail 0
```

### Vite Build (`npm run build`)
```
✓ 32 modules transformed.
dist/index.html                   0.84 kB
dist/assets/index-CLTenpJ3.css   36.89 kB │ gzip: 13.65 kB
dist/assets/index-lxh_nOrj.js   265.62 kB │ gzip: 83.14 kB
✓ built in 318ms
```
