import { WebView, type WebViewHandle } from "@ardia/ardiacore";
import { showMenu, Symbol } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { openFromPage, pageProfileId } from "../layout/openFromPage";
import { pageProfile } from "../extensions/store";
import { Favicon, IconButton } from "../primitives";
import { accountById, CHAT_ACCOUNTS, registerAccountWebView, type ChatAccount } from "./accounts";
import { diffCounts, lineDiff } from "./diff";
import { chooseWorkingFile, fileNameOf, loadWorkingFile } from "./files";
import { flashElement, pickElement, readSelection } from "./pickElement";
import {
  applyProposedEdit,
  attachPick,
  attachSelection,
  clearSelection,
  closeChatPanel,
  markConnected,
  newThread,
  pullProposedEdit,
  removePick,
  sendMessage,
  setAccount,
  setPageAttached,
  setProposedEdit,
  setViewingSession,
  setWorkingFile,
  systemNote,
  useChat,
  type ChatMessage,
  type WindowChat,
} from "./state";

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const HEADER = 40;
const DEFAULT_WIDTH = 380;

function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > MAX_WIDTH) return MAX_WIDTH + band(width - MAX_WIDTH);
  if (width < MIN_WIDTH) return MIN_WIDTH - band(MIN_WIDTH - width);
  return width;
}
const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

const EMPTY_CHAT: WindowChat = {
  open: false,
  account: "claude",
  connected: {},
  messages: [],
  pageAttached: true,
  picks: [],
  selection: null,
  workingFile: null,
  proposedEdit: null,
  viewingSession: false,
};

export function ChatPanel() {
  const windowId = useWindowId();
  const chat = useChat((s) => s.windows[windowId]);
  const savedWidth = useBrowser((s) => s.settings.chatPanelWidth ?? DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  const open = !!chat?.open;

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
  const showSession = chat.viewingSession || !connected;
  return (
    <View style={{ flex: 1, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <View style={{ height: HEADER, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 5, gap: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          Chat
        </Text>
        <AccountPicker windowId={windowId} chat={chat} />
        <View style={{ flex: 1 }} />
        <IconButton icon="plus" size={13} tooltip="New Thread" onPress={() => newThread(windowId)} />
        <IconButton icon="xmark" size={12} weight="medium" tooltip="Close Chat" onPress={() => closeChatPanel(windowId)} />
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }} />
      {showSession ? (
        <SessionView windowId={windowId} account={account} connected={connected} />
      ) : (
        <>
          <ThreadView windowId={windowId} chat={chat} />
          <Composer windowId={windowId} chat={chat} />
        </>
      )}
    </View>
  );
}

function AccountPicker({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const account = accountById(chat.account);
  const connected = !!chat.connected[chat.account];
  const open = async () => {
    const choice = await showMenu([
      ...CHAT_ACCOUNTS.map((a) => ({
        id: `account:${a.id}`,
        title: `${a.name} (${a.service})${chat.connected[a.id] ? " — connected" : ""}`,
        checked: a.id === chat.account,
      })),
      { separator: true as const },
      { id: "session", title: chat.viewingSession ? "Show Thread" : "Show Session" },
      { id: "new", title: "New Thread" },
    ]);
    if (!choice) return;
    if (choice.startsWith("account:")) setAccount(windowId, choice.slice("account:".length) as ChatAccount["id"]);
    else if (choice === "session") setViewingSession(windowId, !chat.viewingSession);
    else if (choice === "new") newThread(windowId);
  };
  return (
    <Pressable onPress={() => void open()}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 7,
            backgroundColor: pressed ? theme.toolbarPressed : theme.rowHover,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: connected ? "#3EB489" : theme.iconDisabled }} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{account.name}</Text>
          <Symbol name="chevron.down" size={8} weight="bold" color={theme.icon} style={{ width: 10, height: 10 }} />
        </View>
      )}
    </Pressable>
  );
}

function SessionView({ windowId, account, connected }: { windowId: string; account: ChatAccount; connected: boolean }) {
  const theme = useTheme();
  const profile = useBrowser((s) => pageProfile(s, windowId));
  return (
    <View style={{ flex: 1 }}>
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
      {!connected && (
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
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, gap: 12 }}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {chat.messages.length === 0 && (
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: theme.textSecondary }}>
          Messages you send go to the connected account with the page, picked elements and working file attached as context. Replies appear in the
          account's session — open it from the account menu.
        </Text>
      )}
      {chat.messages.map((message) => (
        <MessageRow key={message.id} windowId={windowId} message={message} />
      ))}
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
};

