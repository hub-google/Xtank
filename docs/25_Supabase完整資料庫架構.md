# X-TANK｜Supabase 完整資料庫架構（已部署）
> 2026-10-27 / Supabase **Game** 專案 / 私有 schema: `xtank`  
> 實際部署 **62 張遊戲業務資料表 + 2 張私有 QA 專用表 = 64 張資料表，64 張 RLS 啟用**。種子資料：8 車、7 武器、6 道具、3 張地圖、3 模式、5 技能、3 項初始商店商品、1 種金幣及 1 版規則。  
> 此文件代表資料庫已建好，**不代表 EXE 登入、購物或結算 UI 已串接**。

## 1. 唯一規格與正式 SQL
- [完整建表 migration：62 表、索引、約束、RLS、初始遊戲資料](../supabase/migrations/20261027_xtank_62_table_game_schema_v1.sql)
- [交易函式 migration：玩家建檔、金幣、經驗、商店、官方對戰結算](../supabase/migrations/20261027_xtank_secure_economy_procedures_v1.sql)
- [修正商品同時購買的交易一致性，及新增 3 項初始商品](../supabase/migrations/20261027_xtank_shop_checkout_consistency_v2.sql)
- 使用順序：Schema → Procedures；既有 Game 專案已部署，不須再次套用。搬遷新專案時按順序執行。
- 以 migration 為約束、索引、資料型別與預設值的**權威來源**；下表欄位由目前 Supabase `information_schema` 直接查詢後列出。

## 2. 系統關聯圖（文字版）
```text
auth.users(id) ──1:1── xtank.players(player_id)
players ──1:N── player_tanks ──1:N── tank_upgrades
players ──1:N── player_inventory ──1:N── inventory_ledger
players ──1:N── loadouts ──1:N── loadout_slots
players ──1:N── wallet_balances ──1:N── wallet_transactions
players ──1:N── shop_orders ──1:N── shop_order_lines
game_servers ──1:N── rooms ──1:N── room_members
matches ──1:N── match_participants
matches ──1:N── match_events
matches ──1:N── match_rewards（match_id + player_id 唯一）
rulesets ──1:N── 坦克／武器／道具／地圖／模式定義、matches
seasons ──1:N── player_ratings ── N:1── players
```

## 3. 62 張資料表與實際欄位

### 帳號與玩家（6）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.players` | player_id, display_name, avatar_key, account_status, created_at, updated_at, last_seen_at |
| `xtank.player_settings` | player_id, graphics_quality, master_volume, music_volume, sfx_volume, mouse_sensitivity, camera_mode, locale, keybindings, updated_at |
| `xtank.player_progress` | player_id, level, total_xp, unspent_points, updated_at |
| `xtank.player_stats` | player_id, matches_played, wins, losses, draws, kills, deaths, assists, damage_done, flag_scores, play_seconds, updated_at |
| `xtank.player_sessions` | session_id, player_id, server_session_id, client_version, device_hash, status, last_heartbeat_at, created_at, ended_at |
| `xtank.login_history` | id, player_id, success, event_type, ip_hash, device_hash, created_at |

### 坦克、規則與內容（9）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.rulesets` | ruleset_id, code, version, source_status, config, is_active, created_at |
| `xtank.ability_defs` | ability_id, ruleset_id, display_name, ability_type, config, source_status, enabled |
| `xtank.weapon_defs` | weapon_id, ruleset_id, display_name, category, damage_shield, damage_hp, cooldown_ms, projectile_speed, range_m, splash_radius, ammo_capacity, config, source_status, enabled |
| `xtank.tank_defs` | tank_id, ruleset_id, display_name, base_hp, base_shield, speed, attack_scale, collision_scale, ability_id, starting_weapon_id, source_status, enabled |
| `xtank.item_defs` | item_id, ruleset_id, display_name, category, is_consumable, max_stack, effect_config, source_status, enabled |
| `xtank.map_defs` | map_id, ruleset_id, display_name, max_players, scene_key, collider_version, spawn_config, enabled |
| `xtank.mode_defs` | mode_id, ruleset_id, display_name, min_players, max_players, time_limit_s, score_limit, config, enabled |
| `xtank.cosmetic_defs` | cosmetic_id, category, display_name, asset_key, rarity, enabled, config |
| `xtank.assets` | asset_id, asset_key, kind, storage_path, sha256, author, license_type, license_url, distributable, metadata, updated_at |

