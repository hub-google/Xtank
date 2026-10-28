-- Always snapshot current selected inventory just before official reservation,
-- not at login time: a player may complete a match without leaving the room.
CREATE OR REPLACE FUNCTION public.xtank_official_item_snapshot(
 p_player_id uuid,p_tank_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE active_loadout uuid; items jsonb;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF p_player_id IS NULL OR p_tank_id IS NULL OR length(p_tank_id)>12 THEN
  RAISE EXCEPTION 'INVALID_PLAYER_OR_TANK'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=p_player_id AND account_status='active')
 THEN RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.player_tanks WHERE player_id=p_player_id AND tank_id=p_tank_id)
 THEN RAISE EXCEPTION 'TANK_NOT_OWNED'; END IF;
 SELECT l.loadout_id INTO active_loadout FROM xtank.loadouts l
 WHERE l.player_id=p_player_id AND l.tank_id=p_tank_id AND l.is_selected
 ORDER BY l.updated_at DESC LIMIT 1;
 SELECT coalesce(jsonb_object_agg(s.item_id,s.quantity),'{}'::jsonb) INTO items FROM (
   SELECT i.item_id,least(sum(i.quantity),30)::integer AS quantity
   FROM xtank.player_inventory i
   WHERE i.player_id=p_player_id AND i.item_id IN (
     SELECT ls.item_id FROM xtank.loadout_slots ls
     WHERE ls.loadout_id=active_loadout AND ls.slot_type='item'
     AND ls.item_id IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
   ) AND i.quantity>0
   GROUP BY i.item_id
 ) s;
 RETURN jsonb_build_object('items',items);
END $$;
REVOKE ALL ON FUNCTION public.xtank_official_item_snapshot(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_official_item_snapshot(uuid,text) TO service_role;