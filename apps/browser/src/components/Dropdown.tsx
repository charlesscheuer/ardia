import { Surface, Symbol } from "@ardia/shell";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../lib/theme";

const ENTER_MS = 200;
const ENTER_EASE = Easing.bezier(0.215, 0.61, 0.355, 1);
const ENTER_RISE = 8;
const RADIUS = 12;
const MAX_HEIGHT = 340;

export type DropdownItem = { id: string; label: string; icon?: ReactNode; detail?: string; selected?: boolean };
export type DropdownSection = { title?: string; items: DropdownItem[] };
export type DropdownPlacement = { top?: number; bottom?: number; left?: number; right?: number };

export function Dropdown({
  sections,
  placement,
  width = 272,
  onSelect,
  onClose,
}: {
  sections: DropdownSection[];
  placement: DropdownPlacement;
  width?: number;
  onSelect(id: string): void;
  onClose(): void;
}) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: ENTER_MS, easing: ENTER_EASE, useNativeDriver: true }).start();
  }, [appear]);
  const rise = placement.bottom !== undefined ? ENTER_RISE : -ENTER_RISE;
  const shown = sections.filter((s) => s.items.length);
  return (
    <>
      <Pressable style={[StyleSheet.absoluteFill, { cursor: "auto" }]} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View
        style={{
          position: "absolute",
          ...placement,
          width,
          maxWidth: "94%",
          opacity: appear,
          transform: [
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
          ],
        }}
      >
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={RADIUS} shadowColor="#000000" shadowOpacity={theme.dark ? 0.32 : 0.12} shadowRadius={12} shadowOffset={[0, 4]} />
        <Surface fill={hex(theme.menuSurface)} cornerRadius={RADIUS} borderColor={hex(theme.menuBorder)} borderWidth={1}>
          <ScrollView style={{ maxHeight: MAX_HEIGHT }} contentContainerStyle={{ padding: 4 }}>
            {shown.map((section, i) => (
              <View key={section.title ?? i}>
                {i > 0 && <View style={{ height: 1, marginVertical: 4, marginHorizontal: -4, backgroundColor: theme.menuBorder }} />}
                {section.title && (
                  <Text style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6, fontSize: 12, fontWeight: "600", color: theme.textSecondary }}>{section.title}</Text>
                )}
                {section.items.map((item) => (
                  <DropdownRow key={item.id} item={item} onPress={() => onSelect(item.id)} />
                ))}
              </View>
            ))}
          </ScrollView>
        </Surface>
      </Animated.View>
    </>
  );
}

function DropdownRow({ item, onPress }: { item: DropdownItem; onPress(): void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const strong = hovered || !!item.selected;
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessibilityRole="menuitem" accessibilityState={{ selected: !!item.selected }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, backgroundColor: hovered ? theme.rowHover : "transparent" }}>
        {item.icon && <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>{item.icon}</View>}
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, fontWeight: "500", color: strong ? theme.textPrimary : theme.textSecondary }}>
          {item.label}
        </Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textTertiary }}>
          {item.detail ?? ""}
        </Text>
        {item.selected && <Symbol name="checkmark" size={11} weight="semibold" color={theme.textPrimary} style={{ width: 16, height: 16 }} />}
      </View>
    </Pressable>
  );
}

export function DropdownSymbol({ name }: { name: string }) {
  const theme = useTheme();
  return <Symbol name={name} size={12} weight="medium" color={theme.textSecondary} style={{ width: 16, height: 16 }} />;
}

export type DropdownRequest = {
  anchor: View;
  sections: DropdownSection[];
  onSelect(id: string): void;
  side?: "below" | "above";
  align?: "left" | "right";
  width?: number;
};

const HostContext = createContext<((request: DropdownRequest) => void) | null>(null);

export const useDropdownHost = () => useContext(HostContext);

export function DropdownHost({ children }: { children: ReactNode }) {
  const root = useRef<View>(null);
  const [menu, setMenu] = useState<(DropdownRequest & { placement: DropdownPlacement }) | null>(null);
  const open = useCallback((request: DropdownRequest) => {
    root.current?.measureInWindow((hx, hy, hw, hh) =>
      request.anchor.measureInWindow((x, y, w, h) => {
        const vertical = request.side === "above" ? { bottom: hy + hh - y + 6 } : { top: y - hy + h + 6 };
        const horizontal = request.align === "right" ? { right: hx + hw - (x + w) } : { left: x - hx };
        setMenu({ ...request, placement: { ...vertical, ...horizontal } });
      }),
    );
  }, []);
  return (
    <HostContext.Provider value={open}>
      <View ref={root} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
        {menu && (
          <Dropdown
            sections={menu.sections}
            placement={menu.placement}
            width={menu.width}
            onClose={() => setMenu(null)}
            onSelect={(id) => {
              setMenu(null);
              menu.onSelect(id);
            }}
          />
        )}
      </View>
    </HostContext.Provider>
  );
}
