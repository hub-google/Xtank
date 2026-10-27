
CREATE OR REPLACE FUNCTION public.xtank_save_loadout(p_tank_id text,p_name text,p_slots jsonb,p_loadout_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); saved uuid; v jsonb; type_name text; number_value int; ref text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN RAISE EXCEPTION 'PLAYER_INACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.player_tanks WHERE player_id=me AND tank_id=p_tank_id) THEN RAISE EXCEPTION 'TANK_NOT_OWNED'; END IF;
 IF length(coalesce(p_name,'')) NOT BETWEEN 1 AND 40 OR jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots)>14 THEN RAISE EXCEPTION 'INVALID_LOADOUT'; END IF;
 IF p_loadout_id IS NULL THEN
  INSERT INTO xtank.loadouts(player_id,tank_id,name) VALUES(me,p_tank_id,p_name) RETURNING loadout_id INTO saved;
 ELSE
  UPDATE xtank.loadouts SET name=p_name,updated_at=now() WHERE loadout_id=p_loadout_id AND player_id=me AND tank_id=p_tank_id RETURNING loadout_id INTO saved;
  IF saved IS NULL THEN RAISE EXCEPTION 'LOADOUT_NOT_FOUND'; END IF;
 END IF;
 DELETE FROM xtank.loadout_slots WHERE loadout_id=saved;
 FOR v IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
  type_name:=v->>'slot_type';number_value:=(v->>'slot_number')::int;ref:=v->>'ref';
  IF number_value NOT BETWEEN 1 AND 7 OR type_name NOT IN ('weapon','item') THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
  IF type_name='weapon' THEN
   IF NOT EXISTS(SELECT 1 FROM xtank.weapon_defs WHERE weapon_id=ref AND enabled) THEN RAISE EXCEPTION 'WEAPON_INVALID'; END IF;
   IF ref NOT IN('hurricane','death_knight','vulcan','plasma')
     AND NOT EXISTS(SELECT 1 FROM xtank.player_inventory WHERE player_id=me AND weapon_id=ref AND quantity>0) THEN RAISE EXCEPTION 'WEAPON_NOT_OWNED'; END IF;
   INSERT INTO xtank.loadout_slots(loadout_id,slot_type,slot_number,weapon_id) VALUES(saved,type_name,number_value,ref);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM xtank.player_inventory WHERE player_id=me AND item_id=ref AND quantity>0) THEN RAISE EXCEPTION 'ITEM_NOT_OWNED'; END IF;
   INSERT INTO xtank.loadout_slots(loadout_id,slot_type,slot_number,item_id) VALUES(saved,type_name,number_value,ref);
  END IF;
 END LOOP;
 UPDATE xtank.loadouts SET is_selected=false WHERE player_id=me AND tank_id=p_tank_id;
 UPDATE xtank.loadouts SET is_selected=true WHERE loadout_id=saved;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.xtank_save_loadout(text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_save_loadout(text,text,jsonb,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.xtank_social_api(p_action text,p_target uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid();
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('friends',(SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',f.player_id,'friend_id',f.friend_id,'status',f.status,'friend_name',(SELECT display_name FROM xtank.players WHERE player_id=CASE WHEN f.player_id=me THEN f.friend_id ELSE f.player_id END))), '[]'::jsonb) FROM xtank.friends f WHERE f.player_id=me OR f.friend_id=me));
 END IF;
 IF p_target IS NULL OR p_target=me THEN RAISE EXCEPTION 'INVALID_FRIEND'; END IF;
 IF p_action='invite' THEN
  IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=p_target AND account_status='active') THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM xtank.player_blocks WHERE (player_id=me AND blocked_player_id=p_target) OR (player_id=p_target AND blocked_player_id=me)) THEN RAISE EXCEPTION 'PLAYER_BLOCKED'; END IF;
  INSERT INTO xtank.friends(player_id,friend_id,status) VALUES(me,p_target,'pending') ON CONFLICT(player_id,friend_id) DO NOTHING;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='accept' THEN
  UPDATE xtank.friends SET status='accepted',accepted_at=now() WHERE player_id=p_target AND friend_id=me AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='block' THEN
  INSERT INTO xtank.player_blocks(player_id,blocked_player_id) VALUES(me,p_target) ON CONFLICT DO NOTHING;
  DELETE FROM xtank.friends WHERE (player_id=me AND friend_id=p_target) OR (player_id=p_target AND friend_id=me);
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'INVALID_ACTION';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_social_api(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_social_api(text,uuid) TO authenticated;
