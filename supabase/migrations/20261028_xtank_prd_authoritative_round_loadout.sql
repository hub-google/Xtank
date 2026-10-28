-- PRD U2/S06/S11: authoritative one-call loadout snapshot immediately before escrow.
-- Do not reuse the profile captured when the player joined a lobby.
CREATE OR REPLACE FUNCTION public.xtank_official_loadout_snapshot(p_player_id uuid,p_tank_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_loadout uuid;
 v_weapons jsonb;
 v_items jsonb;
 v_upgrades jsonb;
 v_weapon text;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
  AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'SERVER_ONLY';
 END IF;
 IF p_player_id IS NULL OR p_tank_id IS NULL OR length(p_tank_id)>12
 THEN RAISE EXCEPTION 'INVALID_PLAYER_OR_TANK'; END IF;
 PERFORM 1 FROM xtank.players WHERE player_id=p_player_id AND account_status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.player_tanks WHERE player_id=p_player_id AND tank_id=p_tank_id)
 THEN RAISE EXCEPTION 'TANK_NOT_OWNED'; END IF;
 SELECT l.loadout_id INTO v_loadout FROM xtank.loadouts l
 WHERE l.player_id=p_player_id AND l.tank_id=p_tank_id AND l.is_selected
 ORDER BY l.updated_at DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(s.weapon_id ORDER BY s.slot_number),'[]'::jsonb)
 INTO v_weapons
 FROM xtank.loadout_slots s
 WHERE s.loadout_id=v_loadout AND s.slot_type='weapon' AND s.weapon_id IS NOT NULL;
 IF v_weapons='[]'::jsonb THEN v_weapons:='["hurricane"]'::jsonb; END IF;
 FOR v_weapon IN SELECT value FROM jsonb_array_elements_text(v_weapons) LOOP
  IF v_weapon NOT IN ('hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine')
   OR (v_weapon NOT IN ('hurricane','death_knight','vulcan','plasma')
     AND NOT EXISTS(SELECT 1 FROM xtank.player_inventory i
       WHERE i.player_id=p_player_id AND i.weapon_id=v_weapon AND i.quantity>0))
  THEN RAISE EXCEPTION 'LOADOUT_WEAPON_NOT_OWNED'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_object_agg(x.item_id,x.quantity),'{}'::jsonb)
 INTO v_items FROM (
  SELECT i.item_id,least(sum(i.quantity),30)::integer AS quantity
  FROM xtank.player_inventory i
  WHERE i.player_id=p_player_id AND i.quantity>0
   AND i.item_id IN (
    SELECT s.item_id FROM xtank.loadout_slots s
    WHERE s.loadout_id=v_loadout AND s.slot_type='item'
      AND s.item_id IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
   ) GROUP BY i.item_id
 ) x;
 SELECT coalesce(jsonb_object_agg(x.attribute,x.level),'{}'::jsonb)
 INTO v_upgrades FROM (
  SELECT u.attribute,least(10,greatest(0,u.level))::integer AS level
  FROM xtank.tank_upgrades u
  WHERE u.player_id=p_player_id AND u.tank_id=p_tank_id
    AND u.attribute IN ('speed','attack','defense','energy','collision')
 ) x;
 RETURN jsonb_build_object('weapons',v_weapons,'items',v_items,'upgrades',v_upgrades);
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_official_loadout_snapshot(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_official_loadout_snapshot(uuid,text) TO service_role;
