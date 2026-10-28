-- PRD S18/economy: supervised, auditable, idempotent positive adjustments.
CREATE OR REPLACE FUNCTION public.xtank_admin_compensate(
 p_player_id uuid,
 p_coins integer,
 p_xp integer,
 p_reason text,
 p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := auth.uid();
 v_coins integer := coalesce(p_coins,0);
 v_xp integer := coalesce(p_xp,0);
 v_reason text := trim(coalesce(p_reason,''));
 v_prior jsonb;
 v_after jsonb;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users
    WHERE id=v_actor AND raw_app_meta_data->>'xtank_role'='admin') THEN
  RAISE EXCEPTION 'ADMIN_REQUIRED';
 END IF;
 IF p_request_id IS NULL OR p_player_id IS NULL OR p_player_id=v_actor
   OR v_coins<0 OR v_xp<0 OR v_coins>50000 OR v_xp>20000
   OR (v_coins=0 AND v_xp=0)
   OR length(v_reason) NOT BETWEEN 10 AND 300
 THEN RAISE EXCEPTION 'INVALID_COMPENSATION_REQUEST'; END IF;
 PERFORM 1 FROM xtank.players WHERE player_id=p_player_id AND account_status<>'deleted' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 SELECT a.after_data INTO v_prior FROM xtank.audit_logs a
 WHERE a.operation='admin_compensate' AND a.entity_id=p_request_id::text
 ORDER BY a.created_at DESC LIMIT 1;
 IF FOUND THEN
  IF v_prior->>'player_id'<>p_player_id::text
    OR (v_prior->>'coins')::integer<>v_coins
    OR (v_prior->>'xp')::integer<>v_xp
    OR v_prior->>'reason'<>v_reason
  THEN RAISE EXCEPTION 'COMPENSATION_KEY_REUSED'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'request_id',p_request_id);
 END IF;
 IF v_coins>0 THEN
  PERFORM xtank.apply_wallet_delta(p_player_id,'COIN',v_coins,
      'admin_compensation',p_request_id::text,'admin:coin:'||p_request_id::text);
 END IF;
 IF v_xp>0 THEN
  PERFORM xtank.award_xp(p_player_id,v_xp,
      'admin_compensation',p_request_id::text,'admin:xp:'||p_request_id::text);
 END IF;
 v_after:=jsonb_build_object('player_id',p_player_id,'coins',v_coins,
   'xp',v_xp,'reason',v_reason,'request_id',p_request_id);
 INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,after_data)
 VALUES(v_actor,'admin_compensate','player_adjustment',p_request_id::text,v_after);
 RETURN jsonb_build_object('ok',true,'replayed',false,'request_id',p_request_id);
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_admin_compensate(uuid,integer,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_admin_compensate(uuid,integer,integer,text,uuid) TO authenticated;
