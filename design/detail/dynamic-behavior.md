# HyTDE Dynamic Behavior (Progressive Enhancement) (Draft)

This document defines a small, optional mechanism to add **dynamic client-side behavior** to HyTDE templates after initial render.

Dynamic behavior runs **after** HTML exists (SSR or static), so JavaScript is allowed here.

Primary focus: form validation that **leverages native HTML constraint validation** (inputs, forms) while allowing projects to customize:
- additional checks (custom constraints) and their messages.

## Goals

- Use native validation primitives (`required`, `pattern`, `min/max`, etc.) as the base.
- Provide a stable API to customize checks and messages via `<script>`.
- Bind via `hy-*` attributes (no bespoke JS wiring per page).
- Keep output accessible (ARIA) and consistent across modes.

## Non-goals

- Replacing server-side validation (server must always validate).
- A full client-side form framework.

## 1. Runtime Mode Interaction

Dynamic behaviors are executed only when HyTDE is executing:
- `hy-mode=production` (default): enabled
- `hy-mode=mock`: enabled
- `hy-mode=disable`: disabled (no DOM mutation, no event binding)

See `design/modes.md` for `hy-mode` and prototyping workflow.

## 2. Native Validation Baseline

HyTDE relies on standard HTML constraint validation:
- `HTMLInputElement.validity` / `validationMessage`
- `setCustomValidity(message)` to add custom constraints/messages
- `form.checkValidity()` / `form.reportValidity()` for form-level validation UI

Templates should express baseline constraints using standard attributes:
- `required`, `min`, `max`, `step`
- `minlength`, `maxlength`
- `pattern`
- input types like `email`, `url`, `number`, `date`, etc.

## 2.5 JSON Form Submission (Progressive Enhancement)

For business applications, submitting forms as JSON is often useful (especially when merging other dynamic payloads like table deltas).

HyTDE supports JSON submission when the form is marked with:

```html
<form hy-send-in="json" ...>
```

Behavior:
- HyTDE intercepts `submit`, runs native validation, and if valid sends the request with `Content-Type: application/json`.
- The JSON body is built from the form controls (similar to `FormData`), plus additional HyTDE-managed payloads (e.g. tables; see `design/table.md`).

About `enctype="application/json"`:
- HTML forms do not natively support `application/json` as `enctype` (browsers will ignore it for native submission).
- HyTDE MAY treat `enctype="application/json"` as a hint when deciding JSON submission, but templates SHOULD use `hy-send-in="json"` to avoid relying on non-standard behavior.

## 3. Custom Constraint Rules (Optional)

### 3.1 Registration API

The runtime exposes a global registry object `hy`:

```js
hy.validator(id, fn)
```

- `id` (string): rule identifier (recommend: `[A-Za-z0-9._-]+`).
- `fn` (function): throws an error when invalid (the error message is shown); returns normally when valid.

Signature:

```ts
type HyValidatorFn = (ctx: {
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  value: string;
  name: string; // el.name (or "")
  form: HTMLFormElement | null;
}) => void | Promise<void>;
```

Behavior:
- If `fn` throws (or returns a rejected promise), HyTDE MUST treat the field as invalid and set the message via `el.setCustomValidity(error.message || "Invalid")`.
- If it completes normally, HyTDE MUST clear any custom validity it set previously.

### 3.2 Binding in markup

Attach custom validators to a control:

```html
<input name="email" hy-validator="email" />
```

Rules:
- `hy-validator` accepts one or more validator IDs separated by whitespace (e.g. `hy-validator="requiredLike email"`).
- Validators run in order and stop at the first failure (v1).

Triggering:
- `hy-validate-on="input blur submit"` controls when HyTDE runs custom validators (default: `blur submit`).
- Native constraints are always evaluated by the browser; HyTDE’s role is to set/clear custom validity.

## 4. Error Message Source (Native + Custom)

When a field is invalid, the message shown comes from:
- Custom validators: the thrown `Error.message` (set via `setCustomValidity`)
- Native constraints: the browser’s built-in `validationMessage`

HyTDE does not define a separate message registry in v1.

## 5. Input-level vs Form-level

Input-level:
- Constraints are defined on the input itself (standard attributes).
- HyTDE optionally adds custom rules (`hy-validator`).

Form-level:
- Use the form APIs to validate all controls:
  - `form.checkValidity()` to compute validity
  - `form.reportValidity()` to trigger native UI
- For cross-field checks, HyTDE should set custom validity on a specific target input (e.g. confirm password field) using a form-level hook.

### 5.1 Form-level hook (cross-field)

```js
hy.formValidator(id, fn)
```

Bind:
```html
<form hy-form-validator="signup">
  ...
</form>
```

`fn` runs on submit (and optionally on input/blur) and can throw to indicate failure. For cross-field checks, the function should set custom validity on a specific target control (e.g. confirm password input) by throwing in that control’s validator, or by explicitly calling `setCustomValidity` on a chosen element (implementation-defined).

## 6. UI Feedback & Accessibility

When HyTDE sets/clears custom validity:
- The browser will manage validity state; HyTDE SHOULD additionally set `aria-invalid="true"` on invalid fields (and remove it when valid).
- If inline error containers are used, HyTDE SHOULD update them as text and connect via `aria-describedby`.

Inline containers (optional):
```html
<input id="email" name="email" required type="email" />
<p id="email-error" hy-validation-for="email"></p>
```

## 7. Example

```html
<meta name="hy-mode" content="production" />

<form hy-post="/api/users" hy-send-in="json" hy-form-validator="signup">
  <label>
    Email
    <input id="email" name="email" required type="email" />
  </label>
  <p id="email-error" hy-validation-for="email"></p>

  <label>
    Password
    <input id="pw" name="password" required minlength="12" />
  </label>

  <label>
    Confirm
    <input id="pw2" name="password2" required hy-validator="confirmPassword" />
  </label>

  <button type="submit">Save</button>
</form>

<script>
  hy.validator("confirmPassword", ({ form, value }) => {
    const pw = form?.querySelector("#pw")?.value ?? "";
    if (value !== pw) throw new Error("Passwords do not match");
  });
</script>
```

## Open Questions

1. Should HyTDE always call `form.reportValidity()` on submit, or only if inline error UI is configured?
2. Should `hy-validator` stop on first failure or collect failures?
3. Do we need a message customization facility for native validity states, or rely on browser defaults and server-rendered messages?

## Related Patterns

- Combobox/typeahead: `design/combobox.md`
- Dynamic tables (extable): `design/table.md`
- Forms (fetch + history): `design/forms.md`
