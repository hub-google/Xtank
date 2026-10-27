
CREATE OR REPLACE FUNCTION public.xtank_clan_admin_api(
 p_action text,p_clan_id uuid,p_target uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); actor_role text; target_role text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_clan_id IS NULL THEN RAISE EXCEPTION 'CLAN_REQUIRED'; END IF;
 -- Serialize changes, preventing concurrent transfers or officer promotions.
 PERFORM 1 FROM xtank.clans WHERE clan_id=p_clan_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLAN_NOT_FOUND'; END IF;
 SELECT role INTO actor_role FROM xtank.clan_members
 WHERE clan_id=p_clan_id AND player_id=me;
 IF actor_role IS NULL OR actor_role='applicant' THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
 IF p_action='members' THEN
  RETURN jsonb_build_object('members',(
   SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',cm.player_id,
     'name',p.display_name,'role',cm.role) ORDER BY
     CASE cm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,p.display_name),'[]'::jsonb)
   FROM xtank.clan_members cm JOIN xtank.players p ON p.player_id=cm.player_id
   WHERE cm.clan_id=p_clan_id AND cm.role<>'applicant'));
 END IF;
 IF p_target IS NULL OR p_target=me THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
 SELECT role INTO target_role FROM xtank.clan_members
 WHERE clan_id=p_clan_id AND player_id=p_target FOR UPDATE;
 IF target_role IS NULL OR target_role='applicant' THEN RAISE EXCEPTION 'TARGET_NOT_A_MEMBER'; END IF;
 IF p_action='transfer' THEN
  IF actor_role<>'leader' OR target_role='leader' THEN RAISE EXCEPTION 'LEADER_ONLY'; END IF;
  UPDATE xtank.clan_members SET role='officer' WHERE clan_id=p_clan_id AND player_id=me;
  UPDATE xtank.clan_members SET role='leader' WHERE clan_id=p_clan_id AND player_id=p_target;
  UPDATE xtank.clans SET leader_id=p_target WHERE clan_id=p_clan_id;
 ELSIF p_action='promote' OR p_action='demote' THEN
  IF actor_role<>'leader' OR target_role='leader' THEN RAISE EXCEPTION 'LEADER_ONLY'; END IF;
  UPDATE xtank.clan_members SET role=CASE WHEN p_action='promote' THEN 'officer' ELSE 'member' END
   WHERE clan_id=p_clan_id AND player_id=p_target;
 ELSIF p_action='kick' THEN
  IF actor_role NOT IN ('leader','officer') OR target_role='leader' OR
     (actor_role='officer' AND target_role<>'member') THEN RAISE EXCEPTION 'INSUFFICIENT_ROLE'; END IF;
  DELETE FROM xtank.clan_members WHERE clan_id=p_clan_id AND player_id=p_target;
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.xtank_clan_admin_api(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_clan_admin_api(text,uuid,uuid) TO authenticated;
