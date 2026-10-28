-- PRD S07/S15: read-only, identity-bound transaction history and match receipts.
CREATE OR REPLACE FUNCTION public.xtank_player_history(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_player uuid := auth.uid(); v_limit integer := least(50,greatest(1,coalesce(p_limit,25)));
BEGIN
 IF v_player IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 THEN RAISE EXCEPTION 'LOGIN_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=v_player)
 THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 RETURN jsonb_build_object(
 'wallet', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb) FROM (
   SELECT transaction_id,currency_code,amount,balance_after,source_type,source_id,created_at
   FROM xtank.wallet_transactions WHERE player_id=v_player
   ORDER BY created_at DESC,transaction_id DESC LIMIT v_limit
 ) t),
 'inventory', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb) FROM (
   SELECT entry_id,item_kind,item_ref,quantity_delta,source_type,source_id,created_at
   FROM xtank.inventory_ledger WHERE player_id=v_player
   ORDER BY created_at DESC,entry_id DESC LIMIT v_limit
 ) t),
 'xp', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb) FROM (
   SELECT transaction_id,xp_delta,xp_after,source_type,source_id,created_at
   FROM xtank.xp_transactions WHERE player_id=v_player
   ORDER BY created_at DESC,transaction_id DESC LIMIT v_limit
 ) t),
 'matches', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ended_at DESC),'[]'::jsonb) FROM (
   SELECT m.match_id,m.mode_id,m.map_id,m.ended_at,p.kills,p.deaths,p.assists,
       p.damage_done,p.flag_scores,p.placement,p.is_winner,
       r.xp,r.currency_code,r.currency_amount,r.status AS reward_status
   FROM xtank.match_participants p
   JOIN xtank.matches m ON m.match_id=p.match_id AND m.match_source='official'
   LEFT JOIN xtank.match_rewards r ON r.match_id=p.match_id AND r.player_id=v_player
   WHERE p.player_id=v_player
   ORDER BY m.ended_at DESC,m.match_id DESC LIMIT v_limit
 ) t)
 );
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_player_history(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_player_history(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.xtank_player_match_receipt(p_match_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_player uuid := auth.uid(); v_result jsonb;
BEGIN
 IF v_player IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 THEN RAISE EXCEPTION 'LOGIN_REQUIRED'; END IF;
 SELECT jsonb_build_object(
   'match_id',m.match_id,
   'mode_id',m.mode_id,'ended_at',m.ended_at,
   'kills',p.kills,'deaths',p.deaths,'assists',p.assists,
   'damage',p.damage_done,'flag_scores',p.flag_scores,
   'placement',p.placement,'is_winner',p.is_winner,
   'xp',r.xp,'currency_code',r.currency_code,
   'currency_amount',r.currency_amount,'reward_status',r.status
 ) INTO v_result
 FROM xtank.matches m
 JOIN xtank.match_participants p ON p.match_id=m.match_id AND p.player_id=v_player
 JOIN xtank.match_rewards r ON r.match_id=m.match_id AND r.player_id=v_player AND r.status='applied'
 WHERE m.match_id=p_match_id AND m.match_source='official' AND m.status='completed';
 IF v_result IS NULL THEN RAISE EXCEPTION 'MATCH_RECEIPT_UNAVAILABLE'; END IF;
 RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_player_match_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_player_match_receipt(uuid) TO authenticated;
