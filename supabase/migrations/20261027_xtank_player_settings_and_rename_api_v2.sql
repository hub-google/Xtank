
CREATE OR REPLACE FUNCTION public.xtank_player_api(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid := auth.uid(); v_name text; v_offer uuid; v_order uuid; v_tank text; v_attr text; v_points int;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>8192 THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action='initialize' THEN
  v_name:=nullif(trim(p_payload->>'name'),'');
  IF v_name IS NULL THEN v_name:='Player-'||left(replace(v_user::text,'-',''),8); END IF;
  PERFORM xtank.provision_player(v_user,v_name);
  RETURN jsonb_build_object('ok',true,'player_id',v_user);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players p WHERE p.player_id=v_user AND p.account_status='active') THEN RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE'; END IF;
 IF p_action='dashboard' THEN
  RETURN jsonb_build_object(
   'profile',(SELECT jsonb_build_object('player_id',player_id,'display_name',display_name,'avatar_key',avatar_key) FROM xtank.players WHERE player_id=v_user),
   'progress',(SELECT to_jsonb(x) FROM xtank.player_progress x WHERE player_id=v_user),
   'stats',(SELECT to_jsonb(x) FROM xtank.player_stats x WHERE player_id=v_user),
   'settings',(SELECT to_jsonb(x) FROM xtank.player_settings x WHERE player_id=v_user),
   'wallet',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.wallet_balances x WHERE player_id=v_user),
   'tanks',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.player_tanks x WHERE player_id=v_user),
   'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.player_inventory x WHERE player_id=v_user),
   'upgrades',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.tank_upgrades x WHERE player_id=v_user),
   'loadouts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.loadouts x WHERE player_id=v_user),
   'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM xtank.loadout_slots s JOIN xtank.loadouts l USING(loadout_id) WHERE l.player_id=v_user),
   'history',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (SELECT m.match_id,m.mode_id,m.map_id,m.ended_at,mp.kills,mp.deaths,mp.is_winner FROM xtank.match_participants mp JOIN xtank.matches m ON m.match_id=mp.match_id WHERE mp.player_id=v_user ORDER BY m.started_at DESC LIMIT 20) x));
 ELSIF p_action='catalog' THEN
  RETURN jsonb_build_object(
   'tanks',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.tank_defs x WHERE enabled),
   'weapons',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.weapon_defs x WHERE enabled),
   'items',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.item_defs x WHERE enabled),
   'offers',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM xtank.shop_offers x WHERE enabled AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())));
 ELSIF p_action='buy' THEN
  v_offer:=(p_payload->>'offer_id')::uuid;
  IF v_offer IS NULL OR length(coalesce(p_payload->>'key',''))<16 THEN RAISE EXCEPTION 'INVALID_ORDER'; END IF;
  v_order:=xtank.buy_offer(v_user,v_offer,coalesce((p_payload->>'quantity')::int,1),p_payload->>'key');
  RETURN jsonb_build_object('ok',true,'order_id',v_order);
 ELSIF p_action='upgrade' THEN
  v_tank:=p_payload->>'tank_id';v_attr:=p_payload->>'attribute';
  IF v_attr NOT IN ('speed','attack','defense','energy','collision') THEN RAISE EXCEPTION 'INVALID_ATTRIBUTE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM xtank.player_tanks WHERE player_id=v_user AND tank_id=v_tank) THEN RAISE EXCEPTION 'TANK_NOT_OWNED'; END IF;
  SELECT unspent_points INTO v_points FROM xtank.player_progress WHERE player_id=v_user FOR UPDATE;
  IF v_points IS NULL OR v_points<=0 THEN RAISE EXCEPTION 'NO_POINTS'; END IF;
  INSERT INTO xtank.tank_upgrades(player_id,tank_id,attribute,level) VALUES(v_user,v_tank,v_attr,0) ON CONFLICT DO NOTHING;
  UPDATE xtank.tank_upgrades SET level=level+1,updated_at=now() WHERE player_id=v_user AND tank_id=v_tank AND attribute=v_attr AND level<10;
  IF NOT FOUND THEN RAISE EXCEPTION 'MAX_LEVEL'; END IF;
  UPDATE xtank.player_progress SET unspent_points=unspent_points-1,updated_at=now() WHERE player_id=v_user;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='rename' THEN
  v_name:=trim(coalesce(p_payload->>'name',''));
  IF length(v_name) NOT BETWEEN 3 AND 24 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  UPDATE xtank.players SET display_name=v_name,updated_at=now() WHERE player_id=v_user;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='settings' THEN
  UPDATE xtank.player_settings SET
   master_volume=coalesce((p_payload->>'master_volume')::numeric,master_volume),
   music_volume=coalesce((p_payload->>'music_volume')::numeric,music_volume),
   sfx_volume=coalesce((p_payload->>'sfx_volume')::numeric,sfx_volume),
   mouse_sensitivity=coalesce((p_payload->>'mouse_sensitivity')::numeric,mouse_sensitivity),
   camera_mode=coalesce((p_payload->>'camera_mode')::smallint,camera_mode),
   graphics_quality=coalesce(nullif(p_payload->>'graphics_quality',''),graphics_quality),
   updated_at=now() WHERE player_id=v_user;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='leaderboard' THEN
  RETURN jsonb_build_object('players',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
  (SELECT p.display_name,s.matches_played,s.wins,s.kills,s.deaths,r.level FROM xtank.player_stats s JOIN xtank.players p USING(player_id)
    JOIN xtank.player_progress r USING(player_id) WHERE p.account_status='active' ORDER BY s.wins DESC,s.kills DESC LIMIT 50) x));
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_player_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_player_api(text,jsonb) TO authenticated;
