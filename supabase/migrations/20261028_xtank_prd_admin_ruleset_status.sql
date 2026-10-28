-- PRD S18: inspect the versioned ruleset safely without mutating active combat rules.
CREATE OR REPLACE FUNCTION public.xtank_admin_ruleset_info()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid := auth.uid();
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users WHERE id=v_actor AND raw_app_meta_data->>'xtank_role'='admin'
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 RETURN jsonb_build_object(
 'engine_ruleset_code','prototype_0_2_2',
 'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC),'[]'::jsonb)
   FROM (SELECT code,version,source_status,is_active,created_at
     FROM xtank.rulesets ORDER BY created_at DESC LIMIT 50) v)
 );
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_admin_ruleset_info() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_admin_ruleset_info() TO authenticated;
