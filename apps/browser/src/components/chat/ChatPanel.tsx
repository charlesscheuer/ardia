import { WebView, type WebViewHandle } from "@ardia/ardiacore";
import { showMenu, Surface, Symbol } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { openFromPage, pageProfileId } from "../layout/openFromPage";
import { pageProfile } from "../extensions/store";
import { Dropdown, DropdownSymbol, type DropdownPlacement, type DropdownSection } from "../Dropdown";
import { Favicon, IconButton } from "../primitives";
import { accountById, CHAT_ACCOUNTS, registerAccountWebView, type ChatAccount, type ChatAccountId } from "./accounts";
import { diffCounts, lineDiff } from "./diff";
import { chooseWorkingFile, fileNameOf, loadWorkingFile } from "./files";
import { setInspectorTab, startInspector } from "./inspector";
import { flashElement, pickElement, readSelection } from "./pickElement";
import {
  applyProposedEdit,
  attachPick,
  attachSelection,
  changesPending,
  checkLocalAgent,
  clearSelection,
  closeChatPanel,
  emptyChat,
  excludePageChanges,
  localAgentWorking,
  markConnected,
  newThread,
  pollLocalAgent,
  pullProposedEdit,
  removePick,
  sendMessage,
  setAccount,
  setChatTab,
  setInspected,
  setInspectorStatus,
  setPageAttached,
  setPageChanges,
  setProposedEdit,
  setViewingSession,
  setWorkingFile,
  settleMessage,
  showPage,
  systemNote,
  useChat,
  type ChatMessage,
  type WindowChat,
} from "./state";

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const HEADER = 40;
const DEFAULT_WIDTH = 380;
const COMPOSER_RADIUS = 20;
const SEND_SIZE = 32;
const BRIDGE_POLL_MS = 2000;
const REVEAL_MS = 1000;
const REVEAL_EASE = Easing.bezier(0, 0, 0.58, 1);
const ACCOUNT_LOGO: Partial<Record<ChatAccountId, number>> = {
  claude: require("../../../assets/chat-claude.png"),
  chatgpt: require("../../../assets/chat-openai.png"),
  codex: require("../../../assets/chat-openai.png"),
};
const COMPOSER_MENU_BOTTOM = 60;

type MenuRequest = { sections: DropdownSection[]; placement: DropdownPlacement; onSelect(id: string): void };

function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > MAX_WIDTH) return MAX_WIDTH + band(width - MAX_WIDTH);
  if (width < MIN_WIDTH) return MIN_WIDTH - band(MIN_WIDTH - width);
  return width;
}
const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

const EMPTY_CHAT = emptyChat();

