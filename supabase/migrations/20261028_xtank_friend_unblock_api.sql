-- Authenticated block-list management; never accepts a caller-provided owner id.
CREATE OR REPLACE FUNCTION public.xtank_blocks_api(p_action text, p_target uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); was_deleted boolean;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active')
   THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('blocked',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',b.blocked_player_id,
              'name',coalesce(p.display_name,'未知玩家'),'blocked_at',b.created_at)
              ORDER BY b.created_at DESC),'[]'::jsonb)
       FROM xtank.player_blocks b
       LEFT JOIN xtank.players p ON p.player_id=b.blocked_player_id
       WHERE b.player_id=me));
 ELSIF p_action='unblock' THEN
   IF p_target IS NULL OR p_target=me THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
   DELETE FROM xtank.player_blocks
     WHERE player_id=me AND blocked_player_id=p_target;
   was_deleted:=FOUND;
   RETURN jsonb_build_object('ok',true,'unblocked',was_deleted);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_blocks_api(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_blocks_api(text,uuid) TO authenticated;