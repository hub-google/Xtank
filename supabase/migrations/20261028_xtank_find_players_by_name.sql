-- Search public in-game nicknames only. Never expose email or account metadata.
CREATE OR REPLACE FUNCTION public.xtank_find_players(p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid(); search_term text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=me AND account_status='active') THEN
   RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 search_term:=trim(coalesce(p_query,''));
 IF char_length(search_term) NOT BETWEEN 3 AND 24 THEN RAISE EXCEPTION 'INVALID_SEARCH_QUERY'; END IF;
 RETURN jsonb_build_object('players',(
   SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',results.player_id,
     'name',results.display_name)),'[]'::jsonb)
   FROM (
     SELECT p.player_id,p.display_name FROM xtank.players p
     WHERE p.account_status='active' AND p.player_id<>me
       AND position(lower(search_term) in lower(p.display_name))>0
       AND NOT EXISTS(
          SELECT 1 FROM xtank.player_blocks b
          WHERE (b.player_id=me AND b.blocked_player_id=p.player_id)
             OR (b.blocked_player_id=me AND b.player_id=p.player_id)
       )
     ORDER BY CASE WHEN lower(p.display_name)=lower(search_term) THEN 0 ELSE 1 END,
       p.display_name,p.player_id LIMIT 10
   ) results
 ));
END $$;
REVOKE ALL ON FUNCTION public.xtank_find_players(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_find_players(text) TO authenticated;