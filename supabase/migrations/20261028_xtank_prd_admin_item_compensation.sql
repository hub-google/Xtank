-- PRD §6/S18: controlled positive consumable compensation; every adjustment has a ledger.
CREATE OR REPLACE FUNCTION public.xtank_admin_compensate_item(
 p_player_id uuid,p_item_id text,p_quantity integer,p_reason text,p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid := auth.uid(); v_reason text := trim(coalesce(p_reason,''));
 v_prior jsonb; v_data jsonb; v_inventory_id uuid;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users WHERE id=v_actor AND raw_app_meta_data->>'xtank_role'='admin'
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_player_id IS NULL OR p_player_id=v_actor OR p_request_id IS NULL
   OR p_item_id NOT IN ('repair','speed_boost','shield_cell','radar_ping','smoke','team_repair')
   OR p_quantity NOT BETWEEN 1 AND 30 OR length(v_reason) NOT BETWEEN 10 AND 300
 THEN RAISE EXCEPTION 'INVALID_ITEM_COMPENSATION'; END IF;
 PERFORM 1 FROM xtank.players WHERE player_id=p_player_id AND account_status<>'deleted' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM xtank.item_defs WHERE item_id=p_item_id AND enabled)
 THEN RAISE EXCEPTION 'ITEM_UNAVAILABLE'; END IF;
 SELECT a.after_data INTO v_prior FROM xtank.audit_logs a
 WHERE a.operation='admin_item_compensate' AND a.entity_id=p_request_id::text
 ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
  IF v_prior->>'player_id'<>p_player_id::text
   OR v_prior->>'item_id'<>p_item_id
   OR (v_prior->>'quantity')::integer<>p_quantity
   OR v_prior->>'reason'<>v_reason
  THEN RAISE EXCEPTION 'COMPENSATION_KEY_REUSED'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'request_id',p_request_id);
 END IF;
 PERFORM xtank.refund_escrow_item(p_player_id,p_item_id,p_quantity);
 SELECT inventory_id INTO v_inventory_id FROM xtank.player_inventory
  WHERE player_id=p_player_id AND item_id=p_item_id
  ORDER BY acquired_at,inventory_id LIMIT 1;
 INSERT INTO xtank.inventory_ledger(player_id,inventory_id,item_kind,item_ref,
    quantity_delta,source_type,source_id,idempotency_key)
 VALUES(p_player_id,v_inventory_id,'item',p_item_id,p_quantity,
    'admin_compensation',p_request_id::text,'admin:item:'||p_request_id::text);
 v_data:=jsonb_build_object('player_id',p_player_id,'item_id',p_item_id,
   'quantity',p_quantity,'reason',v_reason,'request_id',p_request_id);
 INSERT INTO xtank.audit_logs(actor_player_id,operation,entity_type,entity_id,after_data)
 VALUES(v_actor,'admin_item_compensate','player_item_adjustment',p_request_id::text,v_data);
 RETURN jsonb_build_object('ok',true,'replayed',false,'request_id',p_request_id);
END
$function$;
REVOKE ALL ON FUNCTION public.xtank_admin_compensate_item(uuid,text,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xtank_admin_compensate_item(uuid,text,integer,text,uuid) TO authenticated;
