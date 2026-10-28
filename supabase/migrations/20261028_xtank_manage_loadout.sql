-- The only supported actions are select and delete, always scoped to the current player.
CREATE OR REPLACE FUNCTION public.xtank_manage_loadout(p_action text,p_loadout_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); v_tank text; v_selected boolean; successor uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active')
   THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 IF p_action NOT IN ('select','delete') OR p_loadout_id IS NULL
   THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
 SELECT tank_id,is_selected INTO v_tank,v_selected
 FROM xtank.loadouts WHERE player_id=me AND loadout_id=p_loadout_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'LOADOUT_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(me::text||':'||v_tank,0));
 -- A concurrent request might have deleted or moved the selected record.
 SELECT tank_id,is_selected INTO v_tank,v_selected
 FROM xtank.loadouts WHERE player_id=me AND loadout_id=p_loadout_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LOADOUT_NOT_FOUND'; END IF;
 IF p_action='select' THEN
   UPDATE xtank.loadouts SET is_selected=false, updated_at=now()
   WHERE player_id=me AND tank_id=v_tank AND is_selected;
   UPDATE xtank.loadouts SET is_selected=true, updated_at=now()
   WHERE player_id=me AND loadout_id=p_loadout_id;
   RETURN jsonb_build_object('ok',true,'selected',p_loadout_id);
 END IF;
 DELETE FROM xtank.loadouts WHERE player_id=me AND loadout_id=p_loadout_id;
 IF v_selected THEN
   SELECT loadout_id INTO successor FROM xtank.loadouts
   WHERE player_id=me AND tank_id=v_tank
   ORDER BY updated_at DESC,loadout_id LIMIT 1;
   IF successor IS NOT NULL THEN
     UPDATE xtank.loadouts SET is_selected=true,updated_at=now()
     WHERE loadout_id=successor AND player_id=me;
   END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'deleted',p_loadout_id,'fallback_selected',successor);
END $$;
REVOKE ALL ON FUNCTION public.xtank_manage_loadout(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_manage_loadout(text,uuid) TO authenticated;