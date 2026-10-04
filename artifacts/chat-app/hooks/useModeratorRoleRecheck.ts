import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ROLE_RECHECK_INTERVAL_MS } from "@/constants/moderation";
import { useApp } from "@/contexts/AppContext";

/**
 * Keeps a screen that gates on the account's moderator role following the
 * role the server currently reports, rather than the one read when the app
 * started.
 *
 * A grant or a revocation is pushed down the chat connection the app already
 * holds and applied the moment it lands, so moderator controls normally
 * appear or disappear on their own. This re-read is the safety net under
 * that, for a change the connection missed: the role is read as the screen
 * comes into view, and rarely while it stays there. Both stop as soon as the
 * screen is left.
 *
 * Every screen that gates on the role shares this one hook, so the profile
 * screen and the room screen cannot drift into re-checking on different
 * terms.
 */
export function useModeratorRoleRecheck(): void {
  const { refreshAdminAccess } = useApp();

  useFocusEffect(
    useCallback(() => {
      void refreshAdminAccess();
      const recheck = setInterval(() => {
        void refreshAdminAccess();
      }, ROLE_RECHECK_INTERVAL_MS);
      return () => clearInterval(recheck);
    }, [refreshAdminAccess]),
  );
}