### 機庫、背包、裝備（7）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.player_tanks` | player_id, tank_id, level, xp, mastery, unlocked_at |
| `xtank.tank_upgrades` | player_id, tank_id, attribute, level, updated_at |
| `xtank.player_inventory` | inventory_id, player_id, weapon_id, item_id, cosmetic_id, quantity, durability, acquired_at, updated_at |
| `xtank.inventory_ledger` | entry_id, player_id, inventory_id, item_kind, item_ref, quantity_delta, source_type, source_id, idempotency_key, created_at |
| `xtank.loadouts` | loadout_id, player_id, tank_id, name, is_selected, updated_at |
| `xtank.loadout_slots` | loadout_id, slot_type, slot_number, weapon_id, item_id |
| `xtank.equipped_cosmetics` | player_id, tank_id, equip_slot, cosmetic_id, updated_at |

### 貨幣與商城（7）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.currencies` | currency_code, display_name, spendable, enabled |
| `xtank.wallet_balances` | player_id, currency_code, balance, updated_at |
| `xtank.wallet_transactions` | transaction_id, player_id, currency_code, amount, balance_after, source_type, source_id, idempotency_key, created_at |
| `xtank.xp_transactions` | transaction_id, player_id, xp_delta, xp_after, source_type, source_id, idempotency_key, created_at |
| `xtank.shop_offers` | offer_id, offer_key, weapon_id, item_id, cosmetic_id, currency_code, unit_price, quantity, min_level, stock_limit, starts_at, ends_at, enabled |
| `xtank.shop_orders` | order_id, player_id, currency_code, total_price, status, idempotency_key, created_at, completed_at |
| `xtank.shop_order_lines` | order_line_id, order_id, offer_id, item_ref, item_kind, quantity, unit_price, line_total |

### 遊戲伺服器、房間、配對（7）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.game_servers` | server_id, server_name, region, endpoint_url, build_version, status, current_players, capacity, last_heartbeat_at, created_at |
| `xtank.rooms` | room_id, room_code, host_player_id, game_server_id, mode_id, map_id, phase, password_hash, capacity, allow_ai, room_config, created_at, expires_at |
| `xtank.room_members` | room_id, player_id, tank_id, team, slot_number, is_ready, joined_at, left_at |
| `xtank.room_invites` | invite_id, room_id, inviter_id, invitee_id, status, expires_at, created_at |
| `xtank.parties` | party_id, leader_id, status, created_at, closed_at |
| `xtank.party_members` | party_id, player_id, joined_at |
| `xtank.matchmaking_tickets` | ticket_id, player_id, party_id, mode_id, region, rating, status, matched_room_id, created_at, updated_at |

### 對戰、戰績、排行榜（8）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.matches` | match_id, room_id, server_id, server_round_id, ruleset_id, mode_id, map_id, seed, match_source, status, winning_team, results, started_at, ended_at |
| `xtank.match_participants` | match_id, slot_number, player_id, ai_identifier, tank_id, team, kills, deaths, assists, damage_done, flag_scores, placement, is_winner, disconnected |
| `xtank.match_events` | event_id, match_id, server_tick, event_seq, event_type, actor_id, payload, created_at |
| `xtank.match_rewards` | reward_id, match_id, player_id, xp, currency_code, currency_amount, item_rewards, status, applied_at, created_at |
| `xtank.replay_files` | replay_id, match_id, storage_key, sha256, bytes, game_version, ruleset_code, created_at |
| `xtank.seasons` | season_id, code, display_name, starts_at, ends_at, status, config |
| `xtank.player_ratings` | season_id, player_id, mode_id, rating, mmr, wins, losses, updated_at |
| `xtank.leaderboard_snapshots` | snapshot_id, season_id, mode_id, metric, player_id, rank, score, snapshot_at |

