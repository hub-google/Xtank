-- Remove unrequested global MMR / premade-party API endpoints.
-- Keep legacy shared-schema tables (empty) to avoid collateral damage to older migrations.
-- There is no permanent replay API to disable: replay_files remains an unused
-- zero-row legacy schema table, not a running feature.
DROP FUNCTION IF EXISTS public.xtank_match_ticket_status();
DROP FUNCTION IF EXISTS public.xtank_matchmaker_host(text,uuid,text,text,text,uuid);
DROP FUNCTION IF EXISTS public.xtank_party_queue_api(text,jsonb);
DROP INDEX IF EXISTS xtank.xtank_party_one_membership;
DROP INDEX IF EXISTS xtank.xtank_one_queued_ticket_per_player;