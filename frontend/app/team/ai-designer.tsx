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

  // Brand presets
  const [brands, setBrands] = useState<any[]>([]);
  const [brandId, setBrandId] = useState<string>("");
  const [editBrand, setEditBrand] = useState<any>(null); // {id?, name, colors, logo}

  // Edit / tweak
  const [tweak, setTweak] = useState("");

  // Preview / chat
  const [enlarge, setEnlarge] = useState(false);
  const [posting, setPosting] = useState(false);
  const [caption, setCaption] = useState("");

  const [libOpen, setLibOpen] = useState(false);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  React.useEffect(() => { loadBrands(); }, []);
  const loadBrands = async () => {
    try { const r = await api.get<{ brands: any[] }>("/ai-designer/brands"); setBrands(r.data.brands || []); }
    catch { setBrands([]); }
  };

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
      if (brandId) body.brand_id = brandId;
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

  const download = async () => {
    if (!image) return;
    const filename = `cheerplanner-design-${Date.now()}.png`;
    try {
      if (Platform.OS === "web") { await shareImage(image, filename); return; }
      const FS: any = await import("expo-file-system/legacy");
      const MediaLibrary: any = await import("expo-media-library");
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Photo access needed", "Allow photo access to save the flyer to your device.",
          perm.canAskAgain ? [{ text: "OK" }] : [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
        return;
      }
      const dest = `${FS.cacheDirectory}${filename}`;
      await FS.writeAsStringAsync(dest, image, { encoding: FS.EncodingType.Base64 });
      await MediaLibrary.saveToLibraryAsync(dest);
      Alert.alert("Saved", "The flyer was saved to your Photos.");
    } catch (e: any) {
      Alert.alert("Couldn't download", e?.message || "Please try again.");
    }
  };

  const postToChat = async () => {
    if (!image || posting) return;
    setPosting(true);
    try {
      await api.post("/ai-designer/post-to-chat", { image_base64: image, caption: caption.trim() }, { timeout: 60000 });
      setPosting(false);
      setEnlarge(false);
      setCaption("");
      Alert.alert("Posted", "Your flyer was posted to Team Chat.");
    } catch (e: any) {
      setPosting(false);
      Alert.alert("Couldn't post", e?.response?.data?.detail || "Please try again.");
    }
  };

  const saveBrand = async () => {
    const b = editBrand;
    if (!b?.name?.trim()) { Alert.alert("Name required", "Give the brand a name."); return; }
    const colors = String(b.colors || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const payload: any = { name: b.name.trim(), colors };
    if (b.logo !== undefined) payload.logo = b.logo || "";
    try {
      if (b.id) await api.patch(`/ai-designer/brands/${b.id}`, payload);
      else await api.post("/ai-designer/brands", payload);
      setEditBrand(null);
      await loadBrands();
    } catch (e: any) { Alert.alert("Couldn't save", e?.response?.data?.detail || "Please try again."); }
  };

  const removeBrand = (id: string) => {
    const doIt = async () => {
      try { await api.delete(`/ai-designer/brands/${id}`); if (brandId === id) setBrandId(""); await loadBrands(); }
      catch (e: any) { Alert.alert("Couldn't delete", e?.response?.data?.detail || "Please try again."); }
    };
    if (Platform.OS === "web") { doIt(); return; }
    Alert.alert("Delete brand?", "This removes the brand preset.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doIt },
    ]);
  };

  const pickBrandLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Photo access needed", "Allow photo access to add a brand logo."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, base64: true });
    if (!res.canceled && res.assets?.[0]?.base64) {
      setEditBrand((b: any) => ({ ...b, logo: `data:${res.assets![0].mimeType || "image/png"};base64,${res.assets![0].base64}` }));
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
          <Text style={styles.title}>Design a Flyer</Text>
          <Text style={styles.subtitle}>Describe it and generate with AI</Text>
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
            scrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
            editable={!loading}
            testID="ai-designer-prompt"
          />
          {!!error && <Text style={styles.error} testID="ai-designer-error">{error}</Text>}

          {/* Brand inputs */}
          <View style={styles.brandRow}>
            <BrandSlot label="Reference" img={refImage} onAdd={() => pickImage("reference")} onClear={() => setRefImage("")} styles={styles} testID="ai-designer-ref" />
            <BrandSlot label="Team logo" img={logo} onAdd={() => pickImage("logo")} onClear={() => setLogo("")} styles={styles} testID="ai-designer-logo" />
          </View>

          {/* Brand presets */}
          <View style={styles.brandHead}>
            <Text style={styles.optLabel}>Brand</Text>
            <TouchableOpacity onPress={() => { setEditBrand({ name: "", colors: "", logo: "" }); }} testID="ai-designer-brand-new"><Text style={styles.link}>+ New brand</Text></TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <TouchableOpacity style={[styles.brandChip, !brandId && styles.chipOn]} onPress={() => setBrandId("")} testID="ai-designer-brand-none">
              <Text style={[styles.chipText, !brandId && styles.chipTextOn]}>None</Text>
            </TouchableOpacity>
            {brands.map((b) => (
              <TouchableOpacity key={b.id} style={[styles.brandChip, brandId === b.id && styles.chipOn]} onPress={() => setBrandId(b.id)} onLongPress={() => setEditBrand({ id: b.id, name: b.name, colors: (b.colors || []).join(", "), logo: b.logo })} testID={`ai-designer-brand-${b.id}`}>
                {!!b.logo && <Image source={{ uri: b.logo }} style={styles.brandChipLogo} resizeMode="contain" />}
                <Text style={[styles.chipText, brandId === b.id && styles.chipTextOn]} numberOfLines={1}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {brands.length > 0 && <Text style={styles.optHint}>Tap to apply · long-press to edit.</Text>}

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
              <TouchableOpacity activeOpacity={0.9} onPress={() => setEnlarge(true)} testID="ai-designer-enlarge">
                <Image source={{ uri: `data:image/png;base64,${image}` }} style={styles.image} resizeMode="contain" testID="ai-designer-image" />
                <View style={styles.expandHint}><Ionicons name="expand-outline" size={14} color="#fff" /><Text style={styles.expandHintText}>Tap to enlarge</Text></View>
              </TouchableOpacity>

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
                <TouchableOpacity style={styles.actionBtn} onPress={download} testID="ai-designer-download">
                  <Ionicons name="download-outline" size={18} color={colors.accent} />
                  <Text style={styles.actionText}>Download</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.tweakInput, { marginTop: spacing.md }]}
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a message for the chat (optional)"
                placeholderTextColor={colors.textTertiary}
                maxLength={2000}
                testID="ai-designer-caption"
              />
              <TouchableOpacity style={[styles.postBtn, posting && { opacity: 0.6 }]} onPress={postToChat} disabled={posting} testID="ai-designer-post-chat">
                {posting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="chatbubbles" size={16} color="#fff" /><Text style={styles.postText}>Post to Team Chat</Text></>}
              </TouchableOpacity>

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

      <Modal visible={enlarge} transparent animationType="fade" onRequestClose={() => setEnlarge(false)}>
        <View style={styles.enlargeWrap} testID="ai-designer-enlarge-modal">
          <TouchableOpacity style={styles.enlargeClose} onPress={() => setEnlarge(false)} hitSlop={10} testID="ai-designer-enlarge-close">
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {!!image && <Image source={{ uri: `data:image/png;base64,${image}` }} style={styles.enlargeImg} resizeMode="contain" />}
          <View style={styles.enlargeActions}>
            <TouchableOpacity style={styles.enlargeBtn} onPress={download} testID="ai-designer-enlarge-download"><Ionicons name="download-outline" size={20} color="#fff" /><Text style={styles.enlargeBtnText}>Download</Text></TouchableOpacity>
            <TouchableOpacity style={styles.enlargeBtn} onPress={share} testID="ai-designer-enlarge-share"><Ionicons name="share-outline" size={20} color="#fff" /><Text style={styles.enlargeBtnText}>Share</Text></TouchableOpacity>
            <TouchableOpacity style={styles.enlargeBtn} onPress={postToChat} disabled={posting} testID="ai-designer-enlarge-post">{posting ? <ActivityIndicator color="#fff" /> : <Ionicons name="chatbubbles-outline" size={20} color="#fff" />}<Text style={styles.enlargeBtnText}>Post</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editBrand} transparent animationType="slide" onRequestClose={() => setEditBrand(null)}>
        <Pressable style={styles.modalWrap} onPress={() => setEditBrand(null)}>
          <Pressable style={styles.sheet} onPress={() => {}} testID="ai-designer-brand-modal">
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{editBrand?.id ? "Edit brand" : "New brand"}</Text>
              <TouchableOpacity onPress={() => setEditBrand(null)} hitSlop={8}><Ionicons name="close" size={24} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <Text style={styles.optLabel}>Brand name</Text>
            <TextInput style={styles.tweakInput} value={editBrand?.name || ""} onChangeText={(t) => setEditBrand((b: any) => ({ ...b, name: t }))} placeholder="e.g. Champion Elite Allstars" placeholderTextColor={colors.textTertiary} testID="ai-designer-brand-name" />
            <Text style={styles.optLabel}>Brand colors (comma-separated)</Text>
            <TextInput style={styles.tweakInput} value={editBrand?.colors || ""} onChangeText={(t) => setEditBrand((b: any) => ({ ...b, colors: t }))} placeholder="e.g. navy, gold, #0A1F44" placeholderTextColor={colors.textTertiary} testID="ai-designer-brand-colors" />
            <Text style={styles.optLabel}>Logo</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 6 }}>
              {editBrand?.logo ? <Image source={{ uri: editBrand.logo }} style={styles.brandImg} resizeMode="contain" /> : null}
              <TouchableOpacity style={styles.brandAdd} onPress={pickBrandLogo} testID="ai-designer-brand-logo"><Ionicons name={editBrand?.logo ? "swap-horizontal" : "add"} size={22} color={colors.accent} /></TouchableOpacity>
              {editBrand?.logo ? <TouchableOpacity onPress={() => setEditBrand((b: any) => ({ ...b, logo: "" }))}><Text style={styles.link}>Remove</Text></TouchableOpacity> : null}
            </View>
            <TouchableOpacity style={styles.postBtn} onPress={saveBrand} testID="ai-designer-brand-save"><Text style={styles.postText}>{editBrand?.id ? "Save changes" : "Create brand"}</Text></TouchableOpacity>
            {editBrand?.id ? (
              <TouchableOpacity style={{ paddingVertical: 10, alignItems: "center" }} onPress={() => { const id = editBrand.id; setEditBrand(null); removeBrand(id); }} testID="ai-designer-brand-delete">
                <Text style={{ ...typography.body, color: "#DC2626", fontWeight: "700" }}>Delete brand</Text>
              </TouchableOpacity>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

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
  brandHead: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: spacing.lg },
  link: { ...typography.caption, color: c.accent, fontWeight: "800" as const },
  brandChip: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, maxWidth: 160, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, justifyContent: "center" as const },
  brandChipLogo: { width: 20, height: 20, borderRadius: 4 },
  postBtn: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 8, backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md },
  postText: { ...typography.bodyMedium, color: "#fff", fontWeight: "800" as const },
  expandHint: { position: "absolute" as const, bottom: 10, right: 10, flexDirection: "row" as const, alignItems: "center" as const, gap: 4, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  expandHintText: { color: "#fff", fontSize: 11, fontWeight: "700" as const },
  enlargeWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.md },
  enlargeClose: { position: "absolute" as const, top: 48, right: 20, zIndex: 2, padding: 6 },
  enlargeImg: { width: "100%" as const, height: "72%" as const },
  enlargeActions: { flexDirection: "row" as const, gap: spacing.xl, marginTop: spacing.xl },
  enlargeBtn: { alignItems: "center" as const, gap: 4 },
  enlargeBtnText: { color: "#fff", ...typography.caption, fontWeight: "700" as const },
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