### 好友、公會及聊天（7）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.friends` | player_id, friend_id, status, requested_at, accepted_at |
| `xtank.player_blocks` | player_id, blocked_player_id, created_at |
| `xtank.clans` | clan_id, clan_name, tag, leader_id, description, created_at, status |
| `xtank.clan_members` | clan_id, player_id, role, joined_at |
| `xtank.chat_messages` | message_id, sender_id, room_id, clan_id, recipient_id, channel, body, sent_at, deleted_at |
| `xtank.notifications` | notification_id, player_id, kind, payload, read_at, created_at |
| `xtank.mail_items` | mail_id, recipient_id, sender_id, title, body, attachments, claimed_at, read_at, expires_at, created_at |

### 成就、任務與活動（6）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.achievements` | achievement_id, display_name, description, condition_config, reward_config, enabled |
| `xtank.player_achievements` | player_id, achievement_id, progress, completed_at, claimed_at |
| `xtank.quests` | quest_id, display_name, cadence, condition_config, reward_config, enabled |
| `xtank.player_quests` | player_id, quest_id, cycle_key, progress, completed_at, claimed_at |
| `xtank.live_events` | event_id, code, display_name, starts_at, ends_at, config, enabled |
| `xtank.live_event_progress` | event_id, player_id, progress, claimed_at, updated_at |

### 後台管理、安全及稽核（5）

| 資料表 | 實際欄位 |
|---|---|
| `xtank.reports` | report_id, reporter_id, reported_id, match_id, reason, details, evidence, status, created_at, resolved_at |
| `xtank.moderation_actions` | action_id, target_player_id, moderator_id, report_id, action_type, reason, expires_at, created_at |
| `xtank.bans` | ban_id, player_id, action_id, device_hash, starts_at, expires_at, revoked_at, reason |
| `xtank.audit_logs` | id, actor_player_id, actor_service, operation, entity_type, entity_id, before_data, after_data, request_id, created_at |
| `xtank.config_changes` | change_id, actor_player_id, config_type, config_key, before_value, after_value, reason, created_at |

## 3.1 另有 2 張私有 QA 資料表（不列入上面的 62 張業務表）
- `xtank.qa_credentials`：已建立的 3 位 Auth QA 玩家之 label、email、密碼（私有管理測試用途）、UUID、provisioned_at。**真實密碼不能寫入公開 repo 或 Windows EXE；以服務管理角色管理和查詢。**
- `xtank.qa_bootstrap`：一次性建檔 nonce、使用狀態與過期時間。初始測試帳號已開通，公開 bootstrap Edge Function 已停用。
- 本次已直接向 Supabase 查核：64 張 BASE TABLE 全數 RLS ON；`anon` / `authenticated` 均不能 USAGE `xtank` schema，也不能讀 `qa_credentials`。一般玩家不得直接執行正式對戰入帳 RPC，但登入玩家可呼叫受控的個人資料 RPC。
- 測試帳號與操作範例見 [27｜測試帳號與跨對話接續](27_測試帳號與跨對話接續.md)。

## 4. 核心安全模型
1. `auth.users.id` 是帳號身份，`players.player_id` 必須是相同 UUID；密碼由 Supabase Auth 管理，遊戲資料庫不存密碼。
2. **64 表全數 RLS ENABLED，且 `xtank` 不授權 anon/authenticated 直接存取**。高權限 service role 僅在可信任後端使用；**EXE 禁止內嵌 service key**。
3. 玩家客戶端走經驗證 JWT 的遊戲後端 API；玩家只能修改自己的設定與允許的暱稱，不可直接改錢、XP、分數、所有權或商店價格。
4. 武器子彈、移動、碰撞、血量和旗幟狀態在權威 WebSocket 遊戲伺服器記憶體運算，**不得每 tick 寫 PostgreSQL**。
5. 資料庫永續保存帳號、坦克、背包、配裝、經濟交易、正式對局摘要、成就、賽季排行及稽核。
6. 單機練習及玩家自行架設 LAN 主機標為 `practice`/`community`，不能發 `official` 戰局獎勵，防止自改伺服器刷錢。
7. 在新版本調整傷害/規則，新增 `ruleset` 版本，完成的 `matches.ruleset_id` 不允許默默換掉。

