-- Reproducible export of deployed trusted-server functions, 2026-10-27.
-- Apply AFTER 20261027_xtank_62_table_game_schema_v1.sql.
-- Private schema, backend-only operations. Note: subsequent fixes may supersede some functions.
CREATE OR REPLACE FUNCTION xtank.apply_wallet_delta(p_player_id uuid, p_currency text, p_delta bigint, p_source_type text, p_source_id text, p_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE current_balance bigint; prior xtank.wallet_transactions%ROWTYPE; next_balance bigint;
BEGIN
  IF p_delta=0 OR p_key IS NULL OR length(p_key)=0 THEN RAISE EXCEPTION 'Invalid currency transaction'; END IF;
  INSERT INTO xtank.wallet_balances(player_id,currency_code,balance) VALUES(p_player_id,p_currency,0)
    ON CONFLICT(player_id,currency_code) DO NOTHING;
  SELECT balance INTO current_balance FROM xtank.wallet_balances WHERE player_id=p_player_id AND currency_code=p_currency FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet missing'; END IF;
  SELECT * INTO prior FROM xtank.wallet_transactions WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF prior.player_id<>p_player_id OR prior.currency_code<>p_currency OR prior.amount<>p_delta THEN RAISE EXCEPTION 'Idempotency key collision'; END IF;
    RETURN prior.balance_after;
  END IF;
  next_balance:=current_balance+p_delta;
  IF next_balance<0 THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;
  UPDATE xtank.wallet_balances SET balance=next_balance,updated_at=now() WHERE player_id=p_player_id AND currency_code=p_currency;
  INSERT INTO xtank.wallet_transactions(player_id,currency_code,amount,balance_after,source_type,source_id,idempotency_key)
   VALUES(p_player_id,p_currency,p_delta,next_balance,p_source_type,p_source_id,p_key);
  RETURN next_balance;
END $function$
;

CREATE OR REPLACE FUNCTION xtank.award_xp(p_player_id uuid, p_delta bigint, p_source_type text, p_source_id text, p_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE current_xp bigint; prior xtank.xp_transactions%ROWTYPE; next_xp bigint; old_level int; new_level int;
BEGIN
 IF p_delta<=0 OR p_key IS NULL OR length(p_key)=0 THEN RAISE EXCEPTION 'Invalid experience delta'; END IF;
 SELECT total_xp,level INTO current_xp,old_level FROM xtank.player_progress WHERE player_id=p_player_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player progress missing'; END IF;
 SELECT * INTO prior FROM xtank.xp_transactions WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF prior.player_id<>p_player_id OR prior.xp_delta<>p_delta THEN RAISE EXCEPTION 'Idempotency key collision'; END IF;
  RETURN prior.xp_after;
 END IF;
 next_xp:=current_xp+p_delta;
 new_level:=floor((sqrt(1+8*(next_xp::numeric/100))-1)/2)::int+1;
 UPDATE xtank.player_progress SET total_xp=next_xp,level=new_level,
 unspent_points=unspent_points+greatest(0,new_level-old_level),updated_at=now()
 WHERE player_id=p_player_id;
 INSERT INTO xtank.xp_transactions(player_id,xp_delta,xp_after,source_type,source_id,idempotency_key)
 VALUES(p_player_id,p_delta,next_xp,p_source_type,p_source_id,p_key);
 RETURN next_xp;
END $function$
;

CREATE OR REPLACE FUNCTION xtank.buy_offer(p_player_id uuid, p_offer_id uuid, p_quantity integer, p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE offer xtank.shop_offers%ROWTYPE; existing_order xtank.shop_orders%ROWTYPE;
 order_uuid uuid; lvl int; price bigint; kind text; ref text; inv_id uuid;
BEGIN
 IF p_quantity IS NULL OR p_quantity<1 OR p_quantity>99 OR p_key IS NULL OR length(p_key)=0 THEN RAISE EXCEPTION 'Invalid order'; END IF;
 SELECT * INTO existing_order FROM xtank.shop_orders WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF existing_order.player_id<>p_player_id THEN RAISE EXCEPTION 'Idempotency key collision'; END IF;
  RETURN existing_order.order_id;
 END IF;
 SELECT * INTO offer FROM xtank.shop_offers WHERE offer_id=p_offer_id FOR SHARE;
 IF NOT FOUND OR NOT offer.enabled OR (offer.starts_at IS NOT NULL AND offer.starts_at>now()) OR (offer.ends_at IS NOT NULL AND offer.ends_at<=now()) THEN RAISE EXCEPTION 'OFFER_UNAVAILABLE'; END IF;
 -- Inventory-limited inventory is reserved for a later allocator; fail closed rather than oversell.
 IF offer.stock_limit IS NOT NULL THEN RAISE EXCEPTION 'STOCK_LIMIT_NOT_IMPLEMENTED'; END IF;
 SELECT level INTO lvl FROM xtank.player_progress WHERE player_id=p_player_id;
 IF lvl IS NULL OR lvl<offer.min_level THEN RAISE EXCEPTION 'LEVEL_TOO_LOW'; END IF;
 price:=offer.unit_price*p_quantity;
 kind:=CASE WHEN offer.weapon_id IS NOT NULL THEN 'weapon' WHEN offer.item_id IS NOT NULL THEN 'item' ELSE 'cosmetic' END;
 ref:=coalesce(offer.weapon_id,offer.item_id,offer.cosmetic_id);
 PERFORM xtank.apply_wallet_delta(p_player_id,offer.currency_code,-price,'shop',p_key,'shop:'||p_key);
 INSERT INTO xtank.shop_orders(player_id,currency_code,total_price,status,idempotency_key,completed_at)
  VALUES(p_player_id,offer.currency_code,price,'paid',p_key,now()) RETURNING order_id INTO order_uuid;
 INSERT INTO xtank.shop_order_lines(order_id,offer_id,item_ref,item_kind,quantity,unit_price)
  VALUES(order_uuid,p_offer_id,ref,kind,offer.quantity*p_quantity,offer.unit_price);
 INSERT INTO xtank.player_inventory(player_id,weapon_id,item_id,cosmetic_id,quantity)
  VALUES(p_player_id,offer.weapon_id,offer.item_id,offer.cosmetic_id,offer.quantity*p_quantity) RETURNING inventory_id INTO inv_id;
 INSERT INTO xtank.inventory_ledger(player_id,inventory_id,item_kind,item_ref,quantity_delta,source_type,source_id,idempotency_key)
 VALUES(p_player_id,inv_id,kind,ref,offer.quantity*p_quantity,'shop',order_uuid::text,'inventory:shop:'||p_key);
 RETURN order_uuid;
END $function$
;

CREATE OR REPLACE FUNCTION xtank.provision_player(p_player_id uuid, p_display_name text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF p_display_name IS NULL OR length(p_display_name) NOT BETWEEN 3 AND 24 THEN RAISE EXCEPTION 'Invalid display name'; END IF;
 INSERT INTO xtank.players(player_id,display_name) VALUES(p_player_id,p_display_name) ON CONFLICT(player_id) DO NOTHING;
 INSERT INTO xtank.player_settings(player_id) VALUES(p_player_id) ON CONFLICT DO NOTHING;
 INSERT INTO xtank.player_stats(player_id) VALUES(p_player_id) ON CONFLICT DO NOTHING;
 INSERT INTO xtank.player_progress(player_id) VALUES(p_player_id) ON CONFLICT DO NOTHING;
 INSERT INTO xtank.player_tanks(player_id,tank_id) SELECT p_player_id,tank_id FROM xtank.tank_defs WHERE enabled ON CONFLICT DO NOTHING;
 PERFORM xtank.apply_wallet_delta(p_player_id,'COIN',1000,'new_account',p_player_id::text,'welcome:'||p_player_id::text);
END $function$
;

CREATE OR REPLACE FUNCTION xtank.settle_match_reward(p_match_id uuid, p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE reward xtank.match_rewards%ROWTYPE; m xtank.matches%ROWTYPE; participant xtank.match_participants%ROWTYPE;
BEGIN
 SELECT * INTO reward FROM xtank.match_rewards WHERE match_id=p_match_id AND player_id=p_player_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
 IF reward.status='applied' THEN RETURN; END IF;
 IF reward.status<>'pending' THEN RAISE EXCEPTION 'REWARD_NOT_PENDING'; END IF;
 SELECT * INTO m FROM xtank.matches WHERE match_id=p_match_id;
 IF NOT FOUND OR m.match_source<>'official' OR m.status<>'completed' OR m.ended_at IS NULL THEN RAISE EXCEPTION 'UNTRUSTED_MATCH'; END IF;
 SELECT * INTO participant FROM xtank.match_participants WHERE match_id=p_match_id AND player_id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_MATCH_PARTICIPANT'; END IF;
 IF reward.xp>0 THEN PERFORM xtank.award_xp(p_player_id,reward.xp,'official_match',p_match_id::text,'xp:match:'||p_match_id::text||':'||p_player_id::text); END IF;
 IF reward.currency_amount>0 THEN
  IF reward.currency_code IS NULL THEN RAISE EXCEPTION 'INVALID_REWARD_CURRENCY'; END IF;
  PERFORM xtank.apply_wallet_delta(p_player_id,reward.currency_code,reward.currency_amount,'official_match',p_match_id::text,'coin:match:'||p_match_id::text||':'||p_player_id::text);
 END IF;
 UPDATE xtank.player_stats SET matches_played=matches_played+1,
  wins=wins+CASE WHEN participant.is_winner IS TRUE THEN 1 ELSE 0 END,
  losses=losses+CASE WHEN participant.is_winner IS FALSE THEN 1 ELSE 0 END,
  draws=draws+CASE WHEN participant.is_winner IS NULL THEN 1 ELSE 0 END,
  kills=kills+participant.kills,deaths=deaths+participant.deaths,
  assists=assists+participant.assists,damage_done=damage_done+participant.damage_done,
  flag_scores=flag_scores+participant.flag_scores,
  play_seconds=play_seconds+greatest(0,extract(epoch FROM (m.ended_at-m.started_at))::bigint),
  updated_at=now()
 WHERE player_id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_STATS_MISSING'; END IF;
 UPDATE xtank.match_rewards SET status='applied',applied_at=now() WHERE reward_id=reward.reward_id;
END $function$
;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xtank FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA xtank TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA xtank REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
