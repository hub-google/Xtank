-- Account-scoped keybinding persistence. Only the authenticated player's profile can be updated.
CREATE OR REPLACE FUNCTION public.xtank_save_keybindings(p_bindings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item record;
  binding_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_bindings IS NULL OR jsonb_typeof(p_bindings) <> 'object' OR length(p_bindings::text) > 2048
    THEN RAISE EXCEPTION 'INVALID_BINDINGS'; END IF;
  SELECT count(*) INTO binding_count FROM jsonb_object_keys(p_bindings);
  IF binding_count <> 21 THEN RAISE EXCEPTION 'INVALID_BINDING_COUNT'; END IF;

  FOR item IN SELECT key, value FROM jsonb_each(p_bindings) LOOP
    IF item.key NOT IN (
      'forward','backward','left','right','fire','ability','pause','camera',
      'weapon1','weapon2','weapon3','weapon4','weapon5','weapon6','weapon7',
      'item1','item2','item3','item4','item5','item6'
    ) OR jsonb_typeof(item.value) <> 'string'
    OR (item.value #>> '{}') !~ '^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Arrow(Up|Down|Left|Right)|Space)$'
    THEN RAISE EXCEPTION 'INVALID_BINDING'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_each_text(p_bindings)) <> 21
    THEN RAISE EXCEPTION 'DUPLICATE_BINDING'; END IF;

  UPDATE xtank.player_settings s
    SET keybindings = p_bindings, updated_at = now()
    FROM xtank.players p
    WHERE s.player_id = auth.uid() AND p.player_id = s.player_id AND p.account_status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE'; END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.xtank_save_keybindings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_save_keybindings(jsonb) TO authenticated;
