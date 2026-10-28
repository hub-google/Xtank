-- PRD S18: administrator-controlled maintenance, with server-only status lookup.
CREATE TABLE IF NOT EXISTS xtank.service_controls(
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT false,
 notice text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES xtank.players(player_id)
);
ALTER TABLE xtank.service_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.service_controls FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON xtank.service_controls TO service_role;
INSERT INTO xtank.service_controls(id,enabled,notice) VALUES(true,false,'') ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.xtank_service_maintenance(
 p_action text DEFAULT 'status',
 p_enabled boolean DEFAULT NULL,
 p_notice text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := auth.uid();
 v_admin boolean := false;
 v_service boolean := (
   current_setting('request.jwt.claim.role',true)='service_role'
   OR coalesce(auth.jwt()->>'role','')='service_role'
 );
 v_before jsonb;
 v_current record;
 v_notice text;
BEGIN
 IF NOT v_service AND v_actor IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM auth.users
   WHERE id=v_actor AND raw_app_meta_data->>'xtank_role'='admin') INTO v_admin;
 END IF;
 IF NOT v_service AND NOT v_admin THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_action='set' THEN
  IF NOT v_admin OR p_enabled IS NULL THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  v_notice:=trim(coalesce(p_notice,''));
  IF length(v_notice)>200 OR v_notice ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'
   THEN RAISE EXCEPTION 'INVALID_MAINTENANCE_NOTICE'; END IF;
  SELECT to_jsonb(t) INTO v_before FROM xtank.service_controls t WHERE id=true FOR UPDATE;
  UPDATE xtank.service_controls
    SET enabled=p_enabled,notice=v_notice,updated_at=now(),updated_by=v_actor
    WHERE id=true;
  INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,before_data,after_data)
    VALUES(v_actor,'set_maintenance','service_controls','official_wss',v_before,
           jsonb_build_object('enabled',p_enabled,'notice',v_notice));
 ELSIF p_action<>'status' THEN
  RAISE EXCEPTION 'UNKNOWN_ACTION';
 END IF;
 SELECT enabled,notice,updated_at INTO v_current FROM xtank.service_controls WHERE id=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'MAINTENANCE_CONFIG_MISSING'; END IF;
 RETURN jsonb_build_object('enabled',v_current.enabled,'notice',v_current.notice,'updated_at',v_current.updated_at);
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_service_maintenance(text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_service_maintenance(text,boolean,text) TO authenticated,service_role;
