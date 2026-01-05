export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function isFormControl(target: EventTarget | null): target is FormControl {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}
