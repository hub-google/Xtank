-- Durable, audited recovery of abandoned official consumable escrow.
CREATE OR REPLACE FUNCTION public.xtank_recover_abandoned_items(
 p_hours integer DEFAULT 72,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; processed integer:=0; affected_players integer:=0;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
   AND coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 IF p_hours NOT BETWEEN 72 AND 720 OR p_limit NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'INVALID_RECOVERY_WINDOW'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('xtank-escrow-recovery-v1',0))
 THEN RETURN jsonb_build_object('ok',true,'busy',true,'recovered_rounds',0); END IF;
 FOR candidate IN
   SELECT s.round_id,count(*) AS player_count FROM xtank.match_escrow_sessions s
   WHERE s.status='reserved' GROUP BY s.round_id
   HAVING max(s.updated_at)<now()-make_interval(hours=>p_hours)
     AND NOT EXISTS(SELECT 1 FROM xtank.matches m WHERE m.server_round_id=s.round_id)
   ORDER BY min(s.created_at) LIMIT p_limit
 LOOP
   PERFORM public.xtank_release_match_items(candidate.round_id);
   processed:=processed+1;affected_players:=affected_players+candidate.player_count;
   INSERT INTO xtank.audit_logs(actor_service,operation,entity_type,entity_id,after_data)
   VALUES('official-escrow-recovery','recover_abandoned_items','match_round',candidate.round_id,
      jsonb_build_object('released_players',candidate.player_count,'minimum_age_hours',p_hours));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'busy',false,'recovered_rounds',processed,'recovered_players',affected_players);
END $$;
REVOKE ALL ON FUNCTION public.xtank_recover_abandoned_items(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_recover_abandoned_items(integer,integer) TO service_role;