export function ChatPanel() {
  const windowId = useWindowId();
  const chat = useChat((s) => s.windows[windowId]);
  const savedWidth = useBrowser((s) => s.settings.chatPanelWidth ?? DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  const panelOpen = !!chat?.open;
  const tab = chat?.tab ?? "style";
  const tabId = useBrowser((s) => activeTabId(s, windowId));
  const url = useBrowser((s) => (tabId ? s.tabs[tabId]?.url : undefined));
  const inspectable = !!url && /^(https?|file):/.test(url);
  const open = panelOpen && (tab === "agent" || !inspectable || chat?.inspector === "unavailable");
  const tracking = Object.values(chat?.bridgeThreads ?? {}).some((t) => t.status !== "done");

  useEffect(() => {
    if (panelOpen) showPage(windowId, url);
  }, [panelOpen, url, windowId]);

  useEffect(() => {
    if (!panelOpen || !tabId || !inspectable) return;
    setInspected(windowId, null);
    return startInspector(
      tabId,
      {
        onSelect: (pick) => setInspected(windowId, pick),
        onAvailable: (available) => setInspectorStatus(windowId, available ? "ready" : "unavailable"),
        onTab: (next) => setChatTab(windowId, next),
        onChanges: (count, items) => setPageChanges(windowId, count, items),
      },
      () => useChat.getState().windows[windowId]?.tab ?? "style",
    );
  }, [panelOpen, tabId, inspectable, windowId]);

  useEffect(() => {
    if (panelOpen) void setInspectorTab(tabId ?? undefined, tab);
  }, [panelOpen, tab, tabId]);

  useEffect(() => {
    if (!tracking) return;
    void pollLocalAgent(windowId);
    const timer = setInterval(() => void pollLocalAgent(windowId), BRIDGE_POLL_MS);
    return () => clearInterval(timer);
  }, [tracking, windowId]);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(appear, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open]);

  const width = dragWidth ?? savedWidth;
  const start = useRef(width);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = useBrowser.getState().settings.chatPanelWidth ?? DEFAULT_WIDTH;
          setDragWidth(start.current);
        },
        onPanResponderMove: (_, g) => setDragWidth(rubberBand(start.current - g.dx)),
        onPanResponderRelease: (_, g) => {
          const raw = rubberBand(start.current - g.dx);
          const target = clamp(raw);
          const finish = () => {
            useBrowser.getState().updateSettings({ chatPanelWidth: target });
            setDragWidth(null);
          };
          if (raw === target) return finish();
          const value = new Animated.Value(raw);
          value.addListener(({ value: v }) => setDragWidth(v));
          Animated.timing(value, { toValue: target, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: false }).start(() => {
            value.removeAllListeners();
            finish();
          });
        },
        onPanResponderTerminate: () => setDragWidth(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  if (!mounted) return null;
  const room = width + layout.cardInset - 1;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width, opacity: appear }}>
        <ChatCard windowId={windowId} chat={chat ?? EMPTY_CHAT} />
        <View
          {...responder.panHandlers}
          onDoubleClick={() => useBrowser.getState().updateSettings({ chatPanelWidth: DEFAULT_WIDTH })}
          style={{ position: "absolute", top: 0, bottom: 0, left: -3, width: 7, cursor: "col-resize" }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function ChatCard({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const account = accountById(chat.account);
  const connected = !!chat.connected[chat.account];
  const local = account.kind === "bridge";
  const showSession = !local && (chat.viewingSession || !connected);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const openModels = async (placement: DropdownPlacement) => {
    const running = await checkLocalAgent(windowId);
    setMenu({ sections: modelSections(useChat.getState().windows[windowId] ?? chat, running), placement, onSelect: (id) => setAccount(windowId, id as ChatAccountId) });
  };
  useEffect(() => {
    if (local) void checkLocalAgent(windowId);
  }, [local, windowId]);

  return (
    <View style={{ flex: 1, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <View style={{ height: HEADER, flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 5, gap: 6 }}>
        <PanelTabs windowId={windowId} tab={chat.tab} styleAvailable={chat.inspector !== "unavailable"} />
        {showSession && <ModelPicker chat={chat} onOpen={() => void openModels({ top: HEADER + 4, left: 120 })} />}
        <View style={{ flex: 1 }} />
        {!local && connected && (
          <IconButton
            icon={chat.viewingSession ? "bubble.left" : "macwindow"}
            size={13}
            tooltip={chat.viewingSession ? "Show Thread" : `Show ${account.name} Session`}
            onPress={() => setViewingSession(windowId, !chat.viewingSession)}
          />
        )}
        <IconButton icon="plus" size={13} tooltip="New Thread" onPress={() => newThread(windowId)} />
        <IconButton icon="xmark" size={12} weight="medium" tooltip="Close Chat" onPress={() => closeChatPanel(windowId)} />
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }} />
      {!local && <SessionView windowId={windowId} account={account} connected={connected} hidden={!showSession} />}
      {!showSession && (
        <>
          <ThreadView windowId={windowId} chat={chat} />
          <Composer windowId={windowId} chat={chat} onOpenModels={() => void openModels({ bottom: COMPOSER_MENU_BOTTOM, right: 10 })} onOpenMenu={setMenu} />
        </>
      )}
      {menu && (
        <Dropdown
          sections={menu.sections}
          placement={menu.placement}
          onClose={() => setMenu(null)}
          onSelect={(id) => {
            setMenu(null);
            menu.onSelect(id);
          }}
        />
      )}
    </View>
  );
}

function PanelTabs({ windowId, tab, styleAvailable }: { windowId: string; tab: WindowChat["tab"]; styleAvailable: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <PanelTab label="Agent" selected={tab === "agent"} onPress={() => setChatTab(windowId, "agent")} />
      <PanelTab label="Style" selected={tab === "style" && styleAvailable} disabled={!styleAvailable} onPress={() => setChatTab(windowId, "style")} />
    </View>
  );
}

function PanelTab({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable onPress={onPress} disabled={disabled} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessibilityRole="tab" accessibilityState={{ selected, disabled }}>
      <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, justifyContent: "center", backgroundColor: selected ? theme.rowSelected : hovered && !disabled ? theme.rowHover : "transparent" }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: selected ? theme.textPrimary : disabled ? theme.textTertiary : theme.textSecondary }}>{label}</Text>
      </View>
    </Pressable>
  );
}

