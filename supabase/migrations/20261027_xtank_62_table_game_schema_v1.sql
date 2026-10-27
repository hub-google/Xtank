-- X-TANK initial schema; Game project; isolated private schema, no direct client access.
CREATE SCHEMA IF NOT EXISTS xtank;
REVOKE ALL ON SCHEMA xtank FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA xtank TO service_role;

CREATE TABLE IF NOT EXISTS xtank.players (
 player_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, display_name text NOT NULL CHECK(length(display_name) BETWEEN 3 AND 24), avatar_key text, account_status text NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','restricted','suspended','deleted')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz
);
ALTER TABLE xtank.players ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_settings (
 player_id uuid PRIMARY KEY REFERENCES xtank.players(player_id) ON DELETE CASCADE, graphics_quality text NOT NULL DEFAULT 'auto', master_volume numeric(4,3) NOT NULL DEFAULT 1 CHECK(master_volume BETWEEN 0 AND 1), music_volume numeric(4,3) NOT NULL DEFAULT .7 CHECK(music_volume BETWEEN 0 AND 1), sfx_volume numeric(4,3) NOT NULL DEFAULT .8 CHECK(sfx_volume BETWEEN 0 AND 1), mouse_sensitivity numeric(8,3) NOT NULL DEFAULT 1 CHECK(mouse_sensitivity>0), camera_mode smallint NOT NULL DEFAULT 1 CHECK(camera_mode BETWEEN 1 AND 5), locale text NOT NULL DEFAULT 'zh-TW', keybindings jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.player_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_progress (
 player_id uuid PRIMARY KEY REFERENCES xtank.players(player_id) ON DELETE CASCADE, level int NOT NULL DEFAULT 1 CHECK(level>=1), total_xp bigint NOT NULL DEFAULT 0 CHECK(total_xp>=0), unspent_points int NOT NULL DEFAULT 0 CHECK(unspent_points>=0), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.player_progress ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_stats (
 player_id uuid PRIMARY KEY REFERENCES xtank.players(player_id) ON DELETE CASCADE, matches_played bigint NOT NULL DEFAULT 0 CHECK(matches_played>=0), wins bigint NOT NULL DEFAULT 0 CHECK(wins>=0), losses bigint NOT NULL DEFAULT 0 CHECK(losses>=0), draws bigint NOT NULL DEFAULT 0 CHECK(draws>=0), kills bigint NOT NULL DEFAULT 0 CHECK(kills>=0), deaths bigint NOT NULL DEFAULT 0 CHECK(deaths>=0), assists bigint NOT NULL DEFAULT 0 CHECK(assists>=0), damage_done bigint NOT NULL DEFAULT 0 CHECK(damage_done>=0), flag_scores bigint NOT NULL DEFAULT 0 CHECK(flag_scores>=0), play_seconds bigint NOT NULL DEFAULT 0 CHECK(play_seconds>=0), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.player_stats ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_sessions (
 session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, server_session_id text, client_version text, device_hash text, status text NOT NULL DEFAULT 'active', last_heartbeat_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
ALTER TABLE xtank.player_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.login_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, player_id uuid REFERENCES xtank.players(player_id) ON DELETE SET NULL, success boolean NOT NULL, event_type text NOT NULL, ip_hash text, device_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.login_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.rulesets (
 ruleset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, version text NOT NULL, source_status text NOT NULL DEFAULT 'P' CHECK(source_status IN ('H1','H2','P','U')), config jsonb NOT NULL DEFAULT '{}'::jsonb, is_active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.rulesets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.ability_defs (
 ability_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, ability_type text NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb, source_status text NOT NULL DEFAULT 'P', enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.ability_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.weapon_defs (
 weapon_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, category text NOT NULL, damage_shield numeric(10,3) NOT NULL DEFAULT 0 CHECK(damage_shield>=0), damage_hp numeric(10,3) NOT NULL DEFAULT 0 CHECK(damage_hp>=0), cooldown_ms int NOT NULL CHECK(cooldown_ms>=0), projectile_speed numeric(10,3) NOT NULL DEFAULT 0, range_m numeric(10,3) NOT NULL DEFAULT 0, splash_radius numeric(10,3) NOT NULL DEFAULT 0, ammo_capacity int NOT NULL DEFAULT -1 CHECK(ammo_capacity>=-1), config jsonb NOT NULL DEFAULT '{}'::jsonb, source_status text NOT NULL DEFAULT 'P', enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.weapon_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.tank_defs (
 tank_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, base_hp int NOT NULL CHECK(base_hp>0), base_shield int NOT NULL CHECK(base_shield>=0), speed numeric(8,3) NOT NULL CHECK(speed>0), attack_scale numeric(8,4) NOT NULL CHECK(attack_scale>0), collision_scale numeric(8,4) NOT NULL CHECK(collision_scale>0), ability_id text REFERENCES xtank.ability_defs(ability_id), starting_weapon_id text REFERENCES xtank.weapon_defs(weapon_id), source_status text NOT NULL DEFAULT 'P', enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.tank_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.item_defs (
 item_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, category text NOT NULL, is_consumable boolean NOT NULL DEFAULT true, max_stack int NOT NULL DEFAULT 999 CHECK(max_stack>0), effect_config jsonb NOT NULL DEFAULT '{}'::jsonb, source_status text NOT NULL DEFAULT 'P', enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.item_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.map_defs (
 map_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, max_players int NOT NULL DEFAULT 8 CHECK(max_players BETWEEN 2 AND 8), scene_key text NOT NULL, collider_version text NOT NULL DEFAULT '1', spawn_config jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.map_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.mode_defs (
 mode_id text PRIMARY KEY, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), display_name text NOT NULL, min_players int NOT NULL DEFAULT 2 CHECK(min_players>=1), max_players int NOT NULL DEFAULT 8 CHECK(max_players<=8), time_limit_s int NOT NULL CHECK(time_limit_s>0), score_limit int NOT NULL CHECK(score_limit>0), config jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true, CHECK(min_players<=max_players)
);
ALTER TABLE xtank.mode_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.cosmetic_defs (
 cosmetic_id text PRIMARY KEY, category text NOT NULL, display_name text NOT NULL, asset_key text, rarity text NOT NULL DEFAULT 'common', enabled boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE xtank.cosmetic_defs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.assets (
 asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_key text NOT NULL UNIQUE, kind text NOT NULL, storage_path text, sha256 text, author text, license_type text, license_url text, distributable boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_tanks (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, tank_id text NOT NULL REFERENCES xtank.tank_defs(tank_id), level int NOT NULL DEFAULT 1 CHECK(level>=1), xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0), mastery bigint NOT NULL DEFAULT 0 CHECK(mastery>=0), unlocked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,tank_id)
);
ALTER TABLE xtank.player_tanks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.tank_upgrades (
 player_id uuid NOT NULL, tank_id text NOT NULL, attribute text NOT NULL CHECK(attribute IN ('speed','attack','defense','energy','collision')), level int NOT NULL DEFAULT 0 CHECK(level BETWEEN 0 AND 10), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,tank_id,attribute), FOREIGN KEY(player_id,tank_id) REFERENCES xtank.player_tanks(player_id,tank_id) ON DELETE CASCADE
);
ALTER TABLE xtank.tank_upgrades ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_inventory (
 inventory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, weapon_id text REFERENCES xtank.weapon_defs(weapon_id), item_id text REFERENCES xtank.item_defs(item_id), cosmetic_id text REFERENCES xtank.cosmetic_defs(cosmetic_id), quantity bigint NOT NULL DEFAULT 1 CHECK(quantity>0), durability int, acquired_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(num_nonnulls(weapon_id,item_id,cosmetic_id)=1)
);
ALTER TABLE xtank.player_inventory ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.inventory_ledger (
 entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, inventory_id uuid REFERENCES xtank.player_inventory(inventory_id) ON DELETE SET NULL, item_kind text NOT NULL, item_ref text NOT NULL, quantity_delta bigint NOT NULL CHECK(quantity_delta<>0), source_type text NOT NULL, source_id text NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.inventory_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.loadouts (
 loadout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL, tank_id text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40), is_selected boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(player_id,tank_id) REFERENCES xtank.player_tanks(player_id,tank_id) ON DELETE CASCADE
);
ALTER TABLE xtank.loadouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.loadout_slots (
 loadout_id uuid NOT NULL REFERENCES xtank.loadouts(loadout_id) ON DELETE CASCADE, slot_type text NOT NULL CHECK(slot_type IN ('weapon','item')), slot_number smallint NOT NULL CHECK(slot_number BETWEEN 1 AND 7), weapon_id text REFERENCES xtank.weapon_defs(weapon_id), item_id text REFERENCES xtank.item_defs(item_id), PRIMARY KEY(loadout_id,slot_type,slot_number), CHECK((slot_type='weapon' AND weapon_id IS NOT NULL AND item_id IS NULL) OR (slot_type='item' AND item_id IS NOT NULL AND weapon_id IS NULL))
);
ALTER TABLE xtank.loadout_slots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.equipped_cosmetics (
 player_id uuid NOT NULL, tank_id text NOT NULL, equip_slot text NOT NULL, cosmetic_id text NOT NULL REFERENCES xtank.cosmetic_defs(cosmetic_id), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,tank_id,equip_slot), FOREIGN KEY(player_id,tank_id) REFERENCES xtank.player_tanks(player_id,tank_id) ON DELETE CASCADE
);
ALTER TABLE xtank.equipped_cosmetics ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.currencies (
 currency_code text PRIMARY KEY, display_name text NOT NULL, spendable boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.currencies ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.wallet_balances (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, currency_code text NOT NULL REFERENCES xtank.currencies(currency_code), balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,currency_code)
);
ALTER TABLE xtank.wallet_balances ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.wallet_transactions (
 transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL, currency_code text NOT NULL, amount bigint NOT NULL CHECK(amount<>0), balance_after bigint NOT NULL CHECK(balance_after>=0), source_type text NOT NULL, source_id text NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(player_id,currency_code) REFERENCES xtank.wallet_balances(player_id,currency_code) ON DELETE CASCADE
);
ALTER TABLE xtank.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.xp_transactions (
 transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, xp_delta bigint NOT NULL CHECK(xp_delta<>0), xp_after bigint NOT NULL CHECK(xp_after>=0), source_type text NOT NULL, source_id text NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.xp_transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.shop_offers (
 offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offer_key text NOT NULL UNIQUE, weapon_id text REFERENCES xtank.weapon_defs(weapon_id), item_id text REFERENCES xtank.item_defs(item_id), cosmetic_id text REFERENCES xtank.cosmetic_defs(cosmetic_id), currency_code text NOT NULL REFERENCES xtank.currencies(currency_code), unit_price bigint NOT NULL CHECK(unit_price>=0), quantity int NOT NULL DEFAULT 1 CHECK(quantity>0), min_level int NOT NULL DEFAULT 1 CHECK(min_level>0), stock_limit int, starts_at timestamptz, ends_at timestamptz, enabled boolean NOT NULL DEFAULT true, CHECK(num_nonnulls(weapon_id,item_id,cosmetic_id)=1), CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
ALTER TABLE xtank.shop_offers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.shop_orders (
 order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, currency_code text NOT NULL REFERENCES xtank.currencies(currency_code), total_price bigint NOT NULL CHECK(total_price>=0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded')), idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE xtank.shop_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.shop_order_lines (
 order_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES xtank.shop_orders(order_id) ON DELETE CASCADE, offer_id uuid REFERENCES xtank.shop_offers(offer_id) ON DELETE SET NULL, item_ref text NOT NULL, item_kind text NOT NULL, quantity int NOT NULL CHECK(quantity>0), unit_price bigint NOT NULL CHECK(unit_price>=0), line_total bigint GENERATED ALWAYS AS (quantity::bigint*unit_price) STORED
);
ALTER TABLE xtank.shop_order_lines ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.game_servers (
 server_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_name text NOT NULL, region text NOT NULL DEFAULT 'asia-east', endpoint_url text, build_version text, status text NOT NULL DEFAULT 'offline', current_players int NOT NULL DEFAULT 0 CHECK(current_players>=0), capacity int NOT NULL DEFAULT 0 CHECK(capacity>=0), last_heartbeat_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.game_servers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.rooms (
 room_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_code text NOT NULL UNIQUE CHECK(room_code ~ '^[A-Z0-9]{6}$'), host_player_id uuid REFERENCES xtank.players(player_id) ON DELETE SET NULL, game_server_id uuid REFERENCES xtank.game_servers(server_id) ON DELETE SET NULL, mode_id text NOT NULL REFERENCES xtank.mode_defs(mode_id), map_id text NOT NULL REFERENCES xtank.map_defs(map_id), phase text NOT NULL DEFAULT 'open' CHECK(phase IN ('open','ready_check','countdown','live','result','closed')), password_hash text, capacity int NOT NULL DEFAULT 8 CHECK(capacity BETWEEN 2 AND 8), allow_ai boolean NOT NULL DEFAULT true, room_config jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz
);
ALTER TABLE xtank.rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.room_members (
 room_id uuid NOT NULL REFERENCES xtank.rooms(room_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, tank_id text REFERENCES xtank.tank_defs(tank_id), team smallint CHECK(team IN (0,1)), slot_number smallint CHECK(slot_number BETWEEN 1 AND 8), is_ready boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, PRIMARY KEY(room_id,player_id)
);
ALTER TABLE xtank.room_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.room_invites (
 invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES xtank.rooms(room_id) ON DELETE CASCADE, inviter_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, invitee_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired')), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(inviter_id<>invitee_id)
);
ALTER TABLE xtank.room_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.parties (
 party_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), leader_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
ALTER TABLE xtank.parties ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.party_members (
 party_id uuid NOT NULL REFERENCES xtank.parties(party_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(party_id,player_id)
);
ALTER TABLE xtank.party_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.matchmaking_tickets (
 ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, party_id uuid REFERENCES xtank.parties(party_id) ON DELETE SET NULL, mode_id text NOT NULL REFERENCES xtank.mode_defs(mode_id), region text NOT NULL DEFAULT 'asia-east', rating int, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','matched','cancelled','expired')), matched_room_id uuid REFERENCES xtank.rooms(room_id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.matchmaking_tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.matches (
 match_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid REFERENCES xtank.rooms(room_id) ON DELETE SET NULL, server_id uuid REFERENCES xtank.game_servers(server_id) ON DELETE SET NULL, server_round_id text NOT NULL UNIQUE, ruleset_id uuid NOT NULL REFERENCES xtank.rulesets(ruleset_id), mode_id text NOT NULL REFERENCES xtank.mode_defs(mode_id), map_id text NOT NULL REFERENCES xtank.map_defs(map_id), seed bigint, match_source text NOT NULL CHECK(match_source IN ('official','practice','community')), status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','aborted','void')), winning_team smallint CHECK(winning_team IN (0,1)), results jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
ALTER TABLE xtank.matches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.match_participants (
 match_id uuid NOT NULL REFERENCES xtank.matches(match_id) ON DELETE CASCADE, slot_number smallint NOT NULL CHECK(slot_number BETWEEN 1 AND 8), player_id uuid REFERENCES xtank.players(player_id) ON DELETE SET NULL, ai_identifier text, tank_id text NOT NULL REFERENCES xtank.tank_defs(tank_id), team smallint, kills int NOT NULL DEFAULT 0 CHECK(kills>=0), deaths int NOT NULL DEFAULT 0 CHECK(deaths>=0), assists int NOT NULL DEFAULT 0 CHECK(assists>=0), damage_done bigint NOT NULL DEFAULT 0 CHECK(damage_done>=0), flag_scores int NOT NULL DEFAULT 0 CHECK(flag_scores>=0), placement smallint CHECK(placement BETWEEN 1 AND 8), is_winner boolean, disconnected boolean NOT NULL DEFAULT false, PRIMARY KEY(match_id,slot_number), CHECK(num_nonnulls(player_id,ai_identifier)=1)
);
ALTER TABLE xtank.match_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.match_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES xtank.matches(match_id) ON DELETE CASCADE, server_tick bigint NOT NULL CHECK(server_tick>=0), event_seq bigint NOT NULL, event_type text NOT NULL, actor_id uuid REFERENCES xtank.players(player_id) ON DELETE SET NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(match_id,event_seq)
);
ALTER TABLE xtank.match_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.match_rewards (
 reward_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES xtank.matches(match_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0), currency_code text REFERENCES xtank.currencies(currency_code), currency_amount bigint NOT NULL DEFAULT 0 CHECK(currency_amount>=0), item_rewards jsonb NOT NULL DEFAULT '[]'::jsonb, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')), applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(match_id,player_id)
);
ALTER TABLE xtank.match_rewards ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.replay_files (
 replay_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES xtank.matches(match_id) ON DELETE CASCADE, storage_key text NOT NULL, sha256 text, bytes bigint CHECK(bytes>=0), game_version text NOT NULL, ruleset_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.replay_files ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.seasons (
 season_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, display_name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'scheduled', config jsonb NOT NULL DEFAULT '{}'::jsonb, CHECK(ends_at>starts_at)
);
ALTER TABLE xtank.seasons ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_ratings (
 season_id uuid NOT NULL REFERENCES xtank.seasons(season_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, mode_id text NOT NULL REFERENCES xtank.mode_defs(mode_id), rating int NOT NULL DEFAULT 1000, mmr int NOT NULL DEFAULT 1000, wins int NOT NULL DEFAULT 0, losses int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(season_id,player_id,mode_id)
);
ALTER TABLE xtank.player_ratings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.leaderboard_snapshots (
 snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), season_id uuid REFERENCES xtank.seasons(season_id) ON DELETE SET NULL, mode_id text REFERENCES xtank.mode_defs(mode_id), metric text NOT NULL, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, rank int NOT NULL CHECK(rank>0), score numeric(18,3) NOT NULL, snapshot_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.friends (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, friend_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')), requested_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, PRIMARY KEY(player_id,friend_id), CHECK(player_id<>friend_id)
);
ALTER TABLE xtank.friends ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_blocks (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, blocked_player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id,blocked_player_id), CHECK(player_id<>blocked_player_id)
);
ALTER TABLE xtank.player_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.clans (
 clan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clan_name text NOT NULL UNIQUE, tag text UNIQUE, leader_id uuid NOT NULL REFERENCES xtank.players(player_id), description text, created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'active'
);
ALTER TABLE xtank.clans ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.clan_members (
 clan_id uuid NOT NULL REFERENCES xtank.clans(clan_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'member' CHECK(role IN ('leader','officer','member','applicant')), joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(clan_id,player_id)
);
ALTER TABLE xtank.clan_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.chat_messages (
 message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, room_id uuid REFERENCES xtank.rooms(room_id) ON DELETE CASCADE, clan_id uuid REFERENCES xtank.clans(clan_id) ON DELETE CASCADE, recipient_id uuid REFERENCES xtank.players(player_id) ON DELETE CASCADE, channel text NOT NULL CHECK(channel IN ('room','clan','private','party','system')), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000), sent_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
ALTER TABLE xtank.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.notifications (
 notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.mail_items (
 mail_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, sender_id uuid REFERENCES xtank.players(player_id) ON DELETE SET NULL, title text NOT NULL, body text NOT NULL, attachments jsonb NOT NULL DEFAULT '[]'::jsonb, claimed_at timestamptz, read_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.mail_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.achievements (
 achievement_id text PRIMARY KEY, display_name text NOT NULL, description text, condition_config jsonb NOT NULL DEFAULT '{}'::jsonb, reward_config jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.achievements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_achievements (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, achievement_id text NOT NULL REFERENCES xtank.achievements(achievement_id), progress bigint NOT NULL DEFAULT 0 CHECK(progress>=0), completed_at timestamptz, claimed_at timestamptz, PRIMARY KEY(player_id,achievement_id)
);
ALTER TABLE xtank.player_achievements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.quests (
 quest_id text PRIMARY KEY, display_name text NOT NULL, cadence text NOT NULL CHECK(cadence IN ('daily','weekly','tutorial','once','seasonal')), condition_config jsonb NOT NULL DEFAULT '{}'::jsonb, reward_config jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE xtank.quests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.player_quests (
 player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, quest_id text NOT NULL REFERENCES xtank.quests(quest_id), cycle_key text NOT NULL, progress bigint NOT NULL DEFAULT 0 CHECK(progress>=0), completed_at timestamptz, claimed_at timestamptz, PRIMARY KEY(player_id,quest_id,cycle_key)
);
ALTER TABLE xtank.player_quests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.live_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, display_name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, config jsonb NOT NULL DEFAULT '{}'::jsonb, enabled boolean NOT NULL DEFAULT true, CHECK(ends_at>starts_at)
);
ALTER TABLE xtank.live_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.live_event_progress (
 event_id uuid NOT NULL REFERENCES xtank.live_events(event_id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES xtank.players(player_id) ON DELETE CASCADE, progress jsonb NOT NULL DEFAULT '{}'::jsonb, claimed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,player_id)
);
ALTER TABLE xtank.live_event_progress ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.reports (
 report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL REFERENCES xtank.players(player_id), reported_id uuid REFERENCES xtank.players(player_id), match_id uuid REFERENCES xtank.matches(match_id), reason text NOT NULL, details text, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
ALTER TABLE xtank.reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.moderation_actions (
 action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_player_id uuid NOT NULL REFERENCES xtank.players(player_id), moderator_id uuid REFERENCES xtank.players(player_id), report_id uuid REFERENCES xtank.reports(report_id), action_type text NOT NULL, reason text NOT NULL, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.moderation_actions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.bans (
 ban_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES xtank.players(player_id), action_id uuid REFERENCES xtank.moderation_actions(action_id), device_hash text, starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, reason text NOT NULL
);
ALTER TABLE xtank.bans ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_player_id uuid REFERENCES xtank.players(player_id), actor_service text, operation text NOT NULL, entity_type text NOT NULL, entity_id text, before_data jsonb, after_data jsonb, request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xtank.config_changes (
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_player_id uuid REFERENCES xtank.players(player_id), config_type text NOT NULL, config_key text NOT NULL, before_value jsonb, after_value jsonb NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.config_changes ENABLE ROW LEVEL SECURITY;

-- Explicitly keep the entire namespace private. Backend service role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA xtank TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA xtank TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA xtank GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA xtank GRANT USAGE, SELECT ON SEQUENCES TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS ux_xtank_player_name_ci ON xtank.players (lower(display_name)) WHERE account_status <> 'deleted';
CREATE UNIQUE INDEX IF NOT EXISTS ux_xtank_selected_loadout ON xtank.loadouts(player_id,tank_id) WHERE is_selected;
CREATE UNIQUE INDEX IF NOT EXISTS ux_xtank_match_player ON xtank.match_participants(match_id,player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_xtank_room_slot ON xtank.room_members(room_id,slot_number) WHERE slot_number IS NOT NULL AND left_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_xtank_matches_time ON xtank.matches(started_at DESC);
CREATE INDEX IF NOT EXISTS ix_xtank_participants_player ON xtank.match_participants(player_id,match_id);
CREATE INDEX IF NOT EXISTS ix_xtank_inventory_owner ON xtank.player_inventory(player_id);
CREATE INDEX IF NOT EXISTS ix_xtank_wallet_tx_player ON xtank.wallet_transactions(player_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_xtank_chat_channel ON xtank.chat_messages(channel,sent_at DESC);
CREATE INDEX IF NOT EXISTS ix_xtank_notifications_unread ON xtank.notifications(player_id,created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_xtank_events_match_tick ON xtank.match_events(match_id,server_tick);
CREATE INDEX IF NOT EXISTS ix_xtank_rooms_active ON xtank.rooms(phase,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_xtank_ratings_rank ON xtank.player_ratings(season_id,mode_id,rating DESC);
CREATE INDEX IF NOT EXISTS ix_xtank_matchmaking_queue ON xtank.matchmaking_tickets(mode_id,region,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS ix_xtank_audit_time ON xtank.audit_logs(created_at DESC);
-- Reference catalogs based on executable src/simulation.js, version 0.2.2.
INSERT INTO xtank.rulesets(code,version,source_status,is_active,config) VALUES ('prototype_0_2_2','0.2.2','P',true,'{"source":"src/simulation.js","note":"prototype values not historically verified"}') ON CONFLICT(code) DO NOTHING;
INSERT INTO xtank.currencies(currency_code,display_name) VALUES ('COIN','遊戲金幣') ON CONFLICT DO NOTHING;
INSERT INTO xtank.ability_defs(ability_id,ruleset_id,display_name,ability_type) SELECT a.code,r.ruleset_id,a.name,a.code FROM xtank.rulesets r CROSS JOIN (VALUES ('nitro','硝基強化'),('accel','加速'),('defense','防禦'),('radar','雷達'),('invisible','隱形')) AS a(code,name) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
INSERT INTO xtank.weapon_defs(weapon_id,ruleset_id,display_name,category,damage_shield,damage_hp,cooldown_ms,projectile_speed,range_m,splash_radius,ammo_capacity,config)
SELECT w.code,r.ruleset_id,w.name,w.kind,w.damage,w.damage,w.cooldown,w.speed,w.distance,w.splash,w.ammo,w.config::jsonb FROM xtank.rulesets r CROSS JOIN (VALUES
('hurricane','颶風飛彈','direct',23,680,32,38,0,-1,'{}'),
('death_knight','死亡騎士','direct',30,850,40,44,0,-1,'{}'),
('vulcan','火神機炮','rapid',7,130,52,27,0,-1,'{}'),
('plasma','電漿炮','rapid',10,190,48,28,0,-1,'{}'),
('chemical','化學爆破彈','blast',37,1550,23,34,3.5,18,'{}'),
('ion_missile','離子導彈','guided',42,2500,19,37,2.1,8,'{"homing":true}'),
('mine','接觸地雷','mine',45,1300,0,0,2.6,5,'{"mine":true}')
) w(code,name,kind,damage,cooldown,speed,distance,splash,ammo,config) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
INSERT INTO xtank.tank_defs(tank_id,ruleset_id,display_name,base_hp,base_shield,speed,attack_scale,collision_scale,ability_id,starting_weapon_id)
SELECT t.code,r.ruleset_id,t.code||'-TANK',t.hp,t.shield,t.speed,t.attack,t.collision,t.ability,'hurricane' FROM xtank.rulesets r CROSS JOIN (VALUES
('X',100,65,7.4,1.00,1.10,'nitro'),('D',140,85,5.6,1.12,1.15,'accel'),('M',130,75,6.0,1.16,1.30,'nitro'),('R',95,40,10.0,.82,.85,'defense'),('H',95,45,9.2,.88,.90,'defense'),('A',110,60,8.2,1.03,1.05,'radar'),('O',85,95,7.0,.92,1.0,'defense'),('S',90,52,6.6,1.20,.80,'invisible')
) t(code,hp,shield,speed,attack,collision,ability) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
INSERT INTO xtank.item_defs(item_id,ruleset_id,display_name,category,effect_config) SELECT v.code,r.ruleset_id,v.name,'consumable',v.effect::jsonb FROM xtank.rulesets r CROSS JOIN (VALUES ('repair','修理','{"hotkey":"F1"}'),('speed_boost','加速','{"hotkey":"F2"}'),('shield_cell','補盾','{"hotkey":"F3"}'),('radar_ping','雷達','{"hotkey":"F4"}'),('smoke','煙霧','{"hotkey":"F5"}'),('team_repair','團隊修復','{"hotkey":"F6"}')) v(code,name,effect) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
INSERT INTO xtank.map_defs(map_id,ruleset_id,display_name,scene_key) SELECT v.code,r.ruleset_id,v.name,v.code FROM xtank.rulesets r CROSS JOIN (VALUES('desk','巨型書桌'),('chess','棋盤戰場'),('circuit','電路板戰場')) v(code,name) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
INSERT INTO xtank.mode_defs(mode_id,ruleset_id,display_name,min_players,max_players,time_limit_s,score_limit) SELECT v.code,r.ruleset_id,v.name,2,8,v.secs,v.score FROM xtank.rulesets r CROSS JOIN (VALUES ('FFA','個人死鬥',300,12),('TDM','團隊死鬥',480,30),('FLAG_HOLD','持旗爭奪',480,5)) v(code,name,secs,score) WHERE r.code='prototype_0_2_2' ON CONFLICT DO NOTHING;
