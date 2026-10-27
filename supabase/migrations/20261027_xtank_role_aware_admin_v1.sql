
CREATE OR REPLACE FUNCTION public.xtank_admin_api(p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target uuid; rid uuid; reason_text text; ban_id uuid; action_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor
   AND raw_app_meta_data->>'xtank_role'='admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>6000
  THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 IF p_action='overview' THEN
  RETURN jsonb_build_object(
   'total_players',(SELECT count(*) FROM xtank.players),
   'total_official_matches',(SELECT count(*) FROM xtank.matches WHERE match_source='official' AND status='completed'),
   'unresolved_reports',(SELECT count(*) FROM xtank.reports WHERE status='open'),
   'reports',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
    (SELECT report_id,reporter_id,reported_id,reason,details,status,created_at FROM xtank.reports
      ORDER BY created_at DESC LIMIT 50) x),
   'bans',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
    (SELECT b.ban_id,b.player_id,b.reason,b.starts_at,b.revoked_at FROM xtank.bans b
      ORDER BY b.starts_at DESC LIMIT 50) x));
 ELSIF p_action='suspend' THEN
  target:=(p_payload->>'player_id')::uuid;
  reason_text:=trim(coalesce(p_payload->>'reason',''));
  IF target IS NULL OR target=actor OR length(reason_text) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'INVALID_SUSPENSION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM xtank.players WHERE player_id=target AND account_status<>'deleted') THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=target AND raw_app_meta_data->>'xtank_role'='admin') THEN RAISE EXCEPTION 'CANNOT_SUSPEND_ADMIN'; END IF;
  INSERT INTO xtank.moderation_actions(target_player_id,moderator_id,action_type,reason)
   VALUES(target,actor,'suspend',reason_text) RETURNING action_id INTO action_id;
  INSERT INTO xtank.bans(player_id,action_id,reason) VALUES(target,action_id,reason_text) RETURNING ban_id INTO ban_id;
  UPDATE xtank.players SET account_status='suspended',updated_at=now() WHERE player_id=target;
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,after_data)
  VALUES(actor,'suspend','player',target::text,jsonb_build_object('reason',reason_text,'ban_id',ban_id));
  RETURN jsonb_build_object('ok',true,'ban_id',ban_id);
 ELSIF p_action='unsuspend' THEN
  target:=(p_payload->>'player_id')::uuid;
  reason_text:=trim(coalesce(p_payload->>'reason',''));
  IF target IS NULL OR length(reason_text) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'INVALID_UNSUSPEND'; END IF;
  UPDATE xtank.players SET account_status='active',updated_at=now()
    WHERE player_id=target AND account_status='suspended';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_SUSPENDED'; END IF;
  UPDATE xtank.bans SET revoked_at=now() WHERE player_id=target AND revoked_at IS NULL;
  INSERT INTO xtank.moderation_actions(target_player_id,moderator_id,action_type,reason)
   VALUES(target,actor,'unsuspend',reason_text);
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,after_data)
   VALUES(actor,'unsuspend','player',target::text,jsonb_build_object('reason',reason_text));
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='resolve_report' THEN
  rid:=(p_payload->>'report_id')::uuid;
  UPDATE xtank.reports SET status='resolved',resolved_at=now()
   WHERE report_id=rid AND status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_OPEN'; END IF;
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id)
  VALUES(actor,'resolve_report','report',rid::text);
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.xtank_admin_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_admin_api(text,jsonb) TO authenticated;
