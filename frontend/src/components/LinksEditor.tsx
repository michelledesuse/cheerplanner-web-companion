import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles } from "@/src/hooks/useThemedStyles";

export type ExternalLink = { label: string; url: string };

type Props = {
  value: ExternalLink[];
  onChange: (links: ExternalLink[]) => void;
  testIDPrefix?: string;
};

/**
 * Editable list of external links (label + URL). Used on the event and
 * competition create/edit forms. Empty rows are filtered out by the caller
 * before saving via `cleanLinks`.
 */
export default function LinksEditor({ value, onChange, testIDPrefix = "link" }: Props) {
  const styles = useThemedStyles(makeStyles);

  const update = (i: number, patch: Partial<ExternalLink>) => {
    const next = value.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { label: "", url: "" }]);

  return (
    <View>
      {value.map((link, i) => (
        <View key={i} style={styles.row} testID={`${testIDPrefix}-row-${i}`}>
          <View style={{ flex: 1 }}>
            <TextInput
              style={styles.labelInput}
              value={link.label}
              onChangeText={(t) => update(i, { label: t })}
              placeholder="Label (e.g. Livestream, Tickets)"
              placeholderTextColor={colors.textTertiary}
              testID={`${testIDPrefix}-label-${i}`}
            />
            <TextInput
              style={styles.urlInput}
              value={link.url}
              onChangeText={(t) => update(i, { url: t })}
              placeholder="https://..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID={`${testIDPrefix}-url-${i}`}
            />
          </View>
          <TouchableOpacity onPress={() => remove(i)} style={styles.removeBtn} testID={`${testIDPrefix}-remove-${i}`}>
            <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity onPress={add} style={styles.addBtn} testID={`${testIDPrefix}-add`}>
        <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
        <Text style={styles.addText}>Add link</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Drop empty/invalid rows and normalize the URL scheme before saving. */
export function cleanLinks(links: ExternalLink[]): ExternalLink[] {
  return links
    .map((l) => ({ label: (l.label || "").trim(), url: (l.url || "").trim() }))
    .filter((l) => l.url.length > 0)
    .map((l) => ({
      label: l.label,
      url: /^https?:\/\//i.test(l.url) ? l.url : `https://${l.url}`,
    }));
}

const makeStyles = () => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  labelInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  urlInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  removeBtn: { padding: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  addText: { ...typography.caption, color: colors.accent, fontWeight: "700" },
});
