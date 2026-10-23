import { Surface } from "@ardia/shell";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { lastPicture } from "../../lib/tabPictures";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { viewTabIds } from "../../store/model";
import { useHover } from "../primitives";
import { tabTitle } from "../sidebar/actions";
import { TabIcon } from "../sidebar/TabIcon";

const CARD_WIDTH = 140;
const THUMB_HEIGHT = 78;
const CARD_PADDING = 4;
const STRIP_RADIUS = 16;

export function TabPreviewStrip({ windowId, activeTabId }: { windowId: string; activeTabId: string }) {
  const theme = useTheme();
  const ids = useBrowser(useShallow((s) => viewTabIds(s, windowId)));
  if (ids.length < 2) return null;
  return (
    <Surface
      fill={hex(theme.panel)}
      cornerRadius={STRIP_RADIUS}
      borderColor={hex(theme.panelBorder)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity}
      shadowRadius={24}
      shadowOffset={[0, 10]}
      style={{ borderRadius: STRIP_RADIUS, overflow: "hidden" }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10, gap: 8, flexDirection: "row" }}>
        {ids.map((id) => (
          <PreviewCard key={id} tabId={id} windowId={windowId} active={id === activeTabId} />
        ))}
      </ScrollView>
    </Surface>
  );
}

function PreviewCard({ tabId, windowId, active }: { tabId: string; windowId: string; active: boolean }) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  const { hovered, hoverProps } = useHover();
  if (!tab) return null;
  const picture = lastPicture(tabId);
  const uri = picture ? `data:image/jpeg;base64,${picture.data}` : null;
  const thumbWidth = CARD_WIDTH - CARD_PADDING * 2;
  const open = () => {
    useBrowser.getState().activate(tabId);
    useBrowser.getState().closePanel(windowId);
  };
  return (
    <View {...hoverProps}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={tabTitle(tab)}>
        <View
          style={{
            width: CARD_WIDTH,
            padding: CARD_PADDING,
            borderRadius: 11,
            backgroundColor: active ? theme.commandBarSelected : hovered ? theme.commandBarHover : undefined,
            borderWidth: active ? 0.5 : 0,
            borderColor: theme.accent,
          }}
        >
          {uri ? (
            <Image source={{ uri }} style={{ width: thumbWidth, height: THUMB_HEIGHT, borderRadius: 7 }} resizeMode="cover" />
          ) : (
            <View
              style={{
                width: thumbWidth,
                height: THUMB_HEIGHT,
                borderRadius: 7,
                backgroundColor: theme.urlPill,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={30} profileId={tab.profileId} />
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5, marginBottom: 1, paddingHorizontal: 2 }}>
            <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={13} profileId={tab.profileId} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: active ? theme.textPrimary : theme.textSecondary }}>
              {tabTitle(tab)}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}
