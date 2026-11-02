type CloseGuard = (windowId: string, groupId: string) => Promise<boolean>;

let guard: CloseGuard = async () => true;

export const guardGroupClose = (check: CloseGuard) => void (guard = check);

export const groupCloseAllowed = (windowId: string, groupId: string) => guard(windowId, groupId);
