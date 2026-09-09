import { useEffect, useState } from "react";

import { api } from "@/src/api/client";

/**
 * True only when the current user is the household owner AND there is at least
 * one other granted member — i.e. there's actually someone to hide sheets from.
 * Used to decide whether to surface per-sheet access controls.
 */
export function useCanManageAccess(): boolean {
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .get<{ is_owner: boolean; members: { is_owner: boolean; team_access: boolean }[]; collaborators?: unknown[] }>("/team-access")
      .then((r) => {
        if (!active) return;
        const grantedMembers = (r.data.members || []).filter((m) => !m.is_owner && m.team_access).length;
        const collaborators = (r.data.collaborators || []).length;
        setCanManage(!!r.data.is_owner && grantedMembers + collaborators > 0);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return canManage;
}
