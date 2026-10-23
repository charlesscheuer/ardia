import { PowerUp } from "@ardia/shaders";
import { useEffect, useState } from "react";
import { Surface } from "@ardia/shell";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { useWindowId } from "../store/hooks";
import { NewTabExtras } from "./ntp";
import { useOnboarding } from "./onboarding/state";
import { Omnibox } from "./Omnibox";

const BAR_HEIGHT = 112;
const BAR_BORDER = 1;
const BAR_RADIUS = 24;
const GREETING_SIZE = 32;
const GREETING_LINE = 40;
const GREETING_GAP = 32;
const GREETING_RISE = 4;
const GREETING_WORD_MS = 430;
const GREETING_STAGGER_MS = 70;
const EMPHASIZED = Easing.bezier(0.23, 1, 0.32, 1);
const GREETINGS = [
  "Where to next?",
  "What are we looking up?",
  "What’s on your mind?",
  "Where do we start?",
  "What’s the plan?",
  "What are we reading today?",
  "What’s cooking?",
  "Ready when you are.",
];
const DIA_OFFSET = 1;

type Size = { width: number; height: number };
let lastSize: Size | null = null;
const introPlayed = new Set<string>();
const greetings = new Map<string, string>();

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on), () => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

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
      <Greeting tabId={tabId} animate={playIntro && !reduceMotion} color={theme.ntpGreeting} top={top - GREETING_GAP - GREETING_LINE} />
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
    </View>
  );
}

function Greeting({ tabId, animate, color, top }: { tabId: string; animate: boolean; color: string; top: number }) {
  const [words] = useState(() => {
    const line = greetings.get(tabId) ?? GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!;
    greetings.set(tabId, line);
    return line.split(" ").map((word) => ({ word, shown: new Animated.Value(animate ? 0 : 1) }));
  });
  useEffect(() => {
    if (!animate) return;
    const entrance = Animated.parallel(
      words.map((w, i) =>
        Animated.timing(w.shown, { toValue: 1, duration: GREETING_WORD_MS, delay: i * GREETING_STAGGER_MS, easing: EMPHASIZED, useNativeDriver: true }),
      ),
    );
    entrance.start();
    return () => entrance.stop();
  }, [animate, words]);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: DIA_OFFSET, right: 0, top, height: GREETING_LINE, flexDirection: "row", justifyContent: "center", alignItems: "center" }}
    >
      {words.map((w, i) => (
        <Animated.Text
          key={i}
          style={{
            fontSize: GREETING_SIZE,
            lineHeight: GREETING_LINE,
            letterSpacing: -0.02 * GREETING_SIZE,
            fontWeight: "500",
            color,
            opacity: w.shown,
            transform: [{ translateY: w.shown.interpolate({ inputRange: [0, 1], outputRange: [GREETING_RISE, 0] }) }],
          }}
        >
          {i === 0 ? w.word : ` ${w.word}`}
        </Animated.Text>
      ))}
    </View>
  );
}
