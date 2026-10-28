-- Persistent cross-room chat moderation; only authoritative service queries it.
CREATE TABLE IF NOT EXISTS xtank.chat_restrictions (
 player_id uuid PRIMARY KEY REFERENCES xtank.players(player_id) ON DELETE CASCADE,
 muted_until timestamptz NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 300),
 moderator_id uuid REFERENCES xtank.players(player_id),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.chat_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.chat_restrictions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON xtank.chat_restrictions TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_chat_restriction(p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
   AND coalesce(auth.jwt()->>'role','')<>'service_role'
 THEN RAISE EXCEPTION 'SERVER_ONLY'; END IF;
 RETURN jsonb_build_object('muted_until',(
  SELECT muted_until FROM xtank.chat_restrictions
  WHERE player_id=p_player_id AND muted_until>now()));
END $$;
REVOKE ALL ON FUNCTION public.xtank_chat_restriction(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_chat_restriction(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.xtank_admin_chat_api(
 p_action text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; vminutes integer;
        vreason text; expiry timestamptz; before_row jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=actor AND raw_app_meta_data->>'xtank_role'='admin'
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
   OR length(p_payload::text)>1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF p_action='list' THEN
   RETURN jsonb_build_object('restrictions',(
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.muted_until DESC),'[]'::jsonb)
    FROM (SELECT c.player_id,p.display_name,c.muted_until,c.reason,c.moderator_id,c.updated_at
          FROM xtank.chat_restrictions c JOIN xtank.players p USING(player_id)
          WHERE c.muted_until>now() ORDER BY c.muted_until DESC LIMIT 100)t));
 END IF;
 target:=nullif(p_payload->>'player_id','')::uuid;
 IF target IS NULL OR target=actor OR NOT EXISTS(
  SELECT 1 FROM xtank.players WHERE player_id=target AND account_status<>'deleted'
 ) THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=target
   AND raw_app_meta_data->>'xtank_role'='admin')
 THEN RAISE EXCEPTION 'CANNOT_MUTE_ADMIN'; END IF;
 IF p_action='mute' THEN
   vminutes:=(p_payload->>'minutes')::integer;
   vreason:=trim(coalesce(p_payload->>'reason',''));
   IF vminutes NOT BETWEEN 1 AND 10080 OR length(vreason) NOT BETWEEN 5 AND 300
   THEN RAISE EXCEPTION 'INVALID_MUTE'; END IF;
   SELECT to_jsonb(c) INTO before_row FROM xtank.chat_restrictions c
    WHERE c.player_id=target FOR UPDATE;
   expiry:=now()+make_interval(mins=>vminutes);
   INSERT INTO xtank.chat_restrictions(player_id,muted_until,reason,moderator_id)
   VALUES(target,expiry,vreason,actor)
   ON CONFLICT(player_id) DO UPDATE SET muted_until=excluded.muted_until,
     reason=excluded.reason,moderator_id=excluded.moderator_id,updated_at=now();
   INSERT INTO xtank.moderation_actions(target_player_id,moderator_id,action_type,reason,expires_at)
   VALUES(target,actor,'chat_mute',vreason,expiry);
   INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
   VALUES(actor,'chat_mute','player',target::text,before_row,
     jsonb_build_object('muted_until',expiry,'reason',vreason));
   RETURN jsonb_build_object('ok',true,'muted_until',expiry);
 ELSIF p_action='unmute' THEN
   DELETE FROM xtank.chat_restrictions c WHERE c.player_id=target RETURNING to_jsonb(c) INTO before_row;
   INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
    VALUES(actor,'chat_unmute','player',target::text,before_row,
      jsonb_build_object('muted_until',null));
   RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_admin_chat_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_admin_chat_api(text,jsonb) TO authenticated;