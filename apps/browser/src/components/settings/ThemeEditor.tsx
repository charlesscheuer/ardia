import { holdThemedWindowsKeyLook, choosePresetColor, setProfileTheme } from "../../state/profiles/themeActions";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import {
  DEFAULT_THEME_ANGLE,
  flatColors,
  lookAngle,
  MAX_THEME_STOPS,
  requestedDarkFor,
  resolveTheme,
  shownLook,
  startingTheme,
  themeAccent,
  withAddedStop,
  withAngle,
  withoutStop,
  spaceLookSource,
  type ShownLook,
} from "../../lib/profileLook";
import { THEME_TEXTURES } from "@ardia/core";
import { PROFILE_COLORS } from "../ui/theme";
import { useAppDark, useProfile, useSettings } from "../../state/browser/hooks";
import type { ProfileColor, ProfileTheme, ThemeMode, ThemeTexture } from "../../state/browser/types";
import { Box, Button, Group, PopUp, Segmented, space, Swatch, swatch, Text, ThemeSwatch } from "../ui";
import { importArcTheme } from "../../state/profiles/arcThemes";
import { Row, SectionHeader } from "./Form";
import { ColorPad, DirectionDial, LABEL, Labelled, LightnessBar, Preview, Slider } from "./ThemeControls";
import { settingsInk } from "./tokens";

export { arcThemeChoices, importArcTheme } from "../../state/profiles/arcThemes";

const MODES: { value: ThemeMode; symbol: string; title: string }[] = [
  { value: "light", symbol: "sun.max", title: "Light" },
  { value: "dark", symbol: "moon", title: "Dark" },
  { value: "auto", symbol: "circle.lefthalf.filled", title: "Match System" },
];

const TEXTURE_NAMES: Record<ThemeTexture, string> = { grain: "Grain", sand: "Sand", denim: "Denim", tweed: "Tweed" };

function useLiveTheme(theme: ProfileTheme | null | undefined, apply: (theme: ProfileTheme) => void) {
  const [draft, setDraft] = useState<ProfileTheme | null>(null);
  const pending = useRef<ProfileTheme | null>(null);
  const frame = useRef<number | null>(null);
  const applyLatest = useRef(apply);
  applyLatest.current = apply;
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);
  const flush = () => {
    frame.current = null;
    if (pending.current) applyLatest.current(pending.current);
  };
  const change = (next: ProfileTheme, settle = false) => {
    pending.current = next;
    setDraft(settle ? null : next);
    if (settle) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      flush();
    } else if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  return { theme: draft ?? theme ?? null, change };
}

export function useThemeDraft(profileId: string, apply: (theme: ProfileTheme) => void) {
  const profile = useProfile(profileId, (p) => p);
  const live = useLiveTheme(profile?.theme, apply);
  const appDark = useAppDark();
  const source = useSettings((s) => spaceLookSource(s));
  const stored = live.theme;
  const editsDark = !!stored && requestedDarkFor(stored, appDark, source);
  const custom = stored?.dark ? resolveTheme(stored, editsDark) : stored;
  const startCustom = () => {
    if (profile && !custom) live.change(startingTheme(PROFILE_COLORS[profile.color]?.swatch ?? PROFILE_COLORS.plum.swatch), true);
  };
  const shown = stored ? shownLook(stored, appDark, source) : null;
  return { profile, stored, custom, editsDark, shown, followsApp: source === "app", change: live.change, startCustom };
}

export function ThemeSection({ profileId }: { profileId: string }) {
  const { profile, stored, custom, editsDark, shown, followsApp, change, startCustom } = useThemeDraft(profileId, (theme) => setProfileTheme(profileId, theme));
  const editing = !!profile && !!stored;
  useEffect(() => {
    if (!editing) return;
    holdThemedWindowsKeyLook(true);
    return () => holdThemedWindowsKeyLook(false);
  }, [editing]);
  if (!profile) return null;
  const choosePreset = (color: ProfileColor) => choosePresetColor(profileId, color);
  return (
    <>
      <SectionHeader
        title="Theme"
        description="Tints this profile's windows, New Tab page and highlights."
        action={<Button title="Import from Arc…" onPress={() => void importArcTheme(profileId)} />}
      />
      <Group>
        <Row
          title="Colour"
          description={
            stored?.dark
              ? `Separate light and dark looks. Editing keeps the ${editsDark ? "dark" : "light"} one.`
              : custom
                ? "Custom gradient"
                : PROFILE_COLORS[profile.color]?.name
          }
        >
          <View style={{ flexDirection: "row", gap: swatch.gap }}>
            {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => (
              <Pressable key={c} onPress={() => choosePreset(c)} tooltip={PROFILE_COLORS[c].name}>
                <Swatch selected={!custom && profile.color === c} ring={PROFILE_COLORS[c].swatch} fill={PROFILE_COLORS[c].swatch} />
              </Pressable>
            ))}
            <Pressable onPress={startCustom} tooltip="Custom">
              <Swatch selected={!!custom} ring={custom ? themeAccent(custom) : settingsInk.customSwatch}>
                <CustomSwatch theme={custom} />
              </Swatch>
            </Pressable>
          </View>
        </Row>
        {custom && shown ? <ThemeEditor theme={custom} shown={shown} followsApp={followsApp} onChange={change} /> : null}
      </Group>
    </>
  );
}

