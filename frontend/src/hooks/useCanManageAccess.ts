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
      .get<{ is_owner: boolean; members: { is_owner: boolean; team_access: boolean }[] }>("/team-access")
      .then((r) => {
        if (!active) return;
        const others = (r.data.members || []).filter((m) => !m.is_owner && m.team_access).length;
        setCanManage(!!r.data.is_owner && others > 0);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return canManage;
}
