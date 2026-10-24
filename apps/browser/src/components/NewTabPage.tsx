import { PowerUp } from "@ardia/shaders";
import { useEffect, useState } from "react";
import { Surface } from "@ardia/shell";
import { StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { useWindowId } from "../store/hooks";
import { DropdownHost } from "./Dropdown";
import { NewTabExtras } from "./ntp";
import { useOnboarding } from "./onboarding/state";
import { Omnibox } from "./Omnibox";

const BAR_HEIGHT = 112;
const BAR_BORDER = 1;
const BAR_RADIUS = 24;
const DIA_OFFSET = 1;

type Size = { width: number; height: number };
let lastSize: Size | null = null;
const introPlayed = new Set<string>();

export function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

export function NewTabPage({ tabId, toolbar = true }: { tabId: string; toolbar?: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const onboarding = useOnboarding((s) => s.windowId === windowId);
  const [size, setSizeState] = useState<Size | null>(lastSize);
  const setSize = (next: Size) => {
    lastSize = next;
    setSizeState((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  };
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  const under = toolbar ? 0 : layout.toolbarHeight;
  const top = Math.max((size.height - under) / 2 - 158, 100) + 38 + DIA_OFFSET + under;

  const bar = { x, y: top, width, height: panelHeight };

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      <DropdownHost>
        {playIntro && theme.powerUpPalette && (
          <PowerUp
            style={StyleSheet.absoluteFill}
            palette={theme.powerUpPalette}
            speed={1}
            origin={0.5}
            cornerRadius={BAR_RADIUS}
            halo={bar}
          />
        )}
        <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
          <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={BAR_RADIUS} shadowColor="#000000" shadowOpacity={theme.dark ? 0.18 : 0.07} shadowRadius={1} shadowOffset={[0, 1]} />
          <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={BAR_RADIUS} shadowColor="#000000" shadowOpacity={theme.dark ? 0.18 : 0.06} shadowRadius={6} shadowOffset={[0, 6]} />
          <Surface
            fill={hex(theme.ntpBarSolid)}
            cornerRadius={BAR_RADIUS}
            borderColor={hex(theme.ntpBarBorder)}
            borderWidth={BAR_BORDER}
          >
            {onboarding ? <View style={{ height: BAR_HEIGHT - 2 * BAR_BORDER }} /> : <Omnibox variant="hero" tabId={tabId} />}
          </Surface>
        </View>
        <NewTabExtras size={size} bar={bar} />
      </DropdownHost>
    </View>
  );
}