const RAINBOW: ProfileTheme = {
  stops: [
    { x: 1, y: 0.5, color: { r: 0.93, g: 0.45, b: 0.62, a: 1 } },
    { x: 0, y: 0.5, color: { r: 0.42, g: 0.66, b: 0.95, a: 1 } },
    { x: 0.5, y: 1, color: { r: 0.62, g: 0.9, b: 0.58, a: 1 } },
  ],
  intensity: 1,
  mode: "auto",
  grain: 0,
  texture: "grain",
  translucency: 0,
};

export function CustomSwatch({ theme }: { theme: ProfileTheme | null }) {
  return <ThemeSwatch colors={flatColors(theme ?? RAINBOW)} angle={theme ? lookAngle(theme) : DEFAULT_THEME_ANGLE} style={{ flex: 1 }} />;
}

function ThemeStops({ theme, onChange }: { theme: ProfileTheme; onChange: (next: ProfileTheme, settle?: boolean) => void }) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, theme.stops.length - 1);
  return (
    <Box gap="m">
      <ColorPad theme={theme} selected={index} onSelect={setSelected} onChange={onChange} />
      <LightnessBar theme={theme} index={index} onChange={onChange} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text size="caption" tone="textSecondary">
          {theme.stops.length} of {MAX_THEME_STOPS} colours
        </Text>
        <Box row gap="xs">
          <Button
            variant="stepper"
            icon="minus"
            tooltip="Remove Colour"
            disabled={theme.stops.length <= 1}
            onPress={() => {
              onChange(withoutStop(theme, index), true);
              setSelected(Math.max(0, index - 1));
            }}
          />
          <Button
            variant="stepper"
            icon="plus"
            tooltip="Add Colour"
            disabled={theme.stops.length >= MAX_THEME_STOPS}
            onPress={() => {
              onChange(withAddedStop(theme), true);
              setSelected(theme.stops.length);
            }}
          />
        </Box>
      </View>
    </Box>
  );
}

export function CompactThemeEditor({ theme, onChange }: { theme: ProfileTheme; onChange: (next: ProfileTheme, settle?: boolean) => void }) {
  return (
    <Box row gap="xl">
      <ThemeStops theme={theme} onChange={onChange} />
      <Box gap="xl" style={FILL}>
        <Slider stacked label="Intensity" value={theme.intensity} onChange={(v, settle) => onChange({ ...theme, intensity: v }, settle)} />
        <Slider stacked label="Pass-through blur" value={theme.translucency} onChange={(v, settle) => onChange({ ...theme, translucency: v }, settle)} />
        <Slider stacked label="Noise" value={theme.grain} onChange={(v, settle) => onChange({ ...theme, grain: v }, settle)}>
          <PopUp
            value={theme.texture}
            minWidth={78}
            options={THEME_TEXTURES.map((t) => ({ value: t, title: TEXTURE_NAMES[t] }))}
            onChange={(texture) => onChange({ ...theme, texture, grain: theme.grain || 0.5 }, true)}
          />
        </Slider>
        <Labelled label="Direction">
          <DirectionDial angle={lookAngle(theme)} onChange={(angle, settle) => onChange(withAngle(theme, angle), settle)} />
        </Labelled>
      </Box>
    </Box>
  );
}

function ThemeEditor({
  theme,
  shown,
  followsApp,
  onChange,
}: {
  theme: ProfileTheme;
  shown: ShownLook;
  followsApp: boolean;
  onChange: (next: ProfileTheme, settle?: boolean) => void;
}) {
  return (
    <Box row pad="l" gap="xl">
      <ThemeStops theme={theme} onChange={onChange} />
      <Box gap="l" style={FILL}>
        <Preview shown={shown} />
        <Slider label="Intensity" value={theme.intensity} onChange={(v, settle) => onChange({ ...theme, intensity: v }, settle)} />
        <Slider
          label="Pass-through blur"
          value={theme.translucency}
          onChange={(v, settle) => onChange({ ...theme, translucency: v }, settle)}
        />
        <Slider label="Noise" value={theme.grain} onChange={(v, settle) => onChange({ ...theme, grain: v }, settle)}>
          <PopUp
            value={theme.texture}
            minWidth={78}
            options={THEME_TEXTURES.map((t) => ({ value: t, title: TEXTURE_NAMES[t] }))}
            onChange={(texture) => onChange({ ...theme, texture, grain: theme.grain || 0.5 }, true)}
          />
        </Slider>
        <View style={LABELLED_ROW}>
          <Text size="small" style={EDITOR_LABEL}>
            Direction
          </Text>
          <DirectionDial angle={lookAngle(theme)} onChange={(angle, settle) => onChange(withAngle(theme, angle), settle)} />
        </View>
        <View style={LABELLED_ROW}>
          <Text size="small" style={EDITOR_LABEL}>
            Appearance
          </Text>
          {followsApp ? (
            <Text size="caption" tone="textSecondary" lines={2} style={FILL}>
              Follows Settings › Appearance
            </Text>
          ) : (
            <Segmented options={MODE_OPTIONS} value={theme.mode} onChange={(mode) => onChange({ ...theme, mode }, true)} />
          )}
          {shown.dark !== shown.requestedDark ? (
            <Text size="caption" tone="textSecondary" lines={2} style={KEPT_NOTE}>
              Kept {shown.dark ? "dark" : "light"} so text stays readable
            </Text>
          ) : null}
        </View>
      </Box>
    </Box>
  );
}

const FILL = { flex: 1 } as const;
const LABELLED_ROW = { flexDirection: "row", alignItems: "center" } as const;
const EDITOR_LABEL = { width: LABEL + space.ml } as const;
const KEPT_NOTE = { flex: 1, marginLeft: space.m } as const;
const MODE_OPTIONS = MODES.map((m) => ({ value: m.value, title: m.title, image: m.symbol }));
