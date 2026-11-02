import { useProfile } from "../../state/browser/hooks";
import { chooseProfileIcon, closeProfileIconPicker, useProfileIconPicker, type ProfileIconPicker as Picker } from "../../state/profiles/iconPicker";
import { IconPickerLayer, nearAnchor } from "../iconPicker/IconPickerPanel";
import { PROFILE_SYMBOLS } from "./ProfileIcons";

export function ProfileIconPicker({ windowId }: { windowId: string }) {
  const picker = useProfileIconPicker((s) => (s.picker?.windowId === windowId ? s.picker : null));
  return picker ? <PickerFor key={picker.profileId} picker={picker} /> : null;
}

function PickerFor({ picker }: { picker: Picker }) {
  const current = useProfile(picker.profileId, (p) => (p ? p.icon : undefined));
  if (current === undefined) return null;
  return (
    <IconPickerLayer
      current={current}
      symbols={PROFILE_SYMBOLS}
      actions={[
        {
          title: picker.place === "sidebar" ? "No Icon" : "Initial",
          icon: picker.place === "sidebar" ? "circle.fill" : "textformat",
          primary: !current,
          onPress: () => chooseProfileIcon(picker, null),
        },
      ]}
      onChoose={(icon) => chooseProfileIcon(picker, icon)}
      onClose={closeProfileIconPicker}
      placeIn={nearAnchor(picker.anchor)}
    />
  );
}