function AccountIcon({ id, size = 16 }: { id: ChatAccountId; size?: number }) {
  const theme = useTheme();
  const logo = ACCOUNT_LOGO[id];
  if (logo) return <Image source={logo} style={{ width: size, height: size }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "#F5F5F4" : "#191715" }}>
      <Symbol name="cursorarrow.rays" size={size * 0.56} weight="semibold" color={theme.dark ? "#191715" : "#FFFFFF"} style={{ width: size * 0.75, height: size * 0.75 }} />
    </View>
  );
}

function modelSections(chat: WindowChat, running: boolean): DropdownSection[] {
  const row = (account: ChatAccount, detail: string) => ({ id: account.id, label: account.name, icon: <AccountIcon id={account.id} />, detail, selected: account.id === chat.account });
  return [
    { title: "Accounts", items: CHAT_ACCOUNTS.filter((a) => a.kind === "web").map((a) => row(a, chat.connected[a.id] ? "Signed in" : "Sign in")) },
    { title: "Local", items: CHAT_ACCOUNTS.filter((a) => a.kind === "bridge").map((a) => row(a, running ? "Running" : "Not running")) },
  ];
}

function ModelPicker({ chat, onOpen }: { chat: WindowChat; onOpen: () => void }) {
  const theme = useTheme();
  const account = accountById(chat.account);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable onPress={onOpen} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessibilityLabel={`Model picker: ${account.name}`}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 32,
            paddingLeft: 8,
            paddingRight: 10,
            borderRadius: 12,
            backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.rowHover : "transparent",
          }}
        >
          <AccountIcon id={account.id} />
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: hovered ? theme.textPrimary : theme.textSecondary }}>
            {account.name}
          </Text>
          <Symbol name="chevron.down" size={8} weight="bold" color={theme.textTertiary} style={{ width: 10, height: 10 }} />
        </View>
      )}
    </Pressable>
  );
}