## 5. 可信後端交易介面
| 函式 | 功能 | 檢查 |
|---|---|---|
| `xtank.provision_player(p_player_id,p_display_name)` | 玩家初次建檔、8 車、初始 1000 COIN | 必須先有對應 auth.users；不可重複領新手幣 |
| `xtank.apply_wallet_delta(p_player_id,p_currency,p_delta,p_source_type,p_source_id,p_key)` | 遊戲幣收支與 ledger | 行鎖、禁止負餘額、交易鍵唯一 |
| `xtank.award_xp(p_player_id,p_delta,p_source_type,p_source_id,p_key)` | 經驗、等級/點數、XP ledger | 行鎖、重送同一 key 不重複加 XP |
| `xtank.buy_offer(p_player_id,p_offer_id,p_quantity,p_key)` | 商城購物/扣幣/交付庫存 | 伺服器定價、失敗全回滾 |
| `xtank.settle_match_reward(p_match_id,p_player_id)` | 官方對局獎勵及玩家累積統計 | 官方完成賽果、本人參戰、reward 唯一、重送無雙倍 |

這些函式在 `xtank` 私有 schema，`PUBLIC`、`anon`、`authenticated` 無 EXECUTE；`service_role` 有 EXECUTE。它們是資料庫原子操作，不會自行驗證遊戲玩家射擊動作；遊戲伺服器必須驗 JWT、回合、勝負、對局可信度與作弊。

## 6. 不可缺少的約束
- `players.player_id` 參考 `auth.users(id)`；暱稱大小寫不敏感唯一（未刪帳）。
- `tank_upgrades` 五個屬性各 0–10；複合 FK 避免升級玩家尚未擁有的坦克。
- `loadout_slots` 分別 1–7 武器和道具；同槽不允許同時兩種物件；同車只有一個選中 loadout。
- `wallet_balances.balance >= 0`；貨幣、XP、物品 ledger、商店訂單均有 idempotency key。
- `rooms.room_code` 大寫六碼英數；room_members 有有效席位唯一索引；不可以房碼取代 Auth。
- `match_participants` 真人/AI 必須恰有一種身分；`match_rewards` `UNIQUE(match_id,player_id)`；`matches.server_round_id` 唯一。
- 各賽季/模式積分獨立；退款/補償、背包物品變動需記錄流水。

## 7. 永久資料生命週期
```text
EXE 開啟 → Supabase Auth signIn/匿名身份 → 官方 API 驗 JWT
 → provision_player(僅首次初始化)
 → 主大廳查玩家坦克/背包/金幣/配裝
 → 玩家商城按鈕 → buy_offer (一筆原子交易)
 → 選擇房間 → 官方 WSS/Match 結束
 → 伺服器存 matches、match_participants、match_rewards
 → settle_match_reward → 只入一次 XP、COIN、統計
 → 退出 → 重開 EXE → 同一 player_id 永久讀回
```

## 8. 目前未完成與驗收標準
- **已完成**：62 表及 62 張 RLS、索引、種子、5 個伺服器端函式已部署。
- **待整合**：EXE 的註冊登入/主大廳/商城 UI、後端 API 身分與權限驗證、官方持續運作 WSS、結算來源驗證與跨端同步。
- **仍須測試**：訪客轉正不遺失資料、2 台 EXE 同玩家衝突、金幣不足、限量售賣（目前未支援）、斷線重試、100 次交易重送、資料庫故障回滾、對局不同版本。
- 所有情境依 [完整遊戲端到端測試計畫](26_完整遊戲端到端測試計畫.md) 留存 PASS/FAIL/BLOCKED 證據。

## 9. SQL 唯讀驗證
```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='xtank' AND table_type='BASE TABLE'; -- 64
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='xtank' AND c.relkind='r' AND c.relrowsecurity; -- 62
SELECT count(*) FROM xtank.tank_defs; -- 8
SELECT count(*) FROM xtank.weapon_defs; -- 7
SELECT count(*) FROM xtank.item_defs; -- 6
SELECT count(*) FROM xtank.map_defs; -- 3
SELECT count(*) FROM xtank.mode_defs; -- 3
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='xtank';
```

> 安全附註：既有 Game 專案 `public` schema 另有其他遊戲的 RLS 風險，本次不修改非 X-TANK 既有表。
