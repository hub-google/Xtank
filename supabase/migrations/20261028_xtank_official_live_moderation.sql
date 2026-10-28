-- Limit service-role moderation checks to 512 current official players.
CREATE OR REPLACE FUNCTION public.xtank_official_online_moderation(p_player_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_suspended jsonb;v_muted jsonb;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF p_player_ids IS NULL OR cardinality(p_player_ids)>512 THEN RAISE EXCEPTION 'INVALID_PLAYER_IDS'; END IF;
 SELECT coalesce(jsonb_agg(p.player_id::text),'[]'::jsonb) INTO v_suspended
 FROM xtank.players p WHERE p.player_id=ANY(p_player_ids) AND p.account_status<>'active';
 SELECT coalesce(jsonb_object_agg(m.player_id::text,m.muted_until),'{}'::jsonb) INTO v_muted
 FROM xtank.chat_restrictions m WHERE m.player_id=ANY(p_player_ids) AND m.muted_until>now();
 RETURN jsonb_build_object('suspended',v_suspended,'muted',v_muted);
END $$;
REVOKE ALL ON FUNCTION public.xtank_official_online_moderation(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_official_online_moderation(uuid[]) TO service_role;