function SessionView({ windowId, account, connected, hidden }: { windowId: string; account: ChatAccount; connected: boolean; hidden: boolean }) {
  const theme = useTheme();
  const profile = useBrowser((s) => pageProfile(s, windowId));
  return (
    <View pointerEvents={hidden ? "none" : "auto"} style={hidden ? { position: "absolute", left: 0, right: 0, bottom: 0, height: 1, opacity: 0 } : { flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        <WebView
          key={account.id}
          ref={(handle: WebViewHandle | null) => registerAccountWebView(account.id, handle)}
          style={StyleSheet.absoluteFill}
          url={account.home}
          profile={profile}
          standalone
          extensionHost="sidePanel"
          pageBackgroundColor="#FFFFFF"
          onNavigationChange={(state) => {
            if (!state.url || state.url.includes(account.loginPath)) return;
            try {
              if (new URL(state.url).hostname.endsWith(account.host)) markConnected(windowId, account.id);
            } catch {}
          }}
          onOpenWindow={(request) => openFromPage(request, { windowId, profileId: pageProfileId(windowId, profile) })}
        />
      </View>
      {!connected && !hidden && (
        <View style={{ padding: 10, gap: 6 }}>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            Sign in to your {account.name} account here. Your session is kept in this browser profile, like any tab.
          </Text>
          <Pressable onPress={() => markConnected(windowId, account.id)}>
            {({ pressed }) => (
              <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, height: 26, borderRadius: 7, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : theme.rowHover }}>
                <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>I'm signed in</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ThreadView({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  const local = accountById(chat.account).kind === "bridge";
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, gap: 14 }}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {chat.messages.length === 0 && (
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
          {local
            ? "Messages go through the InterfaceKit bridge on :4923 with the page and picked elements attached, exactly like an InterfaceKit comment, to whichever agent the bridge routes them. Replies show up here."
            : "Messages you send go to the connected account with the page, picked elements and working file attached as context. Replies appear in the account's session."}
        </Text>
      )}
      {chat.messages.map((message) => (
        <MessageRow key={message.id} windowId={windowId} message={message} />
      ))}
      {localAgentWorking(chat) && <WorkingRow />}
      {chat.workingFile && <ProposalEditor windowId={windowId} chat={chat} />}
    </ScrollView>
  );
}

const DELIVERY_LABEL: Record<string, string> = {
  sending: "Sending…",
  "handed-off": "Opened in the account session",
  typed: "Sent",
  copied: "Copied — paste it into the session",
  failed: "Couldn't send",
  bridged: "Sent",
  unassigned: "Queued — no agent is listening yet",
};

function deliveryLabel(message: ChatMessage) {
  if (message.delivery === "bridged" && message.worker) return `Sent to ${message.worker}`;
  return message.delivery ? (DELIVERY_LABEL[message.delivery] ?? message.delivery) : "";
}

function MessageRow({ windowId, message }: { windowId: string; message: ChatMessage }) {
  const theme = useTheme();
  const tabId = useBrowser((s) => activeTabId(s, windowId));
  if (message.role === "system") {
    return (
      <Text style={{ fontSize: 11.5, lineHeight: 16, color: theme.textTertiary, textAlign: "center", paddingHorizontal: 12 }}>{message.text}</Text>
    );
  }
  const account = message.account ? accountById(message.account) : null;
  if (message.role === "agent") {
    return (
      <View style={{ gap: 6, paddingRight: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {account && <AccountIcon id={account.id} size={14} />}
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.textTertiary }}>{account?.name ?? "Agent"}</Text>
        </View>
        <RevealText
          text={message.text}
          animate={!!message.fresh}
          streaming={!!message.streaming}
          onDone={() => settleMessage(windowId, message.id)}
          style={{ fontSize: 13.5, lineHeight: 20, color: theme.textPrimary }}
        />
      </View>
    );
  }
  const meta = [
    account ? `→ ${account.name}` : "",
    message.changeCount ? `${message.changeCount} ${message.changeCount === 1 ? "change" : "changes"}` : "",
    deliveryLabel(message),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={{ alignItems: "flex-end", gap: 5 }}>
      <View style={{ maxWidth: "88%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.rowHover }}>
        <Text selectable style={{ fontSize: 13.5, lineHeight: 20, color: theme.textPrimary }}>
          {message.text}
        </Text>
      </View>
      {message.picks?.map((pick, i) => (
        <Pressable key={i} onPress={() => tabId && flashElement(tabId, pick)} style={{ maxWidth: "88%" }}>
          <View style={{ borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: theme.rowHover, gap: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>
              {pick.element}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.textTertiary }}>
              {pick.elementPath}
            </Text>
          </View>
        </Pressable>
      ))}
      {(message.page || message.fileName) && (
        <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textTertiary, maxWidth: "88%" }}>
          {[message.page ? message.page.host || message.page.title : "", message.fileName ?? ""].filter(Boolean).join(" · ")}
        </Text>
      )}
      {!!meta && <Text style={{ fontSize: 11, color: theme.textTertiary }}>{meta}</Text>}
    </View>
  );
}

function RevealText({ text, animate, streaming, onDone, style }: { text: string; animate: boolean; streaming: boolean; onDone: () => void; style: object }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const current = useRef(shown);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!animate) {
      current.current = text.length;
      setShown(text.length);
      return;
    }
    const from = Math.min(current.current, text.length);
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / REVEAL_MS);
      current.current = Math.floor(from + (text.length - from) * REVEAL_EASE(t));
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
      else if (!streaming) done.current();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, streaming, text]);
  return (
    <Text selectable style={style}>
      {animate ? text.slice(0, shown) : text}
    </Text>
  );
}

