import React, { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";

type Todo = { id: string; text: string; done: boolean };
type Props = { scope: "team" | "competition" | "event"; refId?: string | null };

export default function TodoList({ scope, refId }: Props) {
  const [items, setItems] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Todo[]>("/todos", { params: { scope, ref_id: refId ?? undefined } });
      setItems(r.data);
    } catch (_e) {} finally { setLoading(false); }
  }, [scope, refId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setAdding(true);
    setText("");
    try {
      const r = await api.post<Todo>("/todos", { text: t, scope, ref_id: refId ?? null });
      setItems((prev) => [...prev, r.data]);
    } catch (_e) {} finally { setAdding(false); }
  };

  const toggle = async (item: Todo) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try { await api.patch(`/todos/${item.id}`, { done: !item.done }); } catch (_e) { load(); }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try { await api.delete(`/todos/${id}`); } catch (_e) { load(); }
  };

  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done));
  const remaining = items.filter((i) => !i.done).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a to-do…"
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={add}
          returnKeyType="done"
          testID="todo-input"
        />
        <TouchableOpacity style={styles.addBtn} onPress={add} disabled={adding} testID="todo-add">
          {adding ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="add" size={22} color="white" />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No to-dos yet. Add your first above.</Text>
      ) : (
        <>
          {sorted.map((item) => (
            <View key={item.id} style={styles.row} testID={`todo-row-${item.id}`}>
              <TouchableOpacity onPress={() => toggle(item)} style={[styles.check, item.done && styles.checkOn]} testID={`todo-toggle-${item.id}`}>
                {item.done && <Ionicons name="checkmark" size={15} color="white" />}
              </TouchableOpacity>
              <Text style={[styles.text, item.done && styles.textDone]}>{item.text}</Text>
              <TouchableOpacity onPress={() => remove(item.id)} hitSlop={8} testID={`todo-delete-${item.id}`}>
                <Ionicons name="close" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          <Text style={styles.count}>{remaining} left · {items.length - remaining} done</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, ...typography.body, color: colors.textPrimary },
  addBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  empty: { ...typography.caption, color: colors.textTertiary, textAlign: "center", marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { flex: 1, ...typography.body, color: colors.textPrimary },
  textDone: { textDecorationLine: "line-through", color: colors.textTertiary },
  count: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
});
