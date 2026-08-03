import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, ScrollView, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

type Item = {
  id: string;
  label: string;
  category?: string;
  order?: number;
  checked_by?: Record<string, boolean>;
};

type PackingList = {
  id: string;
  competition_id: string;
  template_id?: string;
  name?: string;
  items: Item[];
  tips: string[];
  athlete_ids: string[];
};

type Template = {
  id: string;
  name: string;
  items: Item[];
  tips: string[];
  is_default: boolean;
};

type Athlete = { id: string; name: string; avatar_color?: string };

type Props = {
  competitionId: string;
  athletes: Athlete[];
};

export default function PackingListSection({ competitionId, athletes }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<PackingList | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Other");
  const [scopedAthleteId, setScopedAthleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.get<PackingList | null>(`/competitions/${competitionId}/packing-list`),
        api.get<Template[]>("/packing-templates"),
      ]);
      setList(a.data || null);
      setTemplates(b.data || []);
      // Default the scoped column to the first listed athlete (or shared).
      if (a.data && a.data.athlete_ids && a.data.athlete_ids.length > 0) {
        setScopedAthleteId(a.data.athlete_ids[0]);
      } else {
        setScopedAthleteId(null);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not load packing list");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [competitionId]);

  const ensureDefaultTemplate = async () => {
    try {
      const r = await api.post<Template>("/packing-templates/seed-default");
      setTemplates(prev => prev.find(t => t.id === r.data.id) ? prev : [r.data, ...prev]);
      return r.data;
    } catch { return null; }
  };

  const applyTemplate = async (template: Template) => {
    setSaving(true);
    try {
      const athleteIds = athletes.length > 0 ? athletes.map(a => a.id) : [];
      const r = await api.post<PackingList>(`/competitions/${competitionId}/packing-list`, {
        competition_id: competitionId,
        template_id: template.id,
        athlete_ids: athleteIds,
      });
      setList(r.data);
      if (athleteIds[0]) setScopedAthleteId(athleteIds[0]);
      setTemplatePickerOpen(false);
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not apply template");
    } finally { setSaving(false); }
  };

  const startBlank = async () => {
    setSaving(true);
    try {
      const athleteIds = athletes.length > 0 ? athletes.map(a => a.id) : [];
      const r = await api.post<PackingList>(`/competitions/${competitionId}/packing-list`, {
        competition_id: competitionId,
        athlete_ids: athleteIds,
      });
      setList(r.data);
      if (athleteIds[0]) setScopedAthleteId(athleteIds[0]);
      setTemplatePickerOpen(false);
    } finally { setSaving(false); }
  };

  const patchList = async (next: Partial<PackingList>, opts?: { saveAs?: string }) => {
    if (!list) return;
    const body: any = { ...next };
    if (opts?.saveAs) body.save_as_template_name = opts.saveAs;
    const r = await api.patch<PackingList>(`/packing-lists/${list.id}`, body);
    setList(r.data);
    if (opts?.saveAs) {
      // Refresh templates after a save-as.
      const t = await api.get<Template[]>("/packing-templates");
      setTemplates(t.data || []);
    }
  };

  const toggleItem = async (item: Item) => {
    if (!list) return;
    const key = scopedAthleteId || "shared";
    const nextItems = list.items.map(it => {
      if (it.id !== item.id) return it;
      const cb = { ...(it.checked_by || {}) };
      cb[key] = !cb[key];
      return { ...it, checked_by: cb };
    });
    // Optimistic update
    setList({ ...list, items: nextItems });
    try { await patchList({ items: nextItems }); } catch { load(); }
  };

  const removeItem = (item: Item) => {
    if (!list) return;
    Alert.alert("Remove item?", item.label, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          const nextItems = list.items.filter(i => i.id !== item.id);
          setList({ ...list, items: nextItems });
          try { await patchList({ items: nextItems }); } catch { load(); }
        },
      },
    ]);
  };

  const addItem = async () => {
    if (!list) return;
    const label = newItemLabel.trim();
    if (!label) return;
    const next: Item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      category: newItemCategory || "Other",
      order: list.items.length,
      checked_by: {},
    };
    const items = [...list.items, next];
    setList({ ...list, items });
    setNewItemLabel("");
    try { await patchList({ items }); } catch { load(); }
  };

  const saveAsTemplate = () => {
    if (!list || list.items.length === 0) {
      Alert.alert("Nothing to save", "Add items first.");
      return;
    }
    Alert.prompt?.("Save as template", "Give your new template a name:", async (name) => {
      if (!name) return;
      try {
        await patchList({}, { saveAs: name });
        Alert.alert("Saved", `Template \"${name}\" added to your saved lists.`);
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Could not save template");
      }
    }) || (async () => {
      // Android fallback (Alert.prompt is iOS only) — save with a default name.
      const name = `My list ${new Date().toLocaleDateString()}`;
      await patchList({}, { saveAs: name });
      Alert.alert("Saved", `Template \"${name}\" added.`);
    })();
  };

  const refreshTemplates = async () => {
    const t = await api.get<Template[]>("/packing-templates");
    setTemplates(t.data || []);
  };

  const deleteTemplate = async (t: Template) => {
    try {
      await api.delete(`/packing-templates/${t.id}`);
      await refreshTemplates();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not delete template");
    }
  };

  const renameTemplate = async (t: Template, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await api.patch(`/packing-templates/${t.id}`, { name: trimmed });
      await refreshTemplates();
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not rename template");
    }
  };

  const grouped = useMemo(() => {
    const map: Record<string, Item[]> = {};
    (list?.items || []).forEach(i => {
      const cat = i.category || "Other";
      if (!map[cat]) map[cat] = [];
      map[cat].push(i);
    });
    // Sort items within each category by order.
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    // Preserve a stable category order.
    const knownOrder = ["Uniform", "Practice Wear", "Hair & Makeup", "Toiletries", "Essentials", "Medication", "Other"];
    return Object.entries(map).sort(([a], [b]) => {
      const ai = knownOrder.indexOf(a); const bi = knownOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [list?.items]);

  const trackedAthletes = useMemo(() => {
    if (!list) return [] as Athlete[];
    const ids = list.athlete_ids || [];
    if (ids.length === 0) return [] as Athlete[];
    return ids.map(id => athletes.find(a => a.id === id)).filter(Boolean) as Athlete[];
  }, [list, athletes]);

  const progress = useMemo(() => {
    if (!list || !list.items.length) return { done: 0, total: 0 };
    const key = scopedAthleteId || "shared";
    const done = list.items.filter(i => i.checked_by?.[key]).length;
    return { done, total: list.items.length };
  }, [list, scopedAthleteId]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!list) {
    return (
      <View style={styles.card}>
        <View style={styles.emptyHeader}>
          <Ionicons name="briefcase" size={20} color={colors.accent} />
          <Text style={styles.cardTitle}>Packing list</Text>
        </View>
        <Text style={styles.emptyText}>
          Build a checklist of everything to bring on comp day. Apply a saved template or start blank.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
            disabled={saving}
            onPress={async () => {
              if (templates.length === 0) {
                const seeded = await ensureDefaultTemplate();
                if (seeded) { applyTemplate(seeded); return; }
              }
              setTemplatePickerOpen(true);
            }}
            testID="packing-apply-template-btn"
          >
            <Ionicons name="layers" size={16} color="white" />
            <Text style={styles.primaryBtnText}>Apply template</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} disabled={saving} onPress={startBlank}>
            <Text style={styles.secondaryBtnText}>Start blank</Text>
          </TouchableOpacity>
        </View>
        <TemplatePicker
          open={templatePickerOpen}
          onClose={() => setTemplatePickerOpen(false)}
          templates={templates}
          onPick={applyTemplate}
          onDelete={deleteTemplate}
          onRename={renameTemplate}
          onSeedDefault={async () => {
            const t = await ensureDefaultTemplate();
            if (t) applyTemplate(t);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="briefcase" size={20} color={colors.accent} />
          <Text style={styles.cardTitle}>{list.name || "Packing list"}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.iconChip} onPress={() => setTemplatePickerOpen(true)} testID="packing-templates-btn">
            <Ionicons name="layers-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.iconChipText}>Templates</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconChip} onPress={saveAsTemplate} testID="packing-save-template-btn">
            <Ionicons name="bookmark-outline" size={14} color={colors.textPrimary} />
            <Text style={styles.iconChipText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Per-athlete switcher */}
      {trackedAthletes.length > 0 && (
        <View style={styles.athleteRow}>
          <Text style={styles.athleteRowLabel}>Tracking for:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {trackedAthletes.map(a => {
              const on = scopedAthleteId === a.id;
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => setScopedAthleteId(a.id)}
                  style={[styles.athleteChip, on && { backgroundColor: a.avatar_color || colors.primary, borderColor: a.avatar_color || colors.primary }]}
                >
                  <Text style={[styles.athleteChipText, on && { color: "white" }]}>{a.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Progress */}
      <Text style={styles.progressText}>
        {progress.done}/{progress.total} packed
      </Text>

      {/* Tips */}
      {list.tips && list.tips.length > 0 && (
        <View style={styles.tips}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="bulb" size={14} color={colors.accent} />
            <Text style={styles.tipsTitle}>Tips</Text>
          </View>
          {list.tips.map((t, i) => (
            <Text key={i} style={styles.tipText}>• {t}</Text>
          ))}
        </View>
      )}

      {/* Items grouped by category */}
      {grouped.map(([cat, items]) => (
        <View key={cat} style={{ marginTop: spacing.md }}>
          <Text style={styles.categoryHead}>{cat}</Text>
          {items.map(item => {
            const key = scopedAthleteId || "shared";
            const checked = !!item.checked_by?.[key];
            return (
              <Pressable
                key={item.id}
                style={styles.itemRow}
                onPress={() => toggleItem(item)}
                onLongPress={() => removeItem(item)}
                testID={`packing-item-${item.id}`}
              >
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked && <Ionicons name="checkmark" size={16} color="white" />}
                </View>
                <Text style={[styles.itemText, checked && styles.itemTextChecked]} numberOfLines={2}>
                  {item.label}
                </Text>
                <TouchableOpacity hitSlop={8} onPress={() => removeItem(item)}>
                  <Ionicons name="close-circle-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </Pressable>
            );
          })}
        </View>
      ))}

      {/* Add item row */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={newItemLabel}
          onChangeText={setNewItemLabel}
          onSubmitEditing={addItem}
          placeholder="Add an item…"
          placeholderTextColor={colors.textTertiary}
          testID="packing-add-input"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem} disabled={!newItemLabel.trim()}>
          <Ionicons name="add" size={20} color="white" />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 6 }}>
        {["Uniform", "Practice Wear", "Hair & Makeup", "Toiletries", "Essentials", "Medication", "Other"].map(c => {
          const on = newItemCategory === c;
          return (
            <TouchableOpacity key={c} onPress={() => setNewItemCategory(c)} style={[styles.catChip, on && styles.catChipOn]}>
              <Text style={[styles.catChipText, on && { color: "white" }]}>{c}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        templates={templates}
        onPick={applyTemplate}
        onDelete={deleteTemplate}
        onRename={renameTemplate}
        onSeedDefault={async () => {
          const t = await ensureDefaultTemplate();
          if (t) applyTemplate(t);
        }}
      />
    </View>
  );
}

function TemplatePicker({
  open, onClose, templates, onPick, onSeedDefault, onDelete, onRename,
}: {
  open: boolean;
  onClose: () => void;
  templates: Template[];
  onPick: (t: Template) => void;
  onSeedDefault: () => void;
  onDelete: (t: Template) => Promise<void> | void;
  onRename: (t: Template, name: string) => Promise<void> | void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [manageMode, setManageMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const editableCount = templates.filter(t => !t.is_default).length;

  const confirmDelete = (t: Template) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) {
        onDelete(t);
      }
      return;
    }
    Alert.alert("Delete template?", `"${t.name}" will be removed. This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(t) },
    ]);
  };

  const startRename = (t: Template) => { setEditingId(t.id); setEditName(t.name); };
  const commitRename = async (t: Template) => {
    await onRename(t, editName);
    setEditingId(null); setEditName("");
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{manageMode ? "Manage templates" : "Pick a template"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              {editableCount > 0 && (
                <TouchableOpacity onPress={() => { setManageMode(m => !m); setEditingId(null); }} testID="packing-manage-toggle">
                  <Text style={styles.manageLink}>{manageMode ? "Done" : "Manage"}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingBottom: 16 }}>
            {templates.length === 0 && (
              <View style={{ padding: spacing.lg, alignItems: "center" }}>
                <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: "center", marginBottom: 12 }}>
                  You don&apos;t have any saved templates yet.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={onSeedDefault}>
                  <Ionicons name="sparkles" size={16} color="white" />
                  <Text style={styles.primaryBtnText}>Use CheerPlanner Standard</Text>
                </TouchableOpacity>
              </View>
            )}
            {templates.map(t => {
              const isEditing = editingId === t.id;
              if (manageMode) {
                return (
                  <View key={t.id} style={styles.templateRow}>
                    {isEditing ? (
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          style={[styles.addInput, { flex: 1 }]}
                          value={editName}
                          onChangeText={setEditName}
                          autoFocus
                          placeholder="Template name"
                          placeholderTextColor={colors.textTertiary}
                          onSubmitEditing={() => commitRename(t)}
                          testID={`packing-rename-input-${t.id}`}
                        />
                        <TouchableOpacity onPress={() => commitRename(t)} hitSlop={8} testID={`packing-rename-save-${t.id}`}>
                          <Ionicons name="checkmark-circle" size={24} color={colors.accent} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setEditingId(null); setEditName(""); }} hitSlop={8}>
                          <Ionicons name="close-circle-outline" size={24} color={colors.textTertiary} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.templateName}>{t.name}</Text>
                          <Text style={styles.templateMeta}>{t.items.length} items{t.is_default ? " • Standard (locked)" : ""}</Text>
                        </View>
                        {t.is_default ? (
                          <Ionicons name="lock-closed" size={16} color={colors.textTertiary} />
                        ) : (
                          <View style={{ flexDirection: "row", gap: 14 }}>
                            <TouchableOpacity onPress={() => startRename(t)} hitSlop={8} testID={`packing-rename-${t.id}`}>
                              <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => confirmDelete(t)} hitSlop={8} testID={`packing-delete-${t.id}`}>
                              <Ionicons name="trash-outline" size={20} color="#DC2626" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={t.id}
                  style={styles.templateRow}
                  onPress={() => onPick(t)}
                  testID={`packing-template-${t.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.templateName}>{t.name}</Text>
                    <Text style={styles.templateMeta}>{t.items.length} items{t.is_default ? " • Standard" : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () => ({
  card: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md,
  },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  emptyHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  emptyText: { ...typography.body, color: colors.textSecondary, marginBottom: 12 },

  primaryBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: 6,
  },
  primaryBtnText: { color: "white", fontWeight: "700", fontSize: 14 },
  secondaryBtn: {
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.bg,
  },
  secondaryBtnText: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },

  iconChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  iconChipText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary, fontSize: 12 },

  athleteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md },
  athleteRowLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
  athleteChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  athleteChipText: { ...typography.caption, fontWeight: "700", color: colors.textPrimary, fontSize: 12 },

  progressText: { ...typography.caption, color: colors.textTertiary, marginTop: 4 },

  tips: {
    marginTop: spacing.md, padding: 10, backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
  },
  tipsTitle: { ...typography.caption, fontWeight: "700", color: colors.accent },
  tipText: { ...typography.caption, color: colors.textPrimary, lineHeight: 18 },

  categoryHead: {
    ...typography.caption, fontWeight: "700", color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, fontSize: 11,
  },
  itemRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: colors.border, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.card,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemText: { ...typography.body, color: colors.textPrimary, flex: 1, fontSize: 14 },
  itemTextChecked: { color: colors.textTertiary, textDecorationLine: "line-through" },

  addRow: { flexDirection: "row", gap: 8, marginTop: spacing.lg, alignItems: "center" },
  addInput: {
    flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: colors.textPrimary,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: radius.md, alignItems: "center",
    justifyContent: "center", backgroundColor: colors.accent,
  },
  catChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  catChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  catChipText: { ...typography.caption, color: colors.textPrimary, fontSize: 11, fontWeight: "700" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingBottom: 24, maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  manageLink: { ...typography.caption, color: colors.accent, fontWeight: "700", fontSize: 14 },
  templateRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  templateName: { ...typography.body, color: colors.textPrimary, fontWeight: "600" },
  templateMeta: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
});