function WorkingRow() {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.Text style={{ fontSize: 13, color: theme.textSecondary, opacity: pulse }}>Working…</Animated.Text>;
}

function ProposalEditor({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const file = chat.workingFile!;
  const proposed = chat.proposedEdit;
  if (proposed == null) {
    return (
      <Pressable onPress={() => setProposedEdit(windowId, "")}>
        {({ pressed }) => (
          <View style={{ borderRadius: 8, paddingHorizontal: 9, height: 30, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : theme.rowHover }}>
            <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>Propose an edit to {file.name}…</Text>
          </View>
        )}
      </Pressable>
    );
  }
  const lines = lineDiff(file.content, proposed);
  const counts = diffCounts(lines);
  return (
    <View style={{ gap: 6, borderRadius: 8, padding: 9, backgroundColor: theme.rowHover }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>
        Proposed edit — {file.name} <Text style={{ fontWeight: "400", color: theme.textSecondary }}> (+{counts.added} / −{counts.removed})</Text>
      </Text>
      <TextInput
        multiline
        value={proposed}
        onChangeText={(text) => setProposedEdit(windowId, text)}
        placeholder="Paste the complete revised file here, or pull the last code block from the session."
        placeholderTextColor={theme.textTertiary}
        style={{ minHeight: 90, maxHeight: 180, fontSize: 11.5, lineHeight: 15, color: theme.textPrimary, fontFamily: "Menlo", textAlignVertical: "top" }}
      />
      <ScrollView style={{ maxHeight: 140 }} contentContainerStyle={{ gap: 0 }}>
        {lines.slice(0, 400).map((line, i) => (
          <Text key={i} numberOfLines={1} style={{ fontSize: 10.5, lineHeight: 14, fontFamily: "Menlo", color: line.kind === "add" ? "#2F9E6E" : line.kind === "remove" ? "#D64545" : theme.textTertiary }}>
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "− " : "  "}
            {line.text}
          </Text>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <ProposalButton label="Pull from session" onPress={() => void pullProposedEdit(windowId)} />
        <ProposalButton label="Apply" primary onPress={() => void applyProposedEdit(windowId)} />
        <ProposalButton label="Discard" onPress={() => setProposedEdit(windowId, null)} />
      </View>
    </View>
  );
}

function ProposalButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            paddingHorizontal: 10,
            height: 26,
            borderRadius: 7,
            justifyContent: "center",
            backgroundColor: primary ? theme.accent : pressed ? theme.toolbarPressed : theme.card,
            opacity: pressed ? 0.85 : 1,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "500", color: primary ? "#FFFFFF" : theme.textPrimary }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Composer({
  windowId,
  chat,
  onOpenModels,
  onOpenMenu,
}: {
  windowId: string;
  chat: WindowChat;
  onOpenModels: () => void;
  onOpenMenu: (menu: MenuRequest) => void;
}) {
  const theme = useTheme();
  const account = accountById(chat.account);
  const tabId = useBrowser((s) => activeTabId(s, windowId));
  const tab = useBrowser((s) => (tabId ? s.tabs[tabId] : undefined));
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (chat.open) input.current?.focus();
  }, [chat.open]);

  const page = tab?.url ? tab : undefined;
  let host = "";
  try {
    host = page ? new URL(page.url).hostname : "";
  } catch {
    host = "";
  }
  const isFileTab = !!page && page.url.startsWith("file:");
  const ready = !!text.trim();

  const send = () => {
    const value = text;
    setText("");
    void sendMessage(windowId, value);
  };

  const attach = () =>
    onOpenMenu({
      placement: { bottom: COMPOSER_MENU_BOTTOM, left: 10 },
      sections: [
        {
          title: "Attach",
          items: [
            { id: "pick", label: "Pick element", icon: <DropdownSymbol name="scope" />, detail: "Click it on the page" },
            { id: "selection", label: "Text selection", icon: <DropdownSymbol name="text.quote" />, detail: "From this page" },
            { id: "file", label: "Local file", icon: <DropdownSymbol name="doc.text" />, detail: "To read or edit" },
          ],
        },
      ],
      onSelect: (id) => void runAttach(id),
    });

  const runAttach = async (choice: string) => {
    if (choice === "pick") {
      if (picking || !tabId) return;
      setPicking(true);
      const pick = await pickElement(tabId);
      setPicking(false);
      if (pick) attachPick(windowId, pick);
      input.current?.focus();
    } else if (choice === "file") {
      const result = await chooseWorkingFile();
      if (result && "error" in result) systemNote(windowId, result.error);
      else if (result) setWorkingFile(windowId, result);
    } else if (choice === "selection" && tabId) {
      const selected = await readSelection(tabId);
      if (selected) attachSelection(windowId, { text: selected, elementPath: "" });
      else systemNote(windowId, "Nothing is selected on the page.");
    }
  };

  const chips = (
    <>
      {page && chat.pageAttached && (
        <View style={{ height: 26, borderRadius: 10, paddingLeft: 7, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover, maxWidth: "100%" }}>
          <Favicon url={page.url} favicon={page.favicon} size={13} />
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 150 }}>
            {page.customTitle || page.title || host}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary, maxWidth: 90 }}>
            {host}
          </Text>
          <IconButton icon="xmark" size={9} box={18} tooltip="Detach page" onPress={() => setPageAttached(windowId, false)} />
        </View>
      )}
      {page && !chat.pageAttached && <ChipButton label="Attach page" onPress={() => setPageAttached(windowId, true)} />}
      {!page && !chat.workingFile && (
        <ChipButton
          label="Select a local file…"
          onPress={() => void chooseWorkingFile().then((r) => (r && "error" in r ? systemNote(windowId, r.error) : r ? setWorkingFile(windowId, r) : undefined))}
        />
      )}
      {isFileTab && page && chat.workingFile?.url !== page.url && (
        <ChipButton
          label={`Use ${fileNameOf(page.url)} as working file`}
          onPress={() => void loadWorkingFile(page.url).then((r) => ("error" in r ? systemNote(windowId, r.error) : setWorkingFile(windowId, r)))}
        />
      )}
      {chat.workingFile && (
        <View style={{ height: 26, borderRadius: 10, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
          <Symbol name="doc.text" size={11} color={theme.icon} style={{ width: 13, height: 13 }} />
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 170 }}>
            {chat.workingFile.name}
          </Text>
          <IconButton icon="xmark" size={9} box={18} tooltip="Remove working file" onPress={() => setWorkingFile(windowId, null)} />
        </View>
      )}
      {chat.inspected && (
        <Pressable onPress={() => tabId && chat.inspected && flashElement(tabId, chat.inspected)}>
          <View style={{ height: 26, borderRadius: 10, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowSelected }}>
            <Symbol name="cursorarrow.rays" size={11} color={theme.textPrimary} style={{ width: 13, height: 13 }} />
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 170 }}>
              {chat.inspected.element}
            </Text>
            <IconButton icon="xmark" size={9} box={18} tooltip="Don't attach this element" onPress={() => setInspected(windowId, null)} />
          </View>
        </Pressable>
      )}
      {changesPending(chat) && (
        <Pressable
          onPress={() =>
            onOpenMenu({
              placement: { bottom: COMPOSER_MENU_BOTTOM, left: 10 },
              sections: [{ title: `${chat.changes.count} ${chat.changes.count === 1 ? "change" : "changes"} in Style`, items: chat.changes.items.slice(0, 12).map((item, i) => ({ id: String(i), label: item, icon: <DropdownSymbol name="paintbrush" /> })) }],
              onSelect: () => setChatTab(windowId, "style"),
            })
          }
        >
          <View style={{ height: 26, borderRadius: 10, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowSelected }}>
            <Symbol name="paintbrush" size={11} color={theme.textPrimary} style={{ width: 13, height: 13 }} />
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>
              {chat.changes.count} {chat.changes.count === 1 ? "change" : "changes"}
            </Text>
            <IconButton icon="xmark" size={9} box={18} tooltip="Don't send these changes" onPress={() => excludePageChanges(windowId)} />
          </View>
        </Pressable>
      )}
      {chat.inspector === "unavailable" && !chat.inspected && (
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.textTertiary }}>
          Start the InterfaceKit bridge to inspect this page
        </Text>
      )}
      {chat.picks.map((pick, i) => (
        <View key={i} style={{ height: 26, borderRadius: 10, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
          <Symbol name="scope" size={10} color={theme.icon} style={{ width: 12, height: 12 }} />
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, maxWidth: 170 }}>
            {pick.element}
          </Text>
          <IconButton icon="xmark" size={9} box={18} tooltip="Remove element" onPress={() => removePick(windowId, i)} />
        </View>
      ))}
      {chat.selection && (
        <View style={{ height: 26, borderRadius: 10, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, maxWidth: 170 }}>
            “{chat.selection.text.slice(0, 40)}”
          </Text>
          <IconButton icon="xmark" size={9} box={18} tooltip="Remove selection" onPress={() => clearSelection(windowId)} />
        </View>
      )}
    </>
  );

  return (
    <View style={{ padding: 10 }}>
      <View>
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={COMPOSER_RADIUS} shadowColor="#000000" shadowOpacity={theme.dark ? 0.18 : 0.07} shadowRadius={1} shadowOffset={[0, 1]} />
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={COMPOSER_RADIUS} shadowColor="#000000" shadowOpacity={theme.dark ? 0.18 : 0.06} shadowRadius={6} shadowOffset={[0, 6]} />
        <Surface
          fill={hex(focused ? theme.composerFocus : theme.ntpBarSolid)}
          cornerRadius={COMPOSER_RADIUS}
          borderColor={hex(focused ? theme.composerFocusBorder : theme.ntpBarBorder)}
          borderWidth={1}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", paddingHorizontal: 10, paddingTop: 10 }}>{chips}</View>
          <TextInput
            ref={input}
            multiline
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            enableFocusRing={false}
            placeholder={picking ? "Click an element on the page…" : `Message ${account.name}…`}
            placeholderTextColor={theme.placeholder}
            selectionColor={theme.selection}
            style={{
              minHeight: 44,
              maxHeight: 160,
              paddingHorizontal: 14,
              paddingTop: 10,
              paddingBottom: 4,
              fontSize: 14,
              lineHeight: 20,
              color: theme.textPrimary,
              textAlignVertical: "top",
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 8, paddingTop: 2 }}>
            <IconButton icon="plus" size={14} box={SEND_SIZE} radius={SEND_SIZE / 2} tooltip="Attach" onPress={attach} />
            <View style={{ flex: 1 }} />
            <ModelPicker chat={chat} onOpen={onOpenModels} />
            <Pressable onPress={send} disabled={!ready} accessibilityRole="button" accessibilityLabel="Send message">
              {({ pressed }) => (
                <View
                  style={{
                    width: SEND_SIZE,
                    height: SEND_SIZE,
                    borderRadius: SEND_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: ready ? theme.heroGo : theme.heroGoIdle,
                    opacity: pressed ? 0.85 : 1,
                  }}
                >
                  <Symbol name="arrow.up" size={13} weight="bold" color={theme.heroGoText} style={{ width: 16, height: 16 }} />
                </View>
              )}
            </Pressable>
          </View>
        </Surface>
      </View>
    </View>
  );
}

function ChipButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={{ height: 26, borderRadius: 10, paddingHorizontal: 9, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : theme.rowHover }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 240 }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
