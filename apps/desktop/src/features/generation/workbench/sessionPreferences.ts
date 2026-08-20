import { LOCAL_STORAGE_PREFIX } from "@shared/constants";
import {
  readPinnedSessionIds,
  readUnreadSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  SESSION_UNREAD_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
} from "@musefold/product-ui";

// Keep this compatibility entrypoint tied to the versioned Desktop namespace.
void LOCAL_STORAGE_PREFIX;

export {
  readPinnedSessionIds,
  readUnreadSessionIds,
  SESSION_PINS_CHANGED_EVENT,
  SESSION_UNREAD_CHANGED_EVENT,
  setSessionPinned,
  setSessionUnread,
};
