import React, { useEffect, useRef, useState } from "react";
import { TextInput, TextInputProps } from "react-native";

type Props = Omit<TextInputProps, "value" | "onChangeText"> & {
  /** Current canonical value (e.g. from server / parent state). */
  value: string;
  /** Called when the user stops typing (debounced) OR when the field loses focus. */
  onCommit: (next: string) => void;
  /** Debounce window in milliseconds. Default 400ms. */
  debounceMs?: number;
};

/**
 * A drop-in TextInput for fields that auto-save to the backend.
 *
 * Why this exists: a regular controlled `<TextInput value={x} onChangeText={x=>patch(x)} />`
 * fires a network PATCH on every keystroke. When the parent re-renders with the
 * server's echoed value, the input flickers and the user can't keep typing
 * smoothly. This component holds its own local string state so typing is
 * instant, then commits to the parent on blur OR after a short idle pause.
 *
 * It also re-syncs when the `value` prop changes externally (e.g. another
 * user in the household edits the same field), as long as the user isn't
 * actively typing.
 */
export default function DebouncedTextInput({ value, onCommit, debounceMs = 400, onBlur, ...rest }: Props) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);

  // External value changes (e.g. after parent reload) should sync into our
  // local state — unless the user is actively typing/just committed.
  useEffect(() => {
    if (!dirtyRef.current && !focusedRef.current && text !== value) {
      setText(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: string) => {
    dirtyRef.current = false;
    if (next !== value) onCommit(next);
  };

  const handleChange = (next: string) => {
    setText(next);
    dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), debounceMs);
  };

  return (
    <TextInput
      {...rest}
      value={text}
      onChangeText={handleChange}
      onFocus={(e) => { focusedRef.current = true; rest.onFocus?.(e); }}
      onBlur={(e) => {
        focusedRef.current = false;
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        commit(text);
        onBlur?.(e);
      }}
    />
  );
}
