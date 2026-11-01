import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { PROFILE_COLORS } from "../ui/theme";
import { useTabLayout, useWindow } from "../../state/browser/hooks";
import { choosePresetColor } from "../../state/profiles/themeActions";
import { themeAccent } from "../../lib/profileLook";
import { CompactThemeEditor, CustomSwatch, useThemeDraft } from "../settings/ThemeEditor";
import { settingsInk } from "../settings/tokens";
import { toggleTabLayout } from "../../state/splits/actions";
import type { ProfileColor, ProfileTheme } from "../../state/browser/types";
import { Swatch } from "../ui";
import { MiniWindow } from "../settings/MiniWindow";
import { OptionCard } from "./OptionCard";
import { useOnboardingColors } from "./Parts";
import { curve } from "../ui/motion";
import { radius, space, type Space } from "../ui/tokens";
import { onboardingMotion } from "./tokens";

export const PERSONALIZE_COPY = {
  title: "Make it yours",
  subtitle: "Pick the theme color and layout that feel right for you.",
  layouts: "Choose how you would like to view your tabs:",
} as const;

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

export function ThemeColorPicker({
  windowId,
  size = 28,
  gap = "s",
  onPick,
  onTheme,
}: {
  windowId: string;
  size?: number;
  gap?: Space;
  onPick?: (color: ProfileColor) => void;
  onTheme?: (theme: ProfileTheme) => void;
}) {
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const look = useThemeDraft(profileId ?? "", (theme) => onTheme?.(theme));
  if (!profileId || incognito || !look.profile) return null;
  const { custom } = look;
  return (
    <View style={{ gap: space.xxxl }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[gap] }} accessibilityRole="radiogroup" accessibilityLabel="Theme color">
        {COLORS.map((c) => (
          <ColorButton
            key={c}
            name={PROFILE_COLORS[c].name}
            ring={PROFILE_COLORS[c].swatch}
            fill={PROFILE_COLORS[c].swatch}
            size={size}
            selected={!custom && look.profile?.color === c}
            onPress={() => (onPick ? onPick(c) : choosePresetColor(profileId, c))}
          />
        ))}
        {onTheme ? (
          <ColorButton name="Custom" ring={custom ? themeAccent(custom) : settingsInk.customSwatch} fill={<CustomSwatch theme={custom} />} size={size} selected={!!custom} onPress={look.startCustom} />
        ) : null}
      </View>
      {onTheme && custom ? (
        <FadeIn>
          <CompactThemeEditor theme={custom} onChange={look.change} />
        </FadeIn>
      ) : null}
    </View>
  );
}

function FadeIn({ children }: { children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: onboardingMotion.swatch, easing: curve.enter, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>;
}

function ColorButton({ name, ring, fill, size, selected, onPress }: { name: string; ring: string; fill: string | ReactNode; size: number; selected: boolean; onPress: () => void }) {
  return (
    <View tooltip={name}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={name}>
        {({ pressed }) => (
          <View style={{ transform: [{ scale: pressed ? 0.94 : 1 }] }}>
            <Swatch animated size={size} selected={selected} ring={ring} fill={typeof fill === "string" ? fill : undefined}>
              {typeof fill === "string" ? null : fill}
            </Swatch>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function TabLayoutPicker({ windowId }: { windowId: string }) {
  const layout = useTabLayout(windowId);
  const pick = (next: "sidebar" | "top") => {
    if (next !== layout) toggleTabLayout(windowId);
  };
  return (
    <View style={{ flexDirection: "row", gap: space.ml }} accessibilityRole="radiogroup" accessibilityLabel="Tab layout">
      <LayoutButton kind="sidebar" title="Sidebar" subtitle="Tabs down the side" selected={layout === "sidebar"} onPress={() => pick("sidebar")} />
      <LayoutButton kind="top" title="Classic" subtitle="Tabs along the top" selected={layout === "top"} onPress={() => pick("top")} />
    </View>
  );
}

const LAYOUT_PREVIEW_HEIGHT = 64;

function LayoutButton({ kind, title, subtitle, selected, onPress }: { kind: "sidebar" | "top"; title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const preview = (
    <View style={{ height: LAYOUT_PREVIEW_HEIGHT, borderRadius: radius.tile, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder }}>
      <MiniWindow
        layout={kind === "sidebar" ? "side" : "top"}
        bars={[1, 0.8, 0.9]}
        size="m"
        look={{ window: colors.preview, bar: colors.progressTrack, page: colors.card, edge: colors.previewBorder }}
      />
    </View>
  );
  return <OptionCard control="radio" title={title} subtitle={subtitle} selected={selected} onPress={onPress} preview={preview} />;
}
