import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Image, Alert, KeyboardAvoidingView, Platform, Modal, Pressable, Switch, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, typography } from "@/src/theme";
import { useThemedStyles, type ThemePalette } from "@/src/hooks/useThemedStyles";

type Design = { id: string; prompt?: string; thumb?: string; created_at?: string };

async function shareImage(b64: string, filename: string, mime = "image/png") {
  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = `data:${mime};base64,${b64}`;
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const FS: any = await import("expo-file-system/legacy");
  const Sharing: any = await import("expo-sharing");
  const dest = `${FS.cacheDirectory}${filename}`;
  await FS.writeAsStringAsync(dest, b64, { encoding: FS.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(dest, { mimeType: mime, dialogTitle: "Save or share design" });
}

export default function AIDesigner() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user } = useAuth();

  // Staff-only, mirroring the backend gating.
  React.useEffect(() => {
    if (user && !user.team_access) router.replace("/team" as any);
  }, [user, router]);

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string>("");   // base64 of the selected design
  const [images, setImages] = useState<string[]>([]); // all variations from last generate
  const [lastPrompt, setLastPrompt] = useState("");
  const [saved, setSaved] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);
  const [error, setError] = useState("");

  // Brand inputs & options
  const [refImage, setRefImage] = useState("");
  const [logo, setLogo] = useState("");
  const [variations, setVariations] = useState(1);
  const [transparent, setTransparent] = useState(false);

  // Edit / tweak
  const [tweak, setTweak] = useState("");

  const [libOpen, setLibOpen] = useState(false);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  const pickImage = async (kind: "reference" | "logo") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Allow photo access to add a reference image or logo.",
        perm.canAskAgain ? [{ text: "OK" }] : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const uri = `data:${res.assets[0].mimeType || "image/png"};base64,${res.assets[0].base64}`;
      if (kind === "reference") setRefImage(uri); else setLogo(uri);
    }
  };

  const runGenerate = async (opts: { prompt: string; editImage?: string }) => {
    setError(""); setLoading(true); setSaved(false);
    try {
      const body: any = { prompt: opts.prompt, variations, transparent };
      if (opts.editImage) body.edit_image = opts.editImage;
      if (refImage) body.reference_images = [refImage];
      if (logo) body.logo = logo;
      const r = await api.post<{ images: string[]; image_base64: string; prompt: string }>(
        "/ai-designer/generate", body, { timeout: 180000 },
      );
      const imgs = r.data.images || [r.data.image_base64];
      setImages(imgs);
      setImage(imgs[0]);
      setLastPrompt(opts.prompt);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Couldn't generate the design. Please try again.");
    } finally { setLoading(false); }
  };

  const generate = async (reuse?: boolean) => {
    const p = (reuse ? lastPrompt : prompt).trim();
    if (!p && !refImage && !logo) { setError("Describe what you'd like to create, or add a reference image."); return; }
    await runGenerate({ prompt: p });
  };

  const applyEdit = async () => {
    const t = tweak.trim();
    if (!t || !image) return;
    await runGenerate({ prompt: t, editImage: image });
    setTweak("");
  };

  const save = async () => {
    if (!image || saved) return;
    setSavingBusy(true);
    try {
      await api.post("/ai-designer/save", { image_base64: image, prompt: lastPrompt }, { timeout: 60000 });
      setSaved(true);
      Alert.alert("Saved", "Your design was saved to My Designs.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again.");
    } finally { setSavingBusy(false); }
  };

  const share = async () => {
    if (!image) return;
    try {
      await shareImage(image, `cheerplanner-design-${Date.now()}.png`);
    } catch (e: any) {
      Alert.alert("Couldn't share", e?.message || "Please try again.");
    }
  };

  const openLibrary = async () => {
    setLibOpen(true); setLibLoading(true);
    try { const r = await api.get<{ designs: Design[] }>("/ai-designer/designs"); setDesigns(r.data.designs || []); }
    catch { setDesigns([]); }
    finally { setLibLoading(false); }
  };

  const openDesign = async (id: string) => {
    setLibOpen(false); setLoading(true); setError(""); setSaved(true);
    try {
      const r = await api.get<{ image_base64: string; prompt: string }>(`/ai-designer/designs/${id}`, { timeout: 60000 });
      setImage(r.data.image_base64);
      setImages([r.data.image_base64]);
      setLastPrompt(r.data.prompt || "");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Couldn't open that design.");
    } finally { setLoading(false); }
  };

  const deleteDesign = (id: string) => {
    const doIt = async () => {
      try { await api.delete(`/ai-designer/designs/${id}`); setDesigns((d) => d.filter((x) => x.id !== id)); }
      catch (e: any) { Alert.alert("Couldn't delete", e?.response?.data?.detail || "Please try again."); }
    };
    if (Platform.OS === "web") { doIt(); return; }
    Alert.alert("Delete design?", "This removes it from My Designs.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doIt },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="ai-designer-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }} testID="ai-designer-back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>AI Designer</Text>
          <Text style={styles.subtitle}>Turn a description into a design</Text>
        </View>
        <TouchableOpacity onPress={openLibrary} hitSlop={8} style={{ padding: 4 }} testID="ai-designer-library">
          <Ionicons name="images-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.q}>What do you want to create?</Text>
          <TextInput
            style={styles.promptBox}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="e.g. A bold competition poster with a cheerleader mid-toss, navy and gold, sparkles, and space for text"
            placeholderTextColor={colors.textTertiary}
            multiline
            editable={!loading}
            testID="ai-designer-prompt"
          />
          {!!error && <Text style={styles.error} testID="ai-designer-error">{error}</Text>}

          {/* Brand inputs */}
          <View style={styles.brandRow}>
            <BrandSlot label="Reference" img={refImage} onAdd={() => pickImage("reference")} onClear={() => setRefImage("")} styles={styles} testID="ai-designer-ref" />
            <BrandSlot label="Team logo" img={logo} onAdd={() => pickImage("logo")} onClear={() => setLogo("")} styles={styles} testID="ai-designer-logo" />
          </View>

          {/* Options */}
          <Text style={styles.optLabel}>Variations</Text>
          <View style={styles.chips}>
            {[1, 2, 3, 4].map((n) => (
              <TouchableOpacity key={n} style={[styles.chip, variations === n && styles.chipOn]} onPress={() => setVariations(n)} testID={`ai-designer-var-${n}`}>
                <Text style={[styles.chipText, variations === n && styles.chipTextOn]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optLabel}>Transparent background</Text>
              <Text style={styles.optHint}>Great for logos & stickers (PNG, no background).</Text>
            </View>
            <Switch value={transparent} onValueChange={setTransparent} trackColor={{ true: colors.accent, false: "#CBD5E1" }} thumbColor={Platform.OS === "android" ? (transparent ? "white" : "#F1F5F9") : undefined} testID="ai-designer-transparent" />
          </View>

          <TouchableOpacity
            style={[styles.genBtn, (loading || !prompt.trim()) && { opacity: 0.6 }]}
            onPress={() => generate(false)}
            disabled={loading || !prompt.trim()}
            testID="ai-designer-generate"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={styles.genText}>Generate Design</Text></>}
          </TouchableOpacity>

          {loading && (
            <View style={styles.progress} testID="ai-designer-loading">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.progressText}>Designing… this can take up to a minute.</Text>
            </View>
          )}

          {!!image && !loading && (
            <View style={styles.result}>
              <Image source={{ uri: `data:image/png;base64,${image}` }} style={styles.image} resizeMode="contain" testID="ai-designer-image" />

              {images.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                  {images.map((im, i) => (
                    <TouchableOpacity key={i} onPress={() => { setImage(im); setSaved(false); }} testID={`ai-designer-variation-${i}`}>
                      <Image source={{ uri: `data:image/png;base64,${im}` }} style={[styles.stripThumb, image === im && styles.stripThumbOn]} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => generate(true)} testID="ai-designer-regenerate">
                  <Ionicons name="refresh" size={18} color={colors.accent} />
                  <Text style={styles.actionText}>Regenerate</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, saved && { opacity: 0.5 }]} onPress={save} disabled={saved || savingBusy} testID="ai-designer-save">
                  {savingBusy ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name={saved ? "checkmark" : "bookmark-outline"} size={18} color={colors.accent} />}
                  <Text style={styles.actionText}>{saved ? "Saved" : "Save"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={share} testID="ai-designer-share">
                  <Ionicons name="share-outline" size={18} color={colors.accent} />
                  <Text style={styles.actionText}>Share</Text>
                </TouchableOpacity>
              </View>

              {/* Tweak / edit the selected design */}
              <Text style={styles.optLabel}>Tweak this design</Text>
              <View style={styles.tweakRow}>
                <TextInput
                  style={styles.tweakInput}
                  value={tweak}
                  onChangeText={setTweak}
                  placeholder="e.g. make it navy & gold, add sparkles"
                  placeholderTextColor={colors.textTertiary}
                  testID="ai-designer-tweak"
                />
                <TouchableOpacity style={[styles.tweakBtn, !tweak.trim() && { opacity: 0.5 }]} onPress={applyEdit} disabled={!tweak.trim()} testID="ai-designer-apply-edit">
                  <Ionicons name="color-wand-outline" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={libOpen} transparent animationType="slide" onRequestClose={() => setLibOpen(false)}>
        <Pressable style={styles.modalWrap} onPress={() => setLibOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="ai-designer-library-sheet">
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>My Designs</Text>
              <TouchableOpacity onPress={() => setLibOpen(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            {libLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 28 }} />
            ) : designs.length === 0 ? (
              <Text style={styles.empty}>No saved designs yet. Generate one and tap Save.</Text>
            ) : (
              <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator>
                {designs.map((d) => (
                  <View key={d.id} style={styles.gridItem}>
                    <TouchableOpacity onPress={() => openDesign(d.id)} testID={`ai-design-${d.id}`}>
                      {!!d.thumb && <Image source={{ uri: d.thumb }} style={styles.gridThumb} resizeMode="cover" />}
                      {!!d.prompt && <Text style={styles.gridLabel} numberOfLines={2}>{d.prompt}</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.gridDel} onPress={() => deleteDesign(d.id)} hitSlop={8} testID={`ai-design-del-${d.id}`}>
                      <Ionicons name="trash" size={15} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function BrandSlot({ label, img, onAdd, onClear, styles, testID }: any) {
  return (
    <View style={styles.brandSlot}>
      <Text style={styles.brandLabel}>{label}</Text>
      {img ? (
        <View>
          <Image source={{ uri: img }} style={styles.brandImg} resizeMode="cover" />
          <TouchableOpacity style={styles.brandClear} onPress={onClear} hitSlop={6} testID={`${testID}-clear`}>
            <Ionicons name="close" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.brandAdd} onPress={onAdd} testID={`${testID}-add`}>
          <Ionicons name="add" size={22} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemePalette) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.borderSoft },
  title: { ...typography.h3, color: c.textPrimary },
  subtitle: { ...typography.caption, color: c.textSecondary },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  q: { ...typography.h3, color: c.textPrimary, marginBottom: spacing.sm },
  promptBox: { minHeight: 120, maxHeight: 240, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.card, padding: spacing.md, color: c.textPrimary, ...typography.body, textAlignVertical: "top" as const },
  error: { ...typography.caption, color: "#DC2626", marginTop: spacing.sm },
  brandRow: { flexDirection: "row" as const, gap: spacing.md, marginTop: spacing.lg },
  brandSlot: { alignItems: "flex-start" as const },
  brandLabel: { ...typography.caption, color: c.textSecondary, fontWeight: "700" as const, marginBottom: 6 },
  brandAdd: { width: 64, height: 64, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, borderStyle: "dashed" as const, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: c.card },
  brandImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  brandClear: { position: "absolute" as const, top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(220,38,38,0.95)", alignItems: "center" as const, justifyContent: "center" as const },
  optLabel: { ...typography.caption, color: c.textPrimary, fontWeight: "700" as const, marginTop: spacing.lg },
  optHint: { ...typography.caption, color: c.textTertiary, marginTop: 2 },
  chips: { flexDirection: "row" as const, gap: spacing.sm, marginTop: spacing.sm },
  chip: { width: 48, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: c.card },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { ...typography.bodyMedium, color: c.textSecondary, fontWeight: "700" as const },
  chipTextOn: { color: "#fff" },
  toggleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, marginTop: spacing.xs },
  strip: { gap: spacing.sm, paddingVertical: spacing.sm },
  stripThumb: { width: 64, height: 64, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent", backgroundColor: c.card },
  stripThumbOn: { borderColor: c.accent },
  tweakRow: { flexDirection: "row" as const, gap: spacing.sm, marginTop: spacing.sm },
  tweakInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.card, paddingHorizontal: spacing.md, paddingVertical: 12, color: c.textPrimary, ...typography.body },
  tweakBtn: { width: 48, borderRadius: radius.md, backgroundColor: c.accent, alignItems: "center" as const, justifyContent: "center" as const },
  genBtn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 8, backgroundColor: c.accent, borderRadius: radius.lg, paddingVertical: 16, marginTop: spacing.lg },
  genText: { ...typography.bodyMedium, color: "#fff", fontWeight: "800" as const },
  progress: { alignItems: "center" as const, gap: 8, marginTop: spacing.xl },
  progressText: { ...typography.caption, color: c.textSecondary },
  result: { marginTop: spacing.xl },
  image: { width: "100%" as const, aspectRatio: 1, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  actions: { flexDirection: "row" as const, gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingVertical: 12, backgroundColor: c.card },
  actionText: { ...typography.caption, color: c.textPrimary, fontWeight: "700" as const },
  // Library sheet
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" as const },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "80%" as const },
  sheetHead: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginBottom: spacing.md },
  sheetTitle: { ...typography.h3, color: c.textPrimary },
  empty: { ...typography.body, color: c.textSecondary, paddingVertical: spacing.xl, textAlign: "center" as const },
  grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  gridItem: { width: "47%" as const },
  gridThumb: { width: "100%" as const, aspectRatio: 1, borderRadius: radius.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  gridLabel: { ...typography.caption, color: c.textSecondary, marginTop: 4 },
  gridDel: { position: "absolute" as const, top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(220,38,38,0.92)", alignItems: "center" as const, justifyContent: "center" as const },
});