function MessageRow({ windowId, message }: { windowId: string; message: ChatMessage }) {
  const theme = useTheme();
  const tabId = useBrowser((s) => activeTabId(s, windowId));
  if (message.role === "system") {
    return (
      <Text style={{ fontSize: 11.5, lineHeight: 16, color: theme.textTertiary, textAlign: "center", paddingHorizontal: 12 }}>{message.text}</Text>
    );
  }
  const account = message.account ? accountById(message.account) : null;
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>{account ? `You → ${account.name}` : "You"}</Text>
        {message.delivery && (
          <Text style={{ fontSize: 11, color: theme.textTertiary }}>{DELIVERY_LABEL[message.delivery] ?? message.delivery}</Text>
        )}
      </View>
      <Text selectable style={{ fontSize: 13, lineHeight: 18, color: theme.textPrimary }}>
        {message.text}
      </Text>
      {message.page && (
        <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textTertiary }}>
          Page: {message.page.title} ({message.page.host || message.page.url})
        </Text>
      )}
      {message.fileName && (
        <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textTertiary }}>
          File: {message.fileName}
        </Text>
      )}
      {message.picks?.map((pick, i) => (
        <Pressable key={i} onPress={() => tabId && flashElement(tabId, pick)}>
          <View style={{ borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: theme.rowHover, gap: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>
              {pick.element}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.textTertiary }}>
              {pick.elementPath}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
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

function Composer({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const account = accountById(chat.account);
  const tabId = useBrowser((s) => activeTabId(s, windowId));
  const tab = useBrowser((s) => (tabId ? s.tabs[tabId] : undefined));
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
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

  const send = () => {
    const value = text;
    setText("");
    void sendMessage(windowId, value);
  };

  const attach = async () => {
    const choice = await showMenu([
      { id: "pick", title: picking ? "Cancel Picking" : "Pick Element…" },
      { id: "file", title: "Local File…" },
      { id: "selection", title: "Attach Selection" },
    ]);
    if (choice === "pick") {
      if (picking || !tabId) return;
      setPicking(true);
      const pick = await pickElement(tabId);
      setPicking(false);
      if (pick) attachPick(windowId, pick);
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

  return (
    <View style={{ padding: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {page && chat.pageAttached && (
          <View style={{ height: 26, borderRadius: 8, paddingLeft: 7, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowSelected, maxWidth: "100%" }}>
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
        {page && !chat.pageAttached && (
          <ChipButton label="Attach page" onPress={() => setPageAttached(windowId, true)} />
        )}
        {!page && !chat.workingFile && <ChipButton label="Select a local file…" onPress={() => void chooseWorkingFile().then((r) => (r && "error" in r ? systemNote(windowId, r.error) : r ? setWorkingFile(windowId, r) : undefined))} />}
        {isFileTab && page && chat.workingFile?.url !== page.url && (
          <ChipButton
            label={`Use ${fileNameOf(page.url)} as working file`}
            onPress={() =>
              void loadWorkingFile(page.url).then((r) => ("error" in r ? systemNote(windowId, r.error) : setWorkingFile(windowId, r)))
            }
          />
        )}
        {chat.workingFile && (
          <View style={{ height: 26, borderRadius: 8, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
            <Symbol name="doc.text" size={11} color={theme.icon} style={{ width: 13, height: 13 }} />
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 170 }}>
              {chat.workingFile.name}
            </Text>
            <IconButton icon="xmark" size={9} box={18} tooltip="Remove working file" onPress={() => setWorkingFile(windowId, null)} />
          </View>
        )}
        {chat.picks.map((pick, i) => (
          <View key={i} style={{ height: 26, borderRadius: 8, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, maxWidth: 170 }}>
              {pick.element}
            </Text>
            <IconButton icon="xmark" size={9} box={18} tooltip="Remove element" onPress={() => removePick(windowId, i)} />
          </View>
        ))}
        {chat.selection && (
          <View style={{ height: 26, borderRadius: 8, paddingLeft: 8, paddingRight: 4, gap: 6, flexDirection: "row", alignItems: "center", backgroundColor: theme.rowHover }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, maxWidth: 170 }}>
              “{chat.selection.text.slice(0, 40)}”
            </Text>
            <IconButton icon="xmark" size={9} box={18} tooltip="Remove selection" onPress={() => clearSelection(windowId)} />
          </View>
        )}
      </View>
      <View style={{ borderRadius: 10, backgroundColor: theme.rowHover, padding: 8, gap: 6 }}>
        <TextInput
          ref={input}
          multiline
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder={picking ? "Click an element on the page…" : `Message ${account.name}…`}
          placeholderTextColor={theme.textTertiary}
          style={{ minHeight: 38, maxHeight: 110, fontSize: 13, lineHeight: 17, color: theme.textPrimary, textAlignVertical: "top" }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <IconButton icon="plus" size={14} tooltip="Attach" onPress={() => void attach()} />
          <View style={{ flex: 1 }} />
          <Pressable onPress={send} disabled={!text.trim()}>
            {({ pressed }) => (
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: text.trim() ? theme.accent : theme.rowHover,
                  opacity: pressed ? 0.8 : 1,
                }}
              >
                <Symbol name="arrow.up" size={13} weight="bold" color={text.trim() ? "#FFFFFF" : theme.iconDisabled} style={{ width: 28, height: 28 }} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ChipButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={{ height: 26, borderRadius: 8, paddingHorizontal: 9, justifyContent: "center", backgroundColor: pressed ? theme.toolbarPressed : theme.rowHover }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, maxWidth: 240 }